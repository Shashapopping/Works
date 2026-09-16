import { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { SafetyNotification, SafeIQAnalysis, EnvironmentContext } from '../hooks/useSafeIQ';
import { fetchIncidentEnvironment } from '../services/environment';
import { lookupSafetyReference, formatReferenceForPrompt } from '../data/safetyReferences';
import {
  type StatusFilter,
  type AlertItem,
  type MaintenanceItem,
  type FuelDay,
  type AiInsight,
  type TripItem,
  deriveAlerts,
  deriveInsights,
  buildHomeAlertsUrl,
  normalizeVehicle,
  DEFAULT_MAINTENANCE,
  DEFAULT_FUEL_SERIES,
  DEMO_TRIPS,
} from '../lib/homeWidgetData';
import { isKnownDriver } from '../lib/driverUtils';
import { DEMO_BRANDING, demoPlaceLabel } from '../config/demoBranding';
import {
  sanitizeLogEntry,
  sanitizeVehicle,
  sanitizeNotification,
  sanitizeDriverDistance,
  sanitizeVaultRecord,
} from '../lib/demoSanitize';
import {
  computeFleetScore,
  loadFleetScoreConfig,
  saveFleetScoreConfig,
  FLEET_SCORE_CONFIG_EVENT,
  type FleetScoreConfig,
  type FleetSafetyExposure,
} from '../lib/fleetSafetyScore';
import { cachedFetchJson, cachePeek, CACHE_KEYS, CACHE_TTL, authCachedJson, safetySummaryUrl, peekSafetySummary } from '../lib/apiCache';
import { fetchHosCached, peekHos } from '../hooks/useHosRecords';
import { buildHosUrl, type HosRecord } from '../lib/hos';
import { startJitteredInterval } from '../lib/pollSchedule';
import { SAFEIQ_ENABLED } from '../config/safeIq';
import { filterOverspeedEvents } from '../lib/overspeedFilter';
import { appendUrlScope, filterDistanceAssetsByVehicles, filterTripDriversByVehicles, fleetScopeOpts, normalizeScopeKeys, scopedAssetIdList } from '../lib/siteScope';
import { defaultPageCustomRange } from '../lib/pagePeriod';
import { buildDriverDistanceUrl } from '../lib/pagePeriod';
import { readHomeSnapshot, slimHomeVehicle, writeHomeSnapshot } from '../lib/homeSnapshot';
import { useAuth } from './AuthContext';
import { authFetchInit } from '../lib/authApi';

export type { StatusFilter, AlertItem, MaintenanceItem, FuelDay, AiInsight, TripItem };
export type FleetVehicle = ReturnType<typeof normalizeVehicle>;
export type DistanceRange = 'day' | 'week' | 'month' | 'custom';

const ANTHROPIC_API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY;

async function generateSafeIQAnalysis(
  e: { label?: string; type: string; driverName?: string; regNo?: string; assetId: string; address?: string; eventTime: string; speed?: number | null; speedLimit?: number | null },
  driverIncidents30Days: number,
  driverTrend: 'improving' | 'stable' | 'declining',
  environment: EnvironmentContext,
  safetyReference: string | null,
): Promise<SafeIQAnalysis | null> {
  if (!SAFEIQ_ENABLED || !ANTHROPIC_API_KEY) return null;

  const eventType = e.label || 'Unknown';
  const driver = e.driverName || 'Unknown Driver';
  const vehicle = e.regNo || e.assetId;
  const location = (DEMO_BRANDING && e.address)
    ? demoPlaceLabel(e.address)
    : (e.address || 'Location not available');
  const time = new Date(e.eventTime).toLocaleString('en-GB', { timeZone: 'Africa/Lagos' });

  const prompt = `You are SafeIQ, a safety advisor for BPL Fleet Intelligence Platform (${DEMO_BRANDING ? 'Demo Fleet' : 'HBM Nigeria'}). Your tone is calm, observational, and advisory — you present findings and let the fleet manager decide. Never command. Suggest, reason, and reference policy as context not instruction.

Return a JSON object with exactly these fields:
- severity: "RED", "YELLOW", or "GREEN"
- severity_reason: one short sentence on why this severity rating fits
- root_cause: 2-3 sentences — what likely happened, what may have contributed (conditions, route, pattern). Soft and factual, not accusatory.
- industry_reference: one sentence — how this driver's pattern compares to industry norms (FRSC Nigeria / FMCSA). Frame it as context e.g. "drivers with X+ incidents in 30 days are typically considered..."
- coaching_recommendation: 2-3 short suggestions framed around company policy — e.g. "depending on your policy, you may want to consider a brief retraining period" or "keeping a closer eye on this driver over the next few weeks could be worth it"
- ops_flag: true or false
- ops_flag_reason: if true, one calm sentence on what the supervisor may want to look into. Empty string if false.

Event:
- Type: ${eventType}
- Driver: ${driver} (${driverIncidents30Days} incidents last 30 days, trend: ${driverTrend})
- Vehicle: ${vehicle} | Location: ${location} | Time: ${time}
- Weather: ${environment.weather} | Traffic: ${environment.traffic_description || environment.traffic_density} | Road: ${environment.road_type}
${environment.precipitation_mm ? `- Precipitation: ${environment.precipitation_mm}mm` : ''}
${e.speed != null ? `- Recorded speed: ${Math.round(e.speed)} km/h${e.speedLimit != null ? ` (speed limit: ${Math.round(e.speedLimit)} km/h, excess: ${Math.round(e.speed - e.speedLimit)} km/h)` : ''}` : ''}
${safetyReference ? `\nIndustry context (use as soft reference only):\n${safetyReference}` : ''}

Return only valid JSON, no markdown, nothing outside the JSON object.`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 700,
        temperature: 0,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) return null;
    const data = await res.json();
    const text = data.content?.[0]?.text ?? '';
    const json = text.match(/\{[\s\S]*\}/)?.[0];
    if (!json) return null;
    return JSON.parse(json) as SafeIQAnalysis;
  } catch {
    return null;
  }
}

const API_SECRET = import.meta.env.VITE_API_SECRET;

export const authFetch = (url: string, options: RequestInit = {}) =>
  fetch(url, authFetchInit({ ...options, headers: { ...options.headers, 'x-api-secret': API_SECRET } }));

export interface Metadata {
  totalVehicles: number;
  moving: number;
  idle: number;
  excessiveIdle: number;
  stationary: number;
  parked: number;
  inactive: number;
  offline: number;
  panic?: number;
  lastUpdate: string;
}

export interface LogEntry {
  timestamp: string;
  assetId: string;
  regNo?: string;
  assetName?: string;
  transporter?: string;
  driverId?: string;
  driverName?: string;
  driverPhone?: string;
  address?: string;
  latitude?: number | null;
  longitude?: number | null;
  eventId: string;
  eventType?: string;
  label?: string;
  eventTime: string;
  type: 'panic' | 'warning';
  speed?: number | null;
  speedLimit?: number | null;
}

export interface Vehicle {
  id: string;
  regNo: string;
  transporter: string;
  assetName: string;
  site?: string;
  zone?: string;
  make?: string;
  model?: string;
  status: string;
  date: string;
  panic: boolean;
  warnings?: {
    label: string;
    timestamp: string;
    eventId?: string;
    eventTime?: string;
    speed?: number | null;
    speedLimit?: number | null;
  }[];
  position?: { latitude: number; longitude: number; address?: string };
  fuelLevel?: { level: number; timestamp?: string } | null;
}

export interface TripAsset {
  assetId: string;
  regNo: string;
  assetName: string;
  totalDistanceKm: number;
  rawTripCount: number;
  journeyCount: number;
  totalDrivingTimeSeconds: number;
  avgSpeedKph: number | null;
  longestJourneyKm: number;
  drivers: string[];
}

export interface TripDriver {
  driverId: string | null;
  driverName: string;
  driverPhone: string;
  totalDistanceKm: number;
  journeyCount: number;
  totalDrivingTimeSeconds: number;
  vehicles: string[];
}

export interface DriverDistanceSummary {
  generatedAt: string;
  range: string;
  month: string | null;
  start: string;
  end: string;
  totalDistanceKm: number;
  rawTripCount: number;
  journeyCount: number;
  driverCount: number;
  assetCount: number;
  cachedTripCount: number;
  assets: TripAsset[];
  drivers: TripDriver[];
}

export interface VaultRecord {
  id: string;
  incidentId: string;
  type: string;
  driverName: string;
  vehicleId: string;
  location: string;
  timestamp: string;
  severity: 'RED' | 'YELLOW' | 'GREEN';
  status: 'open' | 'in_review' | 'resolved';
  description: string;
  actions: string[];
  supervisorResponse: string;
  resolution: string;
  createdAt: string;
  updatedAt: string;
}


interface FleetContextType {
  authFetch: typeof authFetch;
  metadata: Metadata;
  vehicles: FleetVehicle[];
  events: LogEntry[];
  driverDistance: DriverDistanceSummary | null;
  /** True until first vehicles payload for this session (or while refreshing empty). */
  vehiclesLoading: boolean;
  /** True until first events payload. */
  eventsLoading: boolean;
  /** True until the Home incident-alert card has something to paint. */
  alertsLoading: boolean;
  /** True while driver-distance for current distanceRange is in flight. */
  distanceLoading: boolean;
  /** Live HOS / fatigue records for today (shared by home card + Fatigue page). */
  hosRecords: HosRecord[];
  hosLoading: boolean;
  hosLastTripDay: string | null;
  safetyExposure: FleetSafetyExposure | null;
  safetyExposureLoading: boolean;
  fleetSafetyScore: number;
  fleetScoreDelta: number;
  safetyScore: number;
  safetyDelta: number;
  alerts: AlertItem[];
  maintenance: MaintenanceItem[];
  fuelSeries: FuelDay[];
  insights: AiInsight[];
  trips: TripItem[];
  distanceRange: DistanceRange;
  setDistanceRange: (range: DistanceRange, custom?: { from: string; to: string }) => void;
  distanceCustom: { from: string; to: string };
  totalDistanceKm: number;
  environment: { weather: string; traffic: string; temp: string };
  redAlertCount: number;
  notifications: SafetyNotification[];
  dismissNotification: (id: string) => void;
  clearAllNotifications: () => void;
  selectedNotification: SafetyNotification | null;
  openNotification: (n: SafetyNotification) => void;
  closeNotification: () => void;
  vaultRecords: VaultRecord[];
  addVaultRecord: (r: VaultRecord) => void;
  updateVaultRecord: (id: string, updates: Partial<VaultRecord>) => void;
  theme: 'light' | 'dark';
  setTheme: (t: 'light' | 'dark') => void;
  isMobile: boolean;
  reloadEvents: () => void;
  scoreConfig: FleetScoreConfig;
  updateScoreConfig: (config: FleetScoreConfig) => void;
  /**
   * Global site/location filter. Empty array = all sites.
   * Multiple keys = OR match — a vehicle is included if its zone OR its
   * granular `site` (transporter/depot name, e.g. "TRULUCK", "SHIWATECH")
   * is in the set. This lets the Cement site-hierarchy dropdown select an
   * individual transporter without needing a distinct top-level zone.
   */
  selectedSites: string[];
  setSelectedSites: (sites: string[]) => void;
  toggleSite: (siteKey: string) => void;
  /** Distinct sites (fleet zones) derived from live data, with asset counts. */
  siteOptions: { key: string; label: string; count: number }[];
  /** Distinct `site` values (transporter/depot names within a zone) derived from live data, with asset counts. */
  siteNameOptions: { key: string; label: string; count: number }[];
  /** True when the signed-in user is scoped to one or more transporter organizations. */
  siteLock: boolean;
  lockedTransporters: string[];
  /** True when header site filter is active. */
  siteFilterActive: boolean;
  /** Asset IDs for the current site filter (from filtered fleet). Empty when unfiltered. */
  scopedAssetIds: string[];
}

/** @deprecated kept for any leftover imports — empty selectedSites means all */
export const SITE_ALL = 'all';

const SELECTED_SITES_KEY = 'bpl_selected_sites';

/** Normalises a vehicle zone into the site key used by the global filter. */
function siteKeyFor(zone?: string | null) {
  const z = (zone || '').trim();
  return z || 'Unknown';
}

/** Short query suffix matching client-filtered fleet (assetIds preferred). */
function scopeQueryFor(selectedSites: string[], vehicles: Vehicle[]) {
  return appendUrlScope('', fleetScopeOpts(selectedSites, vehicles as any)).replace(/^\?/, '&');
}
function loadSelectedSites(): string[] {
  try {
    const raw = localStorage.getItem(SELECTED_SITES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((s): s is string => typeof s === 'string' && s !== SITE_ALL);
      }
    }
    // Migrate old single-site key
    const legacy = localStorage.getItem('bpl_selected_site');
    if (legacy && legacy !== SITE_ALL) return [legacy];
  } catch { /* ignore */ }
  return [];
}

const defaultMeta: Metadata = {
  totalVehicles: 0, moving: 0, idle: 0, excessiveIdle: 0,
  stationary: 0, parked: 0, inactive: 0, offline: 0, lastUpdate: '',
};

const METADATA_SNAPSHOT_KEY = 'hbm_fleet_metadata_snapshot';

function readMetadataSnapshot(): Metadata | null {
  try {
    const raw = localStorage.getItem(METADATA_SNAPSHOT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Metadata;
    return parsed && typeof parsed.totalVehicles === 'number' ? parsed : null;
  } catch {
    return null;
  }
}

function writeMetadataSnapshot(metadata: Metadata) {
  try {
    localStorage.setItem(METADATA_SNAPSHOT_KEY, JSON.stringify(metadata));
  } catch {
    /* ignore */
  }
}

function weekDistanceSummaryUrl() {
  const base = buildDriverDistanceUrl('week');
  return `${base}${base.includes('?') ? '&' : '?'}summary=1`;
}

const FleetContext = createContext<FleetContextType>({} as FleetContextType);

export function FleetProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const lockedTransporters = useMemo(
    () => (user?.transporters || []).map(t => t.trim()).filter(Boolean),
    [user?.transporters],
  );
  const siteLock = lockedTransporters.length > 0;
  const [metadata, setMetadata] = useState<Metadata>(() =>
    cachePeek<Metadata>(CACHE_KEYS.fleetMeta) ?? readMetadataSnapshot() ?? readHomeSnapshot()?.metadata ?? defaultMeta,
  );
  const [vehicles, setVehicles] = useState<FleetVehicle[]>(() => {
    const cached = cachePeek<Vehicle[]>(CACHE_KEYS.fleetData);
    const snap = !cached?.length ? readHomeSnapshot()?.vehicles : null;
    const source = cached?.length ? cached : snap;
    if (!source?.length) return [];
    return source
      .filter(v => v.site !== 'XN - Decommissioned')
      .map(normalizeVehicle);
  });
  const vehiclesRef = useRef<FleetVehicle[]>(vehicles);
  const [events, setEvents] = useState<LogEntry[]>(() =>
    cachePeek<LogEntry[]>(CACHE_KEYS.fleetEvents) ?? [],
  );
  const [homeAlerts, setHomeAlerts] = useState<AlertItem[] | null>(() => {
    const cached = cachePeek<LogEntry[]>(buildHomeAlertsUrl());
    if (Array.isArray(cached)) return deriveAlerts(filterOverspeedEvents(cached));
    const snap = readHomeSnapshot();
    return snap && Array.isArray(snap.alerts) ? snap.alerts : null;
  });
  const [alertsLoading, setAlertsLoading] = useState(() => {
    if (cachePeek<LogEntry[]>(buildHomeAlertsUrl())) return false;
    const snap = readHomeSnapshot();
    return !(snap && Array.isArray(snap.alerts));
  });
  const [driverDistance, setDriverDistance] = useState<DriverDistanceSummary | null>(() =>
    cachePeek<DriverDistanceSummary>(weekDistanceSummaryUrl())
    ?? readHomeSnapshot()?.driverDistance
    ?? cachePeek<DriverDistanceSummary>(buildDriverDistanceUrl('week')),
  );
  const [vehiclesLoading, setVehiclesLoading] = useState(() => {
    if (cachePeek<Vehicle[]>(CACHE_KEYS.fleetData)?.length) return false;
    return !(readHomeSnapshot()?.vehicles?.length);
  });
  const [eventsLoading, setEventsLoading] = useState(() => !(cachePeek<LogEntry[]>(CACHE_KEYS.fleetEvents)?.length));
  const [distanceLoading, setDistanceLoading] = useState(() =>
    !(
      cachePeek<DriverDistanceSummary>(weekDistanceSummaryUrl())
      || readHomeSnapshot()?.driverDistance
      || cachePeek<DriverDistanceSummary>(buildDriverDistanceUrl('week'))
    ),
  );
  const hosTodayUrl = buildHosUrl();
  const [hosRecords, setHosRecords] = useState<HosRecord[]>(() => peekHos(hosTodayUrl)?.records ?? []);
  const [hosLastTripDay, setHosLastTripDay] = useState<string | null>(() => peekHos(hosTodayUrl)?.lastTripDay ?? null);
  const [hosLoading, setHosLoading] = useState(() => !peekHos(hosTodayUrl));
  const [safetyExposure, setSafetyExposure] = useState<FleetSafetyExposure | null>(() =>
    peekSafetySummary<FleetSafetyExposure>('30d'),
  );
  const [safetyExposurePrev, setSafetyExposurePrev] = useState<FleetSafetyExposure | null>(() =>
    peekSafetySummary<FleetSafetyExposure>('prev30d'),
  );
  const [safetyExposureLoading, setSafetyExposureLoading] = useState(() =>
    !peekSafetySummary<FleetSafetyExposure>('30d'),
  );
  const [distanceRange, setDistanceRangeState] = useState<DistanceRange>('week');
  const [distanceCustom, setDistanceCustom] = useState(defaultPageCustomRange);
  const setDistanceRange = useCallback((range: DistanceRange, custom?: { from: string; to: string }) => {
    setDistanceLoading(true);
    setDistanceRangeState(range);
    if (custom) setDistanceCustom(custom);
  }, []);
  const [fuelSeries, setFuelSeries] = useState<FuelDay[]>(DEFAULT_FUEL_SERIES);
  const [environment, setEnvironment] = useState({ weather: 'Loading…', traffic: 'Moderate', temp: '—' });
  const [notifications, setNotifications] = useState<SafetyNotification[]>([]);
  const [selectedNotification, setSelectedNotification] = useState<SafetyNotification | null>(null);
  const [vaultRecords, setVaultRecords] = useState<VaultRecord[]>(() => {
    try { return JSON.parse(localStorage.getItem('bpl_vault') || '[]'); } catch { return []; }
  });
  const [theme, setThemeState] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('cd-theme') as 'light' | 'dark' | null;
    if (saved) return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 900);
  const [scoreConfig, setScoreConfig] = useState<FleetScoreConfig>(() => loadFleetScoreConfig());
  const [selectedSites, setSelectedSitesState] = useState<string[]>(() => loadSelectedSites());
  const seenEventIds = useRef<Set<string>>(new Set());
  const driverDistanceRef = useRef<DriverDistanceSummary | null>(driverDistance);
  const safetyExposureRef = useRef<FleetSafetyExposure | null>(safetyExposure);
  const hosRecordsRef = useRef<HosRecord[]>(hosRecords);
  const homeAlertsRef = useRef<AlertItem[] | null>(homeAlerts);
  const bootTasksStartedRef = useRef(false);
  // Tracks the incident count at which we last fired a Claude analysis per driver
  const driverAnalysisRef = useRef<Map<string, { lastThreshold: number; notifId: string }>>(new Map());

  const scheduleIdle = useCallback((fn: () => void, timeoutMs: number) => {
    const w = window as Window & typeof globalThis;
    if (typeof w.requestIdleCallback === 'function') {
      const id = w.requestIdleCallback(() => fn(), { timeout: timeoutMs });
      return () => w.cancelIdleCallback(id);
    }
    const id = w.setTimeout(fn, Math.min(timeoutMs, 1200));
    return () => w.clearTimeout(id);
  }, []);

  useEffect(() => {
    driverDistanceRef.current = driverDistance;
  }, [driverDistance]);

  useEffect(() => {
    safetyExposureRef.current = safetyExposure;
  }, [safetyExposure]);

  useEffect(() => {
    hosRecordsRef.current = hosRecords;
  }, [hosRecords]);

  useEffect(() => {
    homeAlertsRef.current = homeAlerts;
  }, [homeAlerts]);

  useEffect(() => {
    if (!vehicles.length && !metadata.lastUpdate) return;
    const t = window.setTimeout(() => {
      writeHomeSnapshot({
        at: Date.now(),
        metadata,
        vehicles: vehicles.map(slimHomeVehicle),
        alerts: homeAlerts ?? [],
        driverDistance,
      });
    }, 800);
    return () => window.clearTimeout(t);
  }, [vehicles, metadata, homeAlerts, driverDistance]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('cd-theme', theme);
  }, [theme]);

  const setTheme = useCallback((t: 'light' | 'dark') => setThemeState(t), []);

  const persistSites = useCallback((sites: string[]) => {
    const cleaned = [...new Set(sites.filter(s => s && s !== SITE_ALL))];
    setSelectedSitesState(cleaned);
    try {
      localStorage.setItem(SELECTED_SITES_KEY, JSON.stringify(cleaned));
      localStorage.removeItem('bpl_selected_site');
    } catch { /* ignore */ }
  }, []);

  const setSelectedSites = useCallback((sites: string[]) => {
    if (siteLock) {
      persistSites(lockedTransporters);
      return;
    }
    persistSites(sites);
  }, [persistSites, siteLock, lockedTransporters]);

  const toggleSite = useCallback((siteKey: string) => {
    if (siteLock) return;
    setSelectedSitesState(prev => {
      const next = prev.includes(siteKey)
        ? prev.filter(s => s !== siteKey)
        : [...prev, siteKey];
      try {
        localStorage.setItem(SELECTED_SITES_KEY, JSON.stringify(next));
        localStorage.removeItem('bpl_selected_site');
      } catch { /* ignore */ }
      return next;
    });
  }, []);

  useEffect(() => {
    if (lockedTransporters.length) persistSites(lockedTransporters);
  }, [lockedTransporters, persistSites]);

  const updateScoreConfig = useCallback((config: FleetScoreConfig) => {
    setScoreConfig(saveFleetScoreConfig(config));
  }, []);

  useEffect(() => {
    const onConfig = (e: Event) => {
      const detail = (e as CustomEvent<FleetScoreConfig>).detail;
      if (detail) setScoreConfig(detail);
      else setScoreConfig(loadFleetScoreConfig());
    };
    window.addEventListener(FLEET_SCORE_CONFIG_EVENT, onConfig);
    return () => window.removeEventListener(FLEET_SCORE_CONFIG_EVENT, onConfig);
  }, []);

  // Re-read config on mount so Nigeria leading-target migration applies after upgrades
  useEffect(() => {
    setScoreConfig(loadFleetScoreConfig());
  }, []);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 900);
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const loadMetadata = useCallback(async () => {
    try {
      const data = await cachedFetchJson<Metadata>(
        CACHE_KEYS.fleetMeta,
        CACHE_TTL.fleetMeta,
        async () => {
          const res = await authFetch('/api/metadata');
          if (!res.ok) return null;
          return res.json();
        },
      );
      if (data) {
        setMetadata(data);
        writeMetadataSnapshot(data);
      }
    } catch {}
  }, []);

  const loadVehicles = useCallback(async () => {
    try {
      if (!vehiclesRef.current.length) setVehiclesLoading(true);
      const hasSnapshot = vehiclesRef.current.length > 0;
      const raw = await cachedFetchJson<Vehicle[]>(
        hasSnapshot ? CACHE_KEYS.fleetLive : CACHE_KEYS.fleetData,
        CACHE_TTL.fleetData,
        async () => {
          const res = await authFetch(hasSnapshot ? '/api/data?view=live' : '/api/data');
          if (!res.ok) return null;
          return res.json();
        },
      );
      if (!raw) return;
      const source = hasSnapshot
        ? (() => {
            const prevById = new Map(vehiclesRef.current.map(v => [v.id, v]));
            return raw.map(v => ({ ...(prevById.get(v.id) || {}), ...v }));
          })()
        : raw;
      const data = source
        .filter(v => v.site !== 'XN - Decommissioned')
        .map(normalizeVehicle);
      vehiclesRef.current = data;
      setVehicles(data);
    } catch {}
    finally { setVehiclesLoading(false); }
  }, []);

  const loadEvents = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        to: new Date().toISOString(),
        format: 'page',
        limit: '120',
        excludeHidden: '1',
        // Home/ARIA only need scored IVMS labels — not the full 7d dump.
        types: [
          'Harsh Braking',
          'Harsh Acceleration',
          'Overspeeding',
          'Overspeed Tiered',
          'Road Speed Overspeeding',
          'Harsh Cornering',
        ].join(','),
      });
      const scope = fleetScopeOpts(selectedSites, vehiclesRef.current as any);
      if (scope.assetIds?.length) params.set('assetIds', scope.assetIds.join(','));
      else if (scope.siteScope?.length) params.set('siteScope', scope.siteScope.join(','));
      const eventsUrl = `/api/events/log?${params.toString()}`;
      const cached = cachePeek<LogEntry[]>(eventsUrl);
      setEvents(cached ? filterOverspeedEvents(cached) : []);
      setEventsLoading(!cached);
      const data = await cachedFetchJson<LogEntry[]>(
        eventsUrl,
        CACHE_TTL.fleetEvents,
        async () => {
          const res = await authFetch(eventsUrl);
          if (!res.ok) return null;
          const payload = await res.json();
          return Array.isArray(payload) ? payload : payload?.entries ?? [];
        },
      );
      if (!data) return;
      setEvents(filterOverspeedEvents(data));

      // SafeIQ shelved — no thresholds, Claude calls, or environment lookups
      if (!SAFEIQ_ENABLED) {
        setNotifications([]);
        return;
      }

        // Surface new safety events as notifications
        const SAFEIQ_LABELS = ['Harsh Braking', 'Harsh Acceleration', 'Overspeeding', 'Overspeed Tiered', 'Road Speed Overspeeding'];
        const SAFEIQ_OVERSPEED_MIN_EXCESS_KMH = 5;
        const isOverspeedLabel = (label?: string) =>
          label === 'Overspeeding' || label === 'Overspeed Tiered' || label === 'Road Speed Overspeeding';
        /** SafeIQ only reports overspeed when clearly ≥5 km/h over the posted limit and absolute speed ≥60 kph. */
        const meetsSafeIqOverspeedThreshold = (e: LogEntry) => {
          if (!isOverspeedLabel(e.label)) return true;
          if (e.speed == null || e.speed < 60) return false;
          if (e.speedLimit == null) return false;
          return e.speed - e.speedLimit >= SAFEIQ_OVERSPEED_MIN_EXCESS_KMH;
        };
        const newOnes = data.filter(e => {
          if (!e.eventId || seenEventIds.current.has(e.eventId)) return false;
          const isRelevant = SAFEIQ_LABELS.includes(e.label || '')
            && isKnownDriver(e.driverName);
          if (!isRelevant) return false;
          if (!meetsSafeIqOverspeedThreshold(e)) return false;
          const age = Date.now() - new Date(e.eventTime || e.timestamp).getTime();
          return age < 10 * 60 * 1000; // only events in last 10 min
        });

        if (newOnes.length > 0) {
          newOnes.forEach(e => seenEventIds.current.add(e.eventId));

          // Compute driver stats from the full event set
          const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
          const getDriverStats = (driverName: string | undefined) => {
            if (!isKnownDriver(driverName)) return { incidents: 0, trend: 'stable' as const };
            const driverEvents = data.filter(ev =>
              ev.driverName === driverName &&
              new Date(ev.eventTime || ev.timestamp).getTime() >= thirtyDaysAgo
            );
            const prevEvents = data.filter(ev => {
              const t = new Date(ev.eventTime || ev.timestamp).getTime();
              return ev.driverName === driverName && t >= thirtyDaysAgo - 30 * 24 * 60 * 60 * 1000 && t < thirtyDaysAgo;
            });
            const trend = driverEvents.length < prevEvents.length ? 'improving'
              : driverEvents.length > prevEvents.length ? 'declining' : 'stable';
            return { incidents: driverEvents.length, trend: trend as 'improving' | 'stable' | 'declining' };
          };

          // Threshold logic: fire Claude at 3 incidents, then double each time (3 → 6 → 12 → 24...)
          const nextThreshold = (last: number) => last === 0 ? 3 : last * 2;

          const toAnalyse: LogEntry[] = [];

          newOnes.forEach(e => {
            const driverKey = e.driverName || e.assetId;
            const stats = getDriverStats(e.driverName);
            const driverState = driverAnalysisRef.current.get(driverKey);
            const threshold = nextThreshold(driverState?.lastThreshold ?? 0);

            if (stats.incidents >= threshold) {
              // Threshold crossed — queue for Claude analysis
              toAnalyse.push(e);
              driverAnalysisRef.current.set(driverKey, {
                lastThreshold: stats.incidents,
                notifId: e.eventId,
              });
            } else if (driverState?.notifId) {
              // Below threshold but driver already has a notification — silently update count
              setNotifications(prev =>
                prev.map(n => n.id === driverState.notifId
                  ? { ...n, eventCount: stats.incidents, driver: { ...n.driver, incidents_last_30_days: stats.incidents } }
                  : n
                )
              );
            }
            // else: below threshold, no existing notification — event appears in feed only
          });

          if (toAnalyse.length > 0) {
            const newNotifs: SafetyNotification[] = toAnalyse.map(e => {
              const stats = getDriverStats(e.driverName);
              const scoreBaseline = Math.max(35, Math.min(100, 100 - stats.incidents * 3));
              const vehicleRecord = vehiclesRef.current.find(v => v.id === e.assetId?.toString() || v.regNo === e.regNo);
              return {
                id: e.eventId,
                type: e.label === 'Overspeeding' || e.label === 'Overspeed Tiered' ? 'speeding' :
                  e.label === 'Harsh Acceleration' ? 'harsh_acceleration' : 'harsh_braking',
                magnitude: (() => {
                  const isSpeeding = e.label === 'Overspeeding' || e.label === 'Overspeed Tiered';
                  if (isSpeeding && e.speed != null) {
                    const base = `${Math.round(e.speed)} km/h`;
                    return e.speedLimit != null
                      ? `${base} (limit ${Math.round(e.speedLimit)} km/h)`
                      : base;
                  }
                  return e.label || 'Unknown';
                })(),
                timestamp: e.eventTime || e.timestamp,
                location: e.address || '',
                eventCount: stats.incidents,
                driver: {
                  id: e.assetId,
                  name: e.driverName!,
                  safety_score_baseline: scoreBaseline,
                  incidents_last_30_days: stats.incidents,
                  improvement_trend: stats.trend,
                },
                vehicle: {
                  id: e.regNo || e.assetId,
                  type: 'truck',
                  last_maintenance: '',
                  make: vehicleRecord?.make || '',
                  model: vehicleRecord?.model || '',
                },
                environment: {
                  weather: 'Loading…',
                  traffic_density: 'moderate',
                  road_type: 'highway',
                },
                analysis: null,
                analysisLoading: true,
              };
            });

            setNotifications(prev => [...newNotifs, ...prev].slice(0, 10));

            toAnalyse.forEach(async e => {
              const stats = getDriverStats(e.driverName);
              const vehicleRecord = vehiclesRef.current.find(v => v.id === e.assetId?.toString() || v.regNo === e.regNo);
              const rawLat = e.latitude ?? vehicleRecord?.position?.latitude;
              const rawLng = e.longitude ?? vehicleRecord?.position?.longitude;
              const latitude = rawLat != null ? Number(rawLat) : null;
              const longitude = rawLng != null ? Number(rawLng) : null;

              const environment = await fetchIncidentEnvironment({
                latitude: latitude != null && !isNaN(latitude) ? latitude : null,
                longitude: longitude != null && !isNaN(longitude) ? longitude : null,
                address: e.address,
                timestamp: e.eventTime || e.timestamp,
              });

              setNotifications(prev =>
                prev.map(n => n.id === e.eventId ? { ...n, environment } : n)
              );

              const ref = lookupSafetyReference(e.label, e.type);
              const safetyReference = ref ? formatReferenceForPrompt(ref) : null;
              const analysis = await generateSafeIQAnalysis(e, stats.incidents, stats.trend, environment, safetyReference);
              setNotifications(prev =>
                prev.map(n => n.id === e.eventId ? { ...n, analysis, analysisLoading: false } : n)
              );
            });
          }
        }
    } catch {}
    finally { setEventsLoading(false); }
  }, [selectedSites]);

  const reloadEvents = useCallback(() => { loadEvents(); }, [loadEvents]);

  const loadHomeAlerts = useCallback(async () => {
    const url = buildHomeAlertsUrl(fleetScopeOpts(selectedSites, vehiclesRef.current as any));
    const cached = cachePeek<LogEntry[]>(url);
    if (cached) {
      setHomeAlerts(deriveAlerts(filterOverspeedEvents(cached)));
      setAlertsLoading(false);
    } else if (!homeAlertsRef.current?.length) {
      setAlertsLoading(true);
    }
    try {
      const data = await cachedFetchJson<LogEntry[]>(
        url,
        CACHE_TTL.fleetEvents,
        async () => {
          const res = await authFetch(url);
          if (!res.ok) return null;
          const payload = await res.json();
          return Array.isArray(payload) ? payload : payload?.entries ?? [];
        },
      );
      if (!data) return;
      setHomeAlerts(deriveAlerts(filterOverspeedEvents(data)));
    } catch { /* keep prior */ }
    finally { setAlertsLoading(false); }
  }, [selectedSites]);

  const loadDriverDistance = useCallback(async (force = false) => {
    const baseUrl = buildDriverDistanceUrl(distanceRange, distanceCustom);
    const url = appendUrlScope(
      `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}summary=1`,
      fleetScopeOpts(selectedSites, vehiclesRef.current as any),
    );
    const cached = force ? null : cachePeek<DriverDistanceSummary>(url);
    // Always paint the current URL's cache (or clear) so prior site totals never stick.
    setDriverDistance(cached);
    setDistanceLoading(!cached);
    try {
      const next = await authCachedJson<DriverDistanceSummary>(url, authFetch, {
        ttlMs: CACHE_TTL.pageRollup,
        force,
      });
      if (next) setDriverDistance(next);
    } catch { /* keep current-scope paint */ }
    finally {
      setDistanceLoading(false);
    }
  }, [distanceRange, distanceCustom, selectedSites]);

  const loadSafetyExposure = useCallback(async (force = false) => {
    const scopedQuery = scopeQueryFor(selectedSites, vehiclesRef.current);
    const curKey = safetySummaryUrl('30d') + scopedQuery;
    const prevKey = safetySummaryUrl('prev30d') + scopedQuery;
    const cachedCur = force ? null : cachePeek<FleetSafetyExposure>(curKey);
    const cachedPrev = force ? null : cachePeek<FleetSafetyExposure>(prevKey);
    setSafetyExposure(cachedCur);
    setSafetyExposurePrev(cachedPrev);
    setSafetyExposureLoading(!cachedCur);
    try {
      const [cur, prev] = await Promise.all([
        cachedFetchJson<FleetSafetyExposure>(
          curKey,
          CACHE_TTL.safetySummary,
          async () => {
            const res = await authFetch(curKey);
            if (!res.ok) return null;
            return res.json();
          },
          { force },
        ),
        cachedFetchJson<FleetSafetyExposure>(
          prevKey,
          CACHE_TTL.safetySummary,
          async () => {
            const res = await authFetch(prevKey);
            if (!res.ok) return null;
            return res.json();
          },
          { force },
        ),
      ]);
      if (cur) setSafetyExposure(cur);
      if (prev) setSafetyExposurePrev(prev);
    } catch { /* keep current-scope paint */ }
    finally {
      setSafetyExposureLoading(false);
    }
  }, [selectedSites]);

  const loadFuelSummary = useCallback(async (force = false) => {
    try {
      const url = appendUrlScope(
        '/api/fuel/consumption?period=week&trips=0&summary=1',
        fleetScopeOpts(selectedSites, vehiclesRef.current as any),
      );
      const cached = force ? null : cachePeek<{
        assets?: { totalFuelLiters?: number }[];
        summary?: { totalFuelLiters?: number };
      }>(url);
      if (!cached && !force) {
        setFuelSeries(DEFAULT_FUEL_SERIES);
      }
      const data = await authCachedJson<{
        assets?: { totalFuelLiters?: number }[];
        summary?: { totalFuelLiters?: number };
      }>(url, authFetch, { ttlMs: CACHE_TTL.fuelConsumption, force });
      if (!data) return;
      const assets = data.assets ?? [];
      const totalFuel = data.summary?.totalFuelLiters
        ?? assets.reduce((s, a) => s + (a.totalFuelLiters ?? 0), 0);
      const perDay = Math.round(totalFuel / 7);
      const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      setFuelSeries(days.map(day => ({ day, liters: perDay })));
    } catch { /* keep defaults */ }
  }, [selectedSites]);


  const loadEnvironment = useCallback(async () => {
    setEnvironment({ weather: 'Partly cloudy', traffic: 'Moderate', temp: '28°C' });
  }, []);

  /** Chevron-style: one shared HOS feed for home card + Fatigue page (today). */
  const loadHos = useCallback(async (force = false) => {
    const url = buildHosUrl();
    const cached = peekHos(url);
    const hasVisible = !!(cached?.records?.length || hosRecordsRef.current.length);
    if (cached?.records) {
      setHosRecords(cached.records);
      setHosLastTripDay(cached.lastTripDay ?? null);
      setHosLoading(false);
    } else if (!hasVisible) {
      setHosLoading(true);
    }
    try {
      const next = await fetchHosCached(url, { force });
      if (next) {
        setHosRecords(next.records ?? []);
        setHosLastTripDay(next.lastTripDay ?? null);
      }
    } catch { /* keep prior */ }
    finally { setHosLoading(false); }
  }, []);

  useEffect(() => {
    loadMetadata();
    loadVehicles();
    loadEnvironment();
    void loadHomeAlerts();
    // Paint live fleet first; defer heavy SQLite rollups so first paint stays snappy.
    const bootCancels: Array<() => void> = [];
    bootCancels.push(scheduleIdle(() => {
      void loadHos(false);
      void loadDriverDistance();
    }, 400));
    if (!bootTasksStartedRef.current) {
      bootTasksStartedRef.current = true;
      bootCancels.push(() => { bootTasksStartedRef.current = false; });
      bootCancels.push(scheduleIdle(() => {
        void loadEvents();
        void loadSafetyExposure();
        void loadFuelSummary();
      }, 900));
    } else {
      bootCancels.push(scheduleIdle(() => {
        void loadEvents();
        void loadSafetyExposure();
        void loadFuelSummary();
      }, 900));
    }
    const metaInterval = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void loadMetadata();
    }, 20_000);
    const vehicleInterval = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void loadVehicles();
    }, 20_000);
    const hosInterval = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      // TTL cache handles freshness — avoid force-busting HOS every 30s.
      void loadHos(false);
    }, 60_000);
    // Heavy rollups: ~60s + jitter so pages don't all hit SQLite together
    const stopEvents = startJitteredInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void loadEvents();
      void loadHomeAlerts();
    });
    const stopDistance = startJitteredInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void loadDriverDistance();
    });
    const stopExposure = startJitteredInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void loadSafetyExposure();
    });
    const stopFuel = startJitteredInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void loadFuelSummary();
    });
    return () => {
      bootCancels.forEach(cancel => cancel());
      clearInterval(metaInterval);
      clearInterval(vehicleInterval);
      clearInterval(hosInterval);
      stopEvents();
      stopDistance();
      stopExposure();
      stopFuel();
    };
  }, [loadMetadata, loadVehicles, loadEvents, loadHomeAlerts, loadDriverDistance, loadSafetyExposure, loadFuelSummary, loadEnvironment, loadHos, scheduleIdle]);

  useEffect(() => {
    void loadHomeAlerts();
    void loadEvents();
    void loadDriverDistance();
    void loadSafetyExposure();
    void loadFuelSummary();
  }, [selectedSites, vehicles.length, loadHomeAlerts, loadEvents, loadDriverDistance, loadSafetyExposure, loadFuelSummary]);

  // -- Global site/location filter ──────────────────────────────────────────
  // Site options are always derived from the FULL fleet so the selector stays
  // stable no matter which site is currently active.
  const siteOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const v of vehicles) {
      const key = siteKeyFor(v.zone);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([key, count]) => ({ key, label: key, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }, [vehicles]);

  /** Granular `site` field (transporter/depot names living *inside* a zone, e.g. DD WEST → TRULUCK, SHIWATECH…). */
  const siteNameOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const v of vehicles) {
      const key = (v.site || '').trim();
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([key, count]) => ({ key, label: key, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }, [vehicles]);

  const siteFilterActive = selectedSites.length > 0;

  const filteredVehicles = useMemo(() => {
    if (!siteFilterActive) return vehicles;
    const allowed = new Set(selectedSites.map(s => s.trim().toLowerCase()).filter(Boolean));
    return vehicles.filter(v => {
      const zone = ((v.zone || '').trim() || 'Unknown').toLowerCase();
      const site = (v.site || '').trim().toLowerCase();
      const transporter = (v.transporter || '').trim().toLowerCase();
      return allowed.has(zone) || allowed.has(site) || allowed.has(transporter);
    });
  }, [vehicles, selectedSites, siteFilterActive]);

  const scopedAssetIds = useMemo(
    () => (siteFilterActive ? scopedAssetIdList(filteredVehicles) : []),
    [siteFilterActive, filteredVehicles],
  );

  const filteredEvents = useMemo(() => {
    if (!siteFilterActive) return events;
    const ids = new Set(filteredVehicles.map(v => v.id?.toString()));
    const regs = new Set(filteredVehicles.map(v => v.regNo).filter(Boolean));
    return events.filter(e =>
      (e.assetId != null && ids.has(e.assetId.toString())) || (e.regNo != null && regs.has(e.regNo)),
    );
  }, [events, filteredVehicles, siteFilterActive]);

  // When sites are selected, recompute the status rollup from filtered vehicles
  // so Home status cards match; otherwise trust the server aggregate.
  const effectiveMetadata = useMemo<Metadata>(() => {
    if (!siteFilterActive) return metadata;
    const m: Metadata = { ...defaultMeta, totalVehicles: filteredVehicles.length, lastUpdate: metadata.lastUpdate };
    for (const v of filteredVehicles) {
      switch (v.status) {
        case 'Moving': m.moving++; break;
        case 'Idle': m.idle++; break;
        case 'Excessive Idle': m.excessiveIdle++; break;
        case 'Stationary': m.stationary++; break;
        case 'Parked': m.parked++; break;
        case 'Inactive': m.inactive++; break;
        case 'Offline': m.offline++; break;
        default: break;
      }
    }
    return m;
  }, [metadata, filteredVehicles, siteFilterActive]);

  const effectiveDriverDistance = useMemo<DriverDistanceSummary | null>(() => {
    if (!driverDistance || !siteFilterActive) return driverDistance;
    const rawAssets = driverDistance.assets || [];
    // summary=1 payloads omit per-asset rows; totals are already scoped by the fetch URL.
    if (rawAssets.length === 0) return driverDistance;
    const assets = filterDistanceAssetsByVehicles(rawAssets, filteredVehicles);
    const drivers = filterTripDriversByVehicles(driverDistance.drivers || [], filteredVehicles);
    return {
      ...driverDistance,
      totalDistanceKm: assets.reduce((sum, asset) => sum + (asset.totalDistanceKm || 0), 0),
      rawTripCount: assets.reduce((sum, asset) => sum + (asset.rawTripCount || 0), 0),
      journeyCount: assets.reduce((sum, asset) => sum + (asset.journeyCount || 0), 0),
      driverCount: drivers.length,
      assetCount: assets.length,
      assets,
      drivers,
    };
  }, [driverDistance, filteredVehicles, siteFilterActive]);

  const { score: fleetSafetyScore, delta: fleetScoreDelta } = useMemo(
    () => computeFleetScore(
      safetyExposure ?? { distanceKm: 0, hosHeldMinutes: 0, byLabel: {} },
      safetyExposurePrev,
      scoreConfig,
    ),
    [safetyExposure, safetyExposurePrev, scoreConfig],
  );
  const alerts = useMemo(
    () => homeAlerts ?? deriveAlerts(filteredEvents),
    [homeAlerts, filteredEvents],
  );
  const insights = useMemo(() => deriveInsights(filteredEvents, filteredVehicles), [filteredEvents, filteredVehicles]);
  const maintenance = DEFAULT_MAINTENANCE;
  const trips = DEMO_TRIPS;
  const totalDistanceKm = Math.round(effectiveDriverDistance?.totalDistanceKm ?? 0);

  const redAlertCount = SAFEIQ_ENABLED
    ? notifications.filter(
        n => n.analysis?.severity === 'RED' && isKnownDriver(n.driver.name),
      ).length
    : 0;

  const dismissNotification = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
    setSelectedNotification(prev => prev?.id === id ? null : prev);
  }, []);

  const clearAllNotifications = useCallback(() => {
    setNotifications([]);
    setSelectedNotification(null);
  }, []);

  const openNotification = useCallback((n: SafetyNotification) => setSelectedNotification(n), []);
  const closeNotification = useCallback(() => setSelectedNotification(null), []);

  const addVaultRecord = useCallback((r: VaultRecord) => {
    setVaultRecords(prev => {
      const next = [r, ...prev];
      localStorage.setItem('bpl_vault', JSON.stringify(next));
      return next;
    });
  }, []);

  const updateVaultRecord = useCallback((id: string, updates: Partial<VaultRecord>) => {
    setVaultRecords(prev => {
      const next = prev.map(r => r.id === id ? { ...r, ...updates, updatedAt: new Date().toISOString() } : r);
      localStorage.setItem('bpl_vault', JSON.stringify(next));
      return next;
    });
  }, []);

  const demoVehicles = useMemo(
    () => (DEMO_BRANDING ? filteredVehicles.map(sanitizeVehicle) : filteredVehicles),
    [filteredVehicles],
  );
  const demoEvents = useMemo(
    () => (DEMO_BRANDING ? filteredEvents.map(sanitizeLogEntry) : filteredEvents),
    [filteredEvents],
  );
  const demoDriverDistance = useMemo(
    () => sanitizeDriverDistance(effectiveDriverDistance),
    [effectiveDriverDistance],
  );
  const demoNotifications = useMemo(
    () => (DEMO_BRANDING ? notifications.map(sanitizeNotification) : notifications),
    [notifications],
  );
  const demoSelectedNotification = useMemo(
    () => (selectedNotification && DEMO_BRANDING
      ? sanitizeNotification(selectedNotification)
      : selectedNotification),
    [selectedNotification],
  );
  const demoVaultRecords = useMemo(
    () => (DEMO_BRANDING ? vaultRecords.map(sanitizeVaultRecord) : vaultRecords),
    [vaultRecords],
  );

  return (
    <FleetContext.Provider value={{
      authFetch, metadata: effectiveMetadata, vehicles: demoVehicles, events: demoEvents, driverDistance: demoDriverDistance,
      vehiclesLoading, eventsLoading, alertsLoading, distanceLoading,
      hosRecords, hosLoading, hosLastTripDay,
      safetyExposure, safetyExposureLoading,
      fleetSafetyScore, fleetScoreDelta,
      safetyScore: fleetSafetyScore,
      safetyDelta: fleetScoreDelta,
      alerts, maintenance, fuelSeries, insights, trips,
      distanceRange, setDistanceRange, distanceCustom, totalDistanceKm, environment,
      redAlertCount,
      notifications: demoNotifications, dismissNotification, clearAllNotifications, selectedNotification: demoSelectedNotification,
      openNotification, closeNotification,
      vaultRecords: demoVaultRecords, addVaultRecord, updateVaultRecord,
      theme, setTheme, isMobile, reloadEvents,
      scoreConfig, updateScoreConfig,
      selectedSites, setSelectedSites, toggleSite, siteOptions, siteNameOptions,
      siteLock, lockedTransporters, siteFilterActive, scopedAssetIds,
    }}>
      {children}
    </FleetContext.Provider>
  );
}

export function useFleet() {
  return useContext(FleetContext);
}
