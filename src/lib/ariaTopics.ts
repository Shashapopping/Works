/**
 * BPL Analyst answers and model-context sections for the on-demand datasets in ariaData.ts,
 * plus live vehicle lookups from the fleet list.
 */
import type { FleetVehicle } from '../context/FleetContext';
import type { AssessedDriver } from './driverAssessment';
import { certificateStatus } from './driverInterventions';
import type { AriaTopic, AriaWeatherSpot } from './ariaData';
import type { AriaSnapshot } from './ariaAssistant';

const BEST_DRIVER_MIN_KM = 100;
const FUEL_MIN_KM = 50;

const lagos = (iso: string | null | undefined, withTime = false): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return withTime
    ? d.toLocaleString('en-GB', { timeZone: 'Africa/Lagos', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('en-GB', { timeZone: 'Africa/Lagos' });
};
const num = (v: number | null | undefined, digits = 0) =>
  v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('en-GB', { maximumFractionDigits: digits, minimumFractionDigits: digits });

export function unavailable(snap: AriaSnapshot, topic: AriaTopic, page: string): string | null {
  return snap.extras?.failed.includes(topic)
    ? `Couldn't load ${topic} data just now — try again in a moment or check ${page}.`
    : null;
}

// ─── Drivers (30-day assessment, same as Driver Management) ───────────────────

export function assessedDrivers(snap: AriaSnapshot): AssessedDriver[] | null {
  const list = snap.extras?.drivers;
  return list && list.length ? list : null;
}

export function findAssessed(snap: AriaSnapshot, name: string): AssessedDriver | undefined {
  const n = name.trim().toLowerCase();
  return assessedDrivers(snap)?.find(d => d.name.trim().toLowerCase() === n || d.key.toLowerCase() === n);
}

export function assessedNames(snap: AriaSnapshot): string[] {
  return (assessedDrivers(snap) ?? []).map(d => d.name);
}

function countsText(d: AssessedDriver): string {
  const c = d.consequence.counts;
  const parts: Array<[string, number]> = [
    ['Overspeeding', c.overspeeding],
    ['Harsh braking', c.harshBraking],
    ['Harsh acceleration', c.harshAccel],
    ['Harsh cornering', c.cornering],
  ];
  return parts.filter(([, v]) => v > 0).map(([l, v]) => `${l}×${v}`).join(', ') || 'no scored events';
}

function standing(d: AssessedDriver): string {
  return `${d.consequence.categoryLabel}, score ${d.consequence.displayScore}/100`;
}

function warningText(snap: AriaSnapshot, d: AssessedDriver): string {
  const warnings = snap.extras?.warnings;
  if (!warnings) return '';
  const w = warnings.get(d.key) ?? warnings.get(d.name);
  if (!w) return ' No written warning on file.';
  return ` Last written warning ${lagos(w.createdAt)} by ${w.issuedByName}${w.disciplineBand ? ` (${w.disciplineBand} band)` : ''}.`;
}

export function worstDrivers(snap: AriaSnapshot, n: number): AssessedDriver[] {
  return (assessedDrivers(snap) ?? [])
    .filter(d => d.consequence.counts.eventCount > 0)
    .sort((a, b) => a.consequence.driverScore - b.consequence.driverScore
      || b.consequence.counts.eventCount - a.consequence.counts.eventCount)
    .slice(0, n);
}

export function bestDrivers(snap: AriaSnapshot, n: number): AssessedDriver[] {
  return (assessedDrivers(snap) ?? [])
    .filter(d => d.distanceKm >= BEST_DRIVER_MIN_KM)
    .sort((a, b) => b.consequence.driverScore - a.consequence.driverScore || b.distanceKm - a.distanceKm)
    .slice(0, n);
}

export function driverSummaryLine(d: AssessedDriver): string {
  return `${d.name} | ${standing(d)} | ${d.consequence.counts.eventCount} events (${countsText(d)}) | ${num(d.distanceKm)} km, ${d.journeyCount} journeys`;
}

export function answerAttentionAssessed(snap: AriaSnapshot, redLine: (name: string) => string): string | null {
  const ranked = worstDrivers(snap, 3);
  if (!ranked.length) return null;
  const [top, ...rest] = ranked;
  const next = rest.map(d => `${d.name} (${d.consequence.categoryLabel}, ${d.consequence.displayScore}/100)`).join(', ');
  return `**${top.name}** is the top priority over the last 30 days: **${standing(top)}** — ${top.consequence.counts.eventCount} events (${countsText(top)}) over ${num(top.distanceKm)} km.${warningText(snap, top)}${redLine(top.name)}${next ? ` Next in line: ${next}.` : ''}`;
}

export function answerBestAssessed(snap: AriaSnapshot): string | null {
  const ranked = bestDrivers(snap, 3);
  if (!ranked.length) return null;
  const [top, ...rest] = ranked;
  const eligible = (assessedDrivers(snap) ?? []).filter(d => d.distanceKm >= BEST_DRIVER_MIN_KM);
  const onTrack = eligible.filter(d => d.consequence.category === 'Green').length;
  const events = (d: AssessedDriver) => (d.consequence.counts.eventCount === 0 ? 'zero events' : `${d.consequence.counts.eventCount} events`);
  const next = rest.map(d => `${d.name} (${num(d.distanceKm)} km, ${events(d)})`).join(', ');
  return `**${top.name}** is the strongest driver over the last 30 days: **${num(top.distanceKm)} km** over ${top.journeyCount} journeys with **${events(top)}** (score ${top.consequence.displayScore}/100).${next ? ` Next: ${next}.` : ''} ${onTrack} of ${eligible.length} drivers with ≥${BEST_DRIVER_MIN_KM} km are On track.`;
}

export function namedDriverAssessed(snap: AriaSnapshot, name: string): string | null {
  const d = findAssessed(snap, name);
  if (!d) return null;
  return `**${d.name}** (last 30 days): **${standing(d)}** — ${d.consequence.counts.eventCount} events (${countsText(d)}) over ${num(d.distanceKm)} km, ${d.journeyCount} journeys. Recommended: ${d.consequence.recommendedConsequence}.${warningText(snap, d)}`;
}

// ─── Vehicles (live fleet list) ───────────────────────────────────────────────

const normReg = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

export function mentionedVehicle(question: string, vehicles: FleetVehicle[] = []): FleetVehicle | undefined {
  const q = normReg(question);
  let best: FleetVehicle | undefined;
  for (const v of vehicles) {
    const reg = normReg(v.regNo || '');
    if (reg.length >= 5 && q.includes(reg) && (!best || reg.length > normReg(best.regNo).length)) best = v;
  }
  return best;
}

function vehicleSpeed(v: FleetVehicle): number | null {
  const speed = (v.position as unknown as { speed?: number } | undefined)?.speed;
  return typeof speed === 'number' && Number.isFinite(speed) ? speed : null;
}

export function vehicleLine(v: FleetVehicle): string {
  const speed = vehicleSpeed(v);
  const fuel = v.fuelLevel?.level;
  return [
    v.regNo,
    v.status,
    [v.site, v.zone].filter(s => s && s !== 'Unknown').join(' / ') || 'site unknown',
    v.address && v.address !== '—' ? v.address : 'no location',
    speed != null ? `${Math.round(speed)} km/h` : null,
    fuel != null ? `fuel ${num(fuel)}` : null,
    v.date ? `updated ${lagos(v.date, true)}` : null,
  ].filter(Boolean).join(' | ');
}

const STATUS_WORDS: Array<[RegExp, string[]]> = [
  [/excessive(ly)? idl/, ['excessive idle']],
  [/\bidl/, ['idle', 'excessive idle']],
  [/\bpark/, ['parked']],
  [/\bmoving|on the move|driving now/, ['moving']],
  [/\binactive/, ['inactive']],
  [/\boffline/, ['offline']],
  [/\bstationary|stopped/, ['stationary']],
];

export function vehicleStatusFilter(question: string): string[] | null {
  const q = question.toLowerCase();
  if (!/truck|vehicle|asset|fleet|which|how many|list/.test(q)) return null;
  for (const [re, statuses] of STATUS_WORDS) if (re.test(q)) return statuses;
  return null;
}

export function answerVehicle(question: string, snap: AriaSnapshot): string | null {
  const vehicles = snap.vehicles ?? [];
  const v = mentionedVehicle(question, vehicles);
  if (v) {
    const warn = (v.warnings ?? []).slice(0, 3).map(w => `${w.label} ${lagos(w.eventTime || w.timestamp, true)}`).join('; ');
    return `**${v.regNo}** (${v.assetName || v.transporter}): ${vehicleLine(v).split(' | ').slice(1).join(' · ')}.${warn ? ` Recent warnings: ${warn}.` : ''}${v.panic ? ' **Panic active.**' : ''}`;
  }
  const statuses = vehicleStatusFilter(question);
  if (!statuses) return null;
  const hits = vehicles.filter(x => statuses.includes((x.status || '').toLowerCase()));
  const scope = snap.siteLabel ? ` in ${snap.siteLabel}` : '';
  if (!hits.length) return `No vehicles are ${statuses.join(' or ')}${scope} right now.`;
  const lines = hits.slice(0, 8).map(x => `- ${x.regNo} | ${x.site || x.zone || '—'} | ${x.address && x.address !== '—' ? x.address : 'no location'}`);
  const more = hits.length > 8 ? `\n\n…and ${hits.length - 8} more.` : '';
  return `**${hits.length}** vehicles ${statuses.join(' / ')}${scope} right now:\n\n${lines.join('\n')}${more}`;
}

// ─── Fuel (week) ──────────────────────────────────────────────────────────────

export function answerFuel(question: string, snap: AriaSnapshot): string | null {
  const fuel = snap.extras?.fuel;
  if (!fuel) return unavailable(snap, 'fuel', 'Fuel Consumption');
  const period = `${lagos(fuel.period?.start)}–${lagos(fuel.period?.end)}`;
  const v = mentionedVehicle(question, snap.vehicles);
  if (v) {
    const row = fuel.assets?.find(a => a.assetId === v.id || normReg(a.regNo || '') === normReg(v.regNo));
    if (!row) return `No fuel records for **${v.regNo}** this week (${period}).`;
    return `**${row.regNo}** this week (${period}): **${num(row.periodFuelLiters || row.totalFuelLiters)} L** over ${num(row.totalDistanceKm)} km${row.litersPerKm != null ? ` (${num(row.litersPerKm * 100, 1)} L/100 km)` : ''}, ${row.tripCount} trips, ${row.refuelCount} refuels (${num(row.refuelLiters)} L).`;
  }
  const s = fuel.summary;
  const per100 = s && s.totalDistanceKm > 0 ? (s.totalFuelLiters / s.totalDistanceKm) * 100 : null;
  const thirsty = (fuel.assets ?? [])
    .filter(a => a.totalDistanceKm >= FUEL_MIN_KM && a.litersPerKm != null)
    .sort((a, b) => (b.litersPerKm ?? 0) - (a.litersPerKm ?? 0))
    .slice(0, 3)
    .map(a => `- ${a.regNo} | ${num((a.litersPerKm ?? 0) * 100, 1)} L/100 km | ${num(a.totalFuelLiters)} L over ${num(a.totalDistanceKm)} km`);
  const head = s
    ? `Fuel this week (${period}): **${num(s.totalFuelLiters)} L** over ${num(s.totalDistanceKm)} km${per100 != null ? ` (**${num(per100, 1)} L/100 km** fleet average)` : ''}, ${num(s.refuelCount ?? 0)} refuels.`
    : `Fuel this week (${period}):`;
  return thirsty.length ? `${head}\n\nHighest consumption (≥${FUEL_MIN_KM} km):\n${thirsty.join('\n')}` : head;
}

// ─── Utilization (week) ───────────────────────────────────────────────────────

export function answerUtilization(question: string, snap: AriaSnapshot): string | null {
  const util = snap.extras?.utilization;
  if (!util) return unavailable(snap, 'utilization', 'Utilization');
  const s = util.summary;
  const v = mentionedVehicle(question, snap.vehicles);
  if (v) {
    const row = util.assets?.find(a => a.assetId === v.id || normReg(a.regNo || '') === normReg(v.regNo));
    if (!row) return `No utilization records for **${v.regNo}** this week.`;
    return `**${row.regNo}** this week: **${num(row.utilizationPct, 0)}% utilized**, ${num(row.engineHours, 1)} engine h (${num(row.drivingHours, 1)} driving, ${num(row.idleHours, 1)} idle), ${row.tripCount} trips, ${num(row.distanceKm)} km.`;
  }
  const assets = util.assets ?? [];
  const low = assets
    .filter(a => a.utilizationPct != null)
    .sort((a, b) => (a.utilizationPct ?? 0) - (b.utilizationPct ?? 0))
    .slice(0, 3)
    .map(a => `${a.regNo} ${num(a.utilizationPct)}%`);
  const idle = [...assets].sort((a, b) => b.idleHours - a.idleHours).slice(0, 3).filter(a => a.idleHours > 0)
    .map(a => `${a.regNo} ${num(a.idleHours, 1)} h`);
  const active = s.fleetAssetCount ? ` ${s.assetsWithTrips ?? s.assetCount} of ${s.fleetAssetCount} vehicles ran trips.` : '';
  return `Utilization this week (${lagos(util.period.start)}–${lagos(util.period.end)}): **${num(s.avgUtilizationPct)}%** average, availability ${num(s.avgAvailabilityPct)}%. ${num(s.totalEngineHours)} engine hours — ${num(s.totalDrivingHours)} driving, **${num(s.totalIdleHours)} idle** — over ${num(s.totalDistanceKm)} km.${active}${low.length ? `\n\n- Lowest utilization: ${low.join(', ')}` : ''}${idle.length ? `\n- Most idle: ${idle.join(', ')}` : ''}`;
}

// ─── Trends (30 days) ─────────────────────────────────────────────────────────

function sumByLabel(buckets: { byLabel: Record<string, number> }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const b of buckets) for (const [l, c] of Object.entries(b.byLabel || {})) out[l] = (out[l] || 0) + c;
  return out;
}

function pctChange(cur: number, prev: number): string {
  if (prev === 0) return cur === 0 ? 'flat' : 'new';
  const p = Math.round(((cur - prev) / prev) * 100);
  return `${p >= 0 ? '+' : ''}${p}%`;
}

export function answerTrends(snap: AriaSnapshot): string | null {
  const t = snap.extras?.trends;
  if (!t) return unavailable(snap, 'trends', 'Incident Intelligence');
  const buckets = [...t.buckets].sort((a, b) => a.dayKey.localeCompare(b.dayKey));
  if (!buckets.length) return 'No scored events in the last 30 days for the current view.';
  const total = buckets.reduce((s, b) => s + b.total, 0);
  // Buckets only exist for days with events, so window by date, not by position.
  const lagosDayKey = (daysBack: number) => new Date(Date.now() + 3_600_000 - daysBack * 86_400_000).toISOString().slice(0, 10);
  const weekStart = lagosDayKey(6);
  const prevStart = lagosDayKey(13);
  const last7 = buckets.filter(b => b.dayKey >= weekStart);
  const prev7 = buckets.filter(b => b.dayKey >= prevStart && b.dayKey < weekStart);
  const cur = last7.reduce((s, b) => s + b.total, 0);
  const prev = prev7.reduce((s, b) => s + b.total, 0);
  const curL = sumByLabel(last7);
  const prevL = sumByLabel(prev7);
  const labels = Object.keys({ ...curL, ...prevL })
    .sort((a, b) => (curL[b] || 0) - (curL[a] || 0))
    .slice(0, 4)
    .map(l => `- ${l}: ${curL[l] || 0} vs ${prevL[l] || 0} (${pctChange(curL[l] || 0, prevL[l] || 0)})`);
  const peak = buckets.reduce((m, b) => (b.total > m.total ? b : m), buckets[0]);
  return `**${total}** scored events in the last 30 days. Last 7 days: **${cur}** vs ${prev} the week before (**${pctChange(cur, prev)}**). Peak day ${lagos(peak.dayKey)} with ${peak.total}.\n\n${labels.join('\n')}`;
}

// ─── Trips (last 24 h) ────────────────────────────────────────────────────────

export function answerTrips(snap: AriaSnapshot): string | null {
  const all = snap.extras?.trips;
  if (!all) return unavailable(snap, 'trips', 'Journey Management');
  const since = Date.now() - 86_400_000;
  const trips = all.filter(t => Date.parse(t.TripStart || '') >= since);
  if (!trips.length) return 'No completed trips synced in the last 24 hours for the current view.';
  const regById = new Map((snap.vehicles ?? []).map(v => [String(v.id), v.regNo]));
  const nameById = new Map((snap.driverDistance?.drivers ?? []).filter(d => d.driverId).map(d => [String(d.driverId), d.driverName]));
  const km = trips.reduce((s, t) => s + (t.DistanceKilometers || 0), 0);
  const vehiclesOut = new Set(trips.map(t => String(t.AssetId ?? ''))).size;
  const latest = trips.reduce((m, t) => ((t.TripEnd || '') > m ? t.TripEnd || '' : m), '');
  const longest = [...trips]
    .sort((a, b) => (b.DistanceKilometers || 0) - (a.DistanceKilometers || 0))
    .slice(0, 3)
    .map(t => `- ${regById.get(String(t.AssetId)) || t.AssetId} | ${nameById.get(String(t.DriverId)) || 'driver unknown'} | ${num(t.DistanceKilometers)} km | ${lagos(t.TripStart, true)}${t.MaxSpeedKilometersPerHour ? ` | max ${Math.round(t.MaxSpeedKilometersPerHour)} km/h` : ''}`);
  return `**${trips.length}** completed trips in the last 24 hours across **${vehiclesOut}** vehicles, ${num(km)} km. Latest synced trip ended ${lagos(latest, true)}.\n\nLongest:\n${longest.join('\n')}`;
}

// ─── Certificates (stored on this browser) ────────────────────────────────────

export function answerCertificates(snap: AriaSnapshot): string {
  const certs = snap.extras?.certificates ?? [];
  if (!certs.length) return 'No driver certificates have been uploaded on this browser — add them on the Certificates page.';
  const rated = certs.map(c => ({ c, s: certificateStatus(c.expiryDate) }));
  const expired = rated.filter(r => r.s.status === 'Expired');
  const soon = rated.filter(r => r.s.status === 'Expiring Soon');
  const list = [...expired, ...soon]
    .sort((a, b) => (a.s.daysLeft ?? 0) - (b.s.daysLeft ?? 0))
    .slice(0, 5)
    .map(({ c, s }) => `- ${c.driverName} | ${c.certType} | ${s.status === 'Expired' ? `expired ${Math.abs(s.daysLeft ?? 0)} days ago` : `expires in ${s.daysLeft} days`}`);
  return `**${expired.length}** expired and **${soon.length}** expiring within 30 days, out of ${certs.length} certificates.${list.length ? `\n\n${list.join('\n')}` : ''}`;
}

// ─── Weather + traffic (live, Open-Meteo / TomTom) ───────────────────────────

function weatherSpotLine(s: AriaWeatherSpot): string {
  const e = s.env;
  const where = s.assetCount != null ? `${s.label} (${s.assetCount} assets)` : s.label;
  if (e.weather_error && !e.weather_condition) return `- ${where} | weather unavailable | ${e.traffic_description || `${e.traffic_density} traffic`}`;
  const cond = e.weather_condition || e.weather?.split(' · ')[0] || 'Unknown';
  const temp = e.temperature_c != null ? ` ${Math.round(e.temperature_c)}°C` : '';
  const humid = e.humidity_pct != null && e.humidity_pct >= 70 ? `, humidity ${Math.round(e.humidity_pct)}%` : '';
  const rain = e.precipitation_mm ? `, ${e.precipitation_mm} mm rain` : '';
  const traffic = e.traffic_description || `${e.traffic_density} traffic`;
  const estimated = e.environment_source?.traffic === 'heuristic' ? ' (estimated)' : '';
  return `- ${where} | ${cond}${temp}${humid}${rain} | ${traffic}${estimated}`;
}

const WET = /rain|drizzle|shower|thunder|storm/i;

export function answerWeather(snap: AriaSnapshot): string | null {
  const spots = snap.extras?.weather;
  if (!spots) return unavailable(snap, 'weather', 'the Home page weather strip');
  if (!spots.length) return 'No live vehicle positions to check weather at for the current view.';
  const wet = spots.filter(s => WET.test(s.env.weather_condition || s.env.weather || ''));
  const heavy = spots.filter(s => s.env.traffic_density === 'heavy');
  const notes = [
    wet.length ? `Wet roads at ${wet.map(s => s.label).join(', ')} — remind drivers about braking distance and speed.` : '',
    heavy.length ? `Heavy traffic at ${heavy.map(s => s.label).join(', ')} — expect delays.` : '',
  ].filter(Boolean).join(' ');
  const head = spots.length === 1 && spots[0].assetCount == null
    ? `Live conditions at **${spots[0].label}**:`
    : 'Live conditions where the fleet is right now:';
  return `${head}\n\n${spots.map(weatherSpotLine).join('\n')}${notes ? `\n\n${notes}` : ''}`;
}

// ─── Model context ────────────────────────────────────────────────────────────

/** Compact sections for whatever on-demand data was loaded for this question. */
export function topicContextSections(question: string, snap: AriaSnapshot, named: string | null): string[] {
  const out: string[] = [];
  const x = snap.extras;
  const v = mentionedVehicle(question, snap.vehicles);
  if (v) out.push('=== VEHICLE ===', `  ${vehicleLine(v)}`);

  if (x?.drivers?.length) {
    const d = named ? findAssessed(snap, named) : undefined;
    if (d) {
      out.push(`=== DRIVER ${d.name} — 30 DAYS ===`, `  ${driverSummaryLine(d)}${warningText(snap, d)}`);
    } else {
      out.push('=== HIGHEST RISK DRIVERS (30d, Driver Management scoring) ===');
      out.push(worstDrivers(snap, 3).map(r => `  ${driverSummaryLine(r)}${warningText(snap, r)}`).join('\n') || '  None');
      out.push(`=== BEST DRIVERS (30d, ≥${BEST_DRIVER_MIN_KM} km) ===`);
      out.push(bestDrivers(snap, 3).map(r => `  ${driverSummaryLine(r)}`).join('\n') || '  None');
    }
  }
  if (x?.trends) out.push('=== TRENDS ===', ...(answerTrends(snap) ?? '').replace(/\*\*/g, '').split('\n').filter(Boolean).map(l => `  ${l}`));
  if (x?.fuel) out.push('=== FUEL ===', ...(answerFuel(question, snap) ?? '').replace(/\*\*/g, '').split('\n').filter(Boolean).map(l => `  ${l}`));
  if (x?.utilization) out.push('=== UTILIZATION ===', ...(answerUtilization(question, snap) ?? '').replace(/\*\*/g, '').split('\n').filter(Boolean).map(l => `  ${l}`));
  if (x?.trips) out.push('=== TRIPS 24H ===', ...(answerTrips(snap) ?? '').replace(/\*\*/g, '').split('\n').filter(Boolean).map(l => `  ${l}`));
  if (x?.certificates) out.push('=== CERTIFICATES ===', ...answerCertificates(snap).replace(/\*\*/g, '').split('\n').filter(Boolean).map(l => `  ${l}`));
  if (x?.weather?.length) out.push('=== LIVE WEATHER + TRAFFIC ===', ...x.weather.map(s => `  ${weatherSpotLine(s).slice(2)}`));
  if (x?.failed.length) out.push(`(Not available right now: ${x.failed.join(', ')})`);
  return out;
}
