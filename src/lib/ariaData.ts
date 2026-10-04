/**
 * On-demand data for BPL Analyst. Each dataset is fetched only when a question needs it,
 * through the same cached endpoints the pages use, so a page visit usually makes it instant.
 */
import type { FleetVehicle, TripDriver } from '../context/FleetContext';
import { authCachedJson, CACHE_TTL } from './apiCache';
import {
  assessDriversFromRisk,
  mergeAssessmentTripDrivers,
  type AssessedDriver,
} from './driverAssessment';
import { fetchDriverWarnings, type DriverWarning } from './coachingWarningsApi';
import { getCertificates, type DriverCertificate } from './driverInterventions';
import type { ConsumptionData } from './fuelConsumption';
import { buildUtilUrl, type KpiData } from './operationalKpi';
import { deriveFleetLocationHubs } from './fleetLocations';
import { fetchIncidentEnvironment, type ResolvedEnvironment } from '../services/environment';
import {
  appendUrlScope,
  fleetScopeOpts,
  fleetSiteScopeOpts,
  filterRiskDriversByAssignedSite,
  filterTripDriversByAssignedSite,
  makeScopedVehicleIdSet,
} from './siteScope';

export type AriaTopic = 'drivers' | 'warnings' | 'trends' | 'fuel' | 'utilization' | 'trips' | 'certificates' | 'weather';

export interface AriaWeatherSpot {
  label: string;
  /** Hub asset count, or undefined for a single vehicle. */
  assetCount?: number;
  env: ResolvedEnvironment;
}

export interface TrendBucket {
  dayKey: string;
  byLabel: Record<string, number>;
  total: number;
}

export interface SessionTrip {
  TripId?: string;
  AssetId?: string;
  DriverId?: string;
  TripStart?: string;
  TripEnd?: string | null;
  DistanceKilometers?: number;
  MaxSpeedKilometersPerHour?: number;
  drivingHours?: number;
  idleHours?: number;
}

export interface AriaExtras {
  /** 30-day driver assessment — same source and scoring as Driver Management. */
  drivers?: AssessedDriver[];
  driversWindow?: { start: string; end: string };
  /** Latest written warning per driver key. */
  warnings?: Map<string, DriverWarning>;
  trends?: { from: string; to: string; buckets: TrendBucket[] };
  fuel?: ConsumptionData;
  utilization?: KpiData;
  trips?: SessionTrip[];
  certificates?: DriverCertificate[];
  /** Live weather + traffic at the busiest fleet hubs (same hubs as the home strip), or at one vehicle. */
  weather?: AriaWeatherSpot[];
  failed: AriaTopic[];
}

export interface AriaDataDeps {
  authFetch: (url: string, options?: RequestInit) => Promise<Response>;
  selectedSites: string[];
  /** Fleet already filtered to the header site selection. */
  vehicles: FleetVehicle[];
  siteFilterActive: boolean;
  /** Vehicle named in the question — weather is looked up at its position instead of the hubs. */
  focusVehicle?: FleetVehicle;
}

const FETCH_TIMEOUT_MS = 8_000;
/** 30-day driver distance takes ~8–15 s cold on the server; pages share the same cache. */
const DRIVERS_TIMEOUT_MS = 25_000;
const TRENDS_DAYS = 30;
const RISK_30D_URL = '/api/risk/drivers?range=30d';
const DISTANCE_30D_URL = '/api/driver-distance?range=30d&trips=0';

const TOPIC_PATTERNS: Record<AriaTopic, RegExp> = {
  drivers: /\bdrivers?\b|\bwho\b|score|category|consequence|coach|attention|worst|best|safest|riskiest|suspension|critical|on track|how is|tell me about|status of|record of|standing/,
  warnings: /warn(ed|ing|ings)?\b|disciplin|written|suspension|already (been )?(spoken|coached)/,
  trends: /trend|increas|decreas|going (up|down)|rising|falling|compared|\bvs\b|versus|last month|this month|week on week|per day|daily|spike|pattern/,
  fuel: /fuel|diesel|litre|liter|refuel|consumption|l\/100|km\/l|theft|siphon/,
  utilization: /utili[sz]|idle hours|engine hours|availability|productiv|under-?used|busiest|working hours/,
  trips: /\btrips?\b|journey|en route|on the road|currently driving|last 24|in transit/,
  certificates: /certif|licen[cs]e|expir|permit|renewal/,
  weather: /weather|\brain(s|ing|y|fall)?\b|storm|thunder|flood|\bfog(gy)?\b|temperature|\bhot\b|humid|\bwindy?\b|traffic(?! (violation|offen[cs]e|rule|law|fine|ticket))|congest|go-?slow|road conditions?/,
};

/** Driver-related intents always need the 30-day assessment. */
const INTENT_TOPICS: Record<string, AriaTopic[]> = {
  driver_attention: ['drivers', 'warnings'],
  best_driver: ['drivers'],
  named_driver: ['drivers', 'warnings'],
  actions_today: ['drivers', 'warnings', 'certificates'],
};

export function detectAriaTopics(question: string, intent?: string): AriaTopic[] {
  const q = question.trim().toLowerCase();
  const topics = new Set<AriaTopic>(intent ? INTENT_TOPICS[intent] ?? [] : []);
  (Object.keys(TOPIC_PATTERNS) as AriaTopic[]).forEach(t => {
    if (TOPIC_PATTERNS[t].test(q)) topics.add(t);
  });
  if (topics.has('warnings')) topics.add('drivers');
  return [...topics];
}

function withTimeout<T>(p: Promise<T>, ms = FETCH_TIMEOUT_MS): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

function lagosDayStartIso(daysBack: number): string {
  const d = new Date(Date.now() - daysBack * 86_400_000);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

type RiskRow = Parameters<typeof assessDriversFromRisk>[0][number];

async function loadDrivers(deps: AriaDataDeps): Promise<Pick<AriaExtras, 'drivers' | 'driversWindow'>> {
  const [risk, distance] = await Promise.all([
    authCachedJson<{ start?: string; end?: string; drivers?: RiskRow[] }>(
      RISK_30D_URL, deps.authFetch, { ttlMs: CACHE_TTL.riskDrivers },
    ),
    authCachedJson<{ drivers?: TripDriver[] }>(
      DISTANCE_30D_URL, deps.authFetch, { ttlMs: CACHE_TTL.driverAssessment },
    ),
  ]);
  const trips = mergeAssessmentTripDrivers([Array.isArray(distance?.drivers) ? distance!.drivers : []]);
  const rows = Array.isArray(risk?.drivers) ? risk!.drivers : [];
  const scopedTrips = deps.siteFilterActive ? filterTripDriversByAssignedSite(trips, deps.vehicles) : trips;
  const scopedRows = deps.siteFilterActive ? filterRiskDriversByAssignedSite(rows, scopedTrips, deps.vehicles) : rows;
  return {
    drivers: assessDriversFromRisk(scopedRows, scopedTrips),
    driversWindow: risk?.start && risk?.end ? { start: risk.start, end: risk.end } : undefined,
  };
}

async function loadWarnings(): Promise<Map<string, DriverWarning>> {
  const list = await fetchDriverWarnings();
  const map = new Map<string, DriverWarning>();
  for (const w of list) if (!map.has(w.driverKey)) map.set(w.driverKey, w);
  return map;
}

async function loadTrends(deps: AriaDataDeps): Promise<AriaExtras['trends']> {
  const from = lagosDayStartIso(TRENDS_DAYS - 1);
  const to = new Date().toISOString().slice(0, 13) + ':00:00.000Z';
  const url = appendUrlScope(
    `/api/events/trends?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    fleetSiteScopeOpts(deps.selectedSites),
  );
  const data = await authCachedJson<{ from?: string; to?: string; buckets?: TrendBucket[] }>(
    url, deps.authFetch, { ttlMs: CACHE_TTL.safetySummary },
  );
  return { from, to, buckets: Array.isArray(data?.buckets) ? data!.buckets : [] };
}

async function loadFuel(deps: AriaDataDeps): Promise<ConsumptionData | undefined> {
  const url = appendUrlScope('/api/fuel/consumption?period=week&trips=0', fleetScopeOpts(deps.selectedSites, deps.vehicles));
  return (await authCachedJson<ConsumptionData>(url, deps.authFetch, { ttlMs: CACHE_TTL.fuelConsumption })) ?? undefined;
}

async function loadUtilization(deps: AriaDataDeps): Promise<KpiData | undefined> {
  const url = buildUtilUrl('week', 'all', undefined, undefined, fleetScopeOpts(deps.selectedSites, deps.vehicles));
  return (await authCachedJson<KpiData>(url, deps.authFetch, { ttlMs: CACHE_TTL.kpi })) ?? undefined;
}

async function loadTrips(deps: AriaDataDeps): Promise<SessionTrip[]> {
  const data = await authCachedJson<SessionTrip[]>('/api/trips/session', deps.authFetch, { ttlMs: CACHE_TTL.pageRollup });
  const trips = Array.isArray(data) ? data : [];
  if (!deps.siteFilterActive) return trips;
  const allowed = makeScopedVehicleIdSet(deps.vehicles);
  return trips.filter(t => allowed.has(String(t.AssetId ?? '')));
}

const WEATHER_HUBS = 4;

async function loadWeather(deps: AriaDataDeps): Promise<AriaWeatherSpot[]> {
  const v = deps.focusVehicle;
  if (v?.position?.latitude && v.position.longitude) {
    const env = await fetchIncidentEnvironment({
      latitude: v.position.latitude,
      longitude: v.position.longitude,
      address: v.position.address,
    });
    return [{ label: v.regNo, env }];
  }
  const hubs = deriveFleetLocationHubs(deps.vehicles, WEATHER_HUBS);
  return Promise.all(hubs.map(async h => ({
    label: h.label,
    assetCount: h.assetCount,
    env: await fetchIncidentEnvironment({ latitude: h.latitude, longitude: h.longitude, address: h.address || h.label }),
  })));
}

/** Start the slow 30-day driver fetches when the chat opens so the first driver question is fast. */
export function warmAriaDrivers(authFetch: AriaDataDeps['authFetch']): void {
  void authCachedJson(RISK_30D_URL, authFetch, { ttlMs: CACHE_TTL.riskDrivers }).catch(() => {});
  void authCachedJson(DISTANCE_30D_URL, authFetch, { ttlMs: CACHE_TTL.driverAssessment }).catch(() => {});
}

export async function loadAriaExtras(topics: AriaTopic[], deps: AriaDataDeps): Promise<AriaExtras> {
  const extras: AriaExtras = { failed: [] };
  const want = new Set(topics);
  const jobs: Array<Promise<void>> = [];
  const run = (topic: AriaTopic, job: () => Promise<void>) => {
    if (!want.has(topic)) return;
    const ms = topic === 'drivers' ? DRIVERS_TIMEOUT_MS : FETCH_TIMEOUT_MS;
    jobs.push(withTimeout(job(), ms).catch(() => { extras.failed.push(topic); }));
  };

  run('drivers', async () => { Object.assign(extras, await loadDrivers(deps)); });
  run('warnings', async () => { extras.warnings = await loadWarnings(); });
  run('trends', async () => { extras.trends = await loadTrends(deps); });
  run('fuel', async () => { extras.fuel = await loadFuel(deps); });
  run('utilization', async () => { extras.utilization = await loadUtilization(deps); });
  run('trips', async () => { extras.trips = await loadTrips(deps); });
  run('weather', async () => { extras.weather = await loadWeather(deps); });
  if (want.has('certificates')) extras.certificates = getCertificates();

  await Promise.all(jobs);
  return extras;
}
