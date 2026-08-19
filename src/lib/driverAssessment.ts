/**
 * Canonical driver consequence assessment — same inputs the Drivers page uses.
 * Score is all-time (all events in the live log), with trip km from
 * current month + last month. Home and Driver Management must call this.
 */
import type { LogEntry, TripDriver } from '../context/FleetContext';
import { isActiveDriver, isActiveDriverId } from './driverUtils';
import { sanitizeTripDriver } from './demoSanitize';
import { buildDriverConsequenceCard, countPenaltyEvents, type ConsequenceCard } from './consequenceScore';
import { calendarPeriodBounds, customRangeToIsoBounds, toLocalDateValue } from './dateRange';

export const HIDDEN_ASSESSMENT_LABELS = [
  'Possible Power Tamper',
  'Battery Disconnection',
  'Battery Disconnected',
  'Front Panel Tamper',
  'Back Panel Tamper',
  'No Blue Key',
];

export interface AssessedDriver {
  key: string;
  name: string;
  phone: string;
  assetName: string;
  regNo: string;
  transporter: string;
  harshBraking: number;
  harshAccel: number;
  overspeeding: number;
  cornering: number;
  total: number;
  distanceKm: number;
  drivingTimeSeconds: number;
  journeyCount: number;
  consequence: ConsequenceCard;
  events: LogEntry[];
}

export function assessmentDriverKey(driverId?: string | null, driverName?: string | null): string {
  return (driverId && isActiveDriverId(driverId)) ? driverId : (driverName || '');
}

function emptyProfile(key: string, name: string, phone = 'N/A'): Omit<AssessedDriver, 'consequence'> & { consequence?: ConsequenceCard } {
  return {
    key, name, phone,
    assetName: '—', regNo: '—', transporter: '—',
    harshBraking: 0, harshAccel: 0, overspeeding: 0, cornering: 0, total: 0,
    distanceKm: 0,
    drivingTimeSeconds: 0,
    journeyCount: 0,
    events: [],
  };
}

function applyEvent(d: AssessedDriver, e: LogEntry, label: string) {
  if (e.type === 'panic') return;
  d.events.push(e);
  if (label === 'Harsh Braking') { d.harshBraking++; d.total++; }
  else if (label === 'Harsh Acceleration') { d.harshAccel++; d.total++; }
  else if (label === 'Overspeeding' || label === 'Overspeed Tiered') { d.overspeeding++; d.total++; }
  else if (label === 'Harsh Cornering') { d.cornering++; d.total++; }
  if (e.assetName && e.assetName !== 'N/A') d.assetName = e.assetName;
  if (e.regNo && e.regNo !== 'N/A') d.regNo = e.regNo;
  if (e.transporter && e.transporter !== 'N/A') d.transporter = e.transporter;
  if (e.driverPhone && e.driverPhone !== 'N/A') d.phone = e.driverPhone;
}

export function mergeAssessmentTripDrivers(batches: TripDriver[][]): TripDriver[] {
  const map = new Map<string, TripDriver>();
  for (const batch of batches) {
    for (const d of batch) {
      if (!isActiveDriver(d.driverName, d.driverId)) continue;
      const key = assessmentDriverKey(d.driverId, d.driverName);
      if (!key) continue;
      const prev = map.get(key);
      if (!prev) {
        map.set(key, sanitizeTripDriver({
          ...d,
          totalDrivingTimeSeconds: d.totalDrivingTimeSeconds || 0,
        }));
      } else {
        prev.totalDistanceKm += d.totalDistanceKm;
        prev.journeyCount += d.journeyCount;
        prev.totalDrivingTimeSeconds = (prev.totalDrivingTimeSeconds || 0) + (d.totalDrivingTimeSeconds || 0);
        prev.vehicles = Array.from(new Set([...(prev.vehicles || []), ...(d.vehicles || [])]));
      }
    }
  }
  return Array.from(map.values());
}

/** All-time consequence score — same derivation as Driver Management. */
export function assessDrivers(events: LogEntry[], tripDrivers: TripDriver[]): AssessedDriver[] {
  const map = new Map<string, ReturnType<typeof emptyProfile>>();
  const distanceByKey = new Map<string, number>();
  const drivingByKey = new Map<string, number>();
  const journeysByKey = new Map<string, number>();

  const ensure = (key: string, name: string, phone?: string) => {
    if (!map.has(key)) map.set(key, emptyProfile(key, name, phone || 'N/A'));
    return map.get(key)!;
  };

  const addTripStats = (key: string, t: TripDriver) => {
    if (!key) return;
    distanceByKey.set(key, (distanceByKey.get(key) || 0) + (t.totalDistanceKm || 0));
    drivingByKey.set(key, (drivingByKey.get(key) || 0) + (t.totalDrivingTimeSeconds || 0));
    journeysByKey.set(key, (journeysByKey.get(key) || 0) + (t.journeyCount || 0));
  };

  tripDrivers.forEach(t => {
    if (!isActiveDriver(t.driverName, t.driverId)) return;
    const key = assessmentDriverKey(t.driverId, t.driverName);
    if (!key) return;
    const d = ensure(key, t.driverName, t.driverPhone);
    if (t.vehicles?.[0]) d.regNo = t.vehicles[0];
    addTripStats(key, t);
    const nameKey = (t.driverName || '').trim();
    if (nameKey && nameKey !== key) addTripStats(nameKey, t);
  });

  events.forEach(e => {
    if (e.type === 'panic') return;
    const label = e.label || '';
    if (HIDDEN_ASSESSMENT_LABELS.includes(label)) return;
    if (!isActiveDriver(e.driverName, e.driverId)) return;
    const key = assessmentDriverKey(e.driverId, e.driverName);
    if (!key) return;
    const d = ensure(key, e.driverName!, e.driverPhone);
    if (e.assetName && e.assetName !== 'N/A') d.assetName = e.assetName;
    if (e.regNo && e.regNo !== 'N/A') d.regNo = e.regNo;
    if (e.transporter && e.transporter !== 'N/A') d.transporter = e.transporter;
    applyEvent(d as AssessedDriver, e, label);
  });

  for (const d of map.values()) {
    if ((distanceByKey.get(d.key) || 0) > 0) continue;
    const nameKey = (d.name || '').trim();
    if (!nameKey || nameKey === d.key) continue;
    const km = distanceByKey.get(nameKey);
    if (!(km > 0)) continue;
    distanceByKey.set(d.key, km);
    drivingByKey.set(d.key, drivingByKey.get(nameKey) || 0);
    journeysByKey.set(d.key, journeysByKey.get(nameKey) || 0);
  }

  return Array.from(map.values())
    .map(d => {
      const distanceKm = distanceByKey.get(d.key) || 0;
      const drivingTimeSeconds = drivingByKey.get(d.key) || 0;
      const journeyCount = journeysByKey.get(d.key) || 0;
      const consequence = buildDriverConsequenceCard({
        events: d.events,
        distanceKm,
      });
      return {
        ...d,
        distanceKm,
        drivingTimeSeconds,
        journeyCount,
        harshBraking: consequence.counts.harshBraking,
        harshAccel: consequence.counts.harshAccel,
        overspeeding: consequence.counts.overspeeding,
        cornering: consequence.counts.cornering,
        total: consequence.counts.eventCount,
        consequence,
      } as AssessedDriver;
    })
    .sort((a, b) => a.consequence.displayScore - b.consequence.displayScore || a.consequence.driverScore - b.consequence.driverScore);
}

function lastEventMs(d: AssessedDriver): number {
  let latest = 0;
  d.events.forEach(e => {
    const t = new Date(e.eventTime || e.timestamp).getTime();
    if (Number.isFinite(t) && t > latest) latest = t;
  });
  return latest;
}

/** Home card: mix of good / mixed / poor, preferring recently updated drivers. Score is unchanged. */
export function pickHomeDriverMix(drivers: AssessedDriver[], limit = 12): AssessedDriver[] {
  const withTime = drivers.map(d => ({ d, score: d.consequence.displayScore, lastMs: lastEventMs(d) }));
  const byLatest = (a: typeof withTime[number], b: typeof withTime[number]) => b.lastMs - a.lastMs || b.score - a.score;
  const bands = [
    withTime.filter(r => r.score >= 80).sort(byLatest),
    withTime.filter(r => r.score >= 60 && r.score < 80).sort(byLatest),
    withTime.filter(r => r.score >= 45 && r.score < 60).sort(byLatest),
    withTime.filter(r => r.score < 45).sort(byLatest),
  ];
  const quotas = [4, 3, 2, 3];
  const picked: AssessedDriver[] = [];
  const used = new Set<string>();

  bands.forEach((band, i) => {
    band.slice(0, quotas[i]).forEach(row => {
      if (picked.length >= limit || used.has(row.d.key)) return;
      picked.push(row.d);
      used.add(row.d.key);
    });
  });

  withTime.slice().sort(byLatest).forEach(row => {
    if (picked.length >= limit || used.has(row.d.key)) return;
    picked.push(row.d);
    used.add(row.d.key);
  });

  return picked.sort((a, b) => lastEventMs(b) - lastEventMs(a));
}

export function latestEventIso(d: AssessedDriver): string | null {
  const ms = lastEventMs(d);
  return ms > 0 ? new Date(ms).toISOString() : null;
}

export type DriverPeriod = 'today' | '7days' | '30days' | 'alltime' | 'custom';

export function defaultDriverCustomRange() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 6);
  return { from: toLocalDateValue(from), to: toLocalDateValue(to) };
}

export function driverPeriodBounds(
  period: DriverPeriod,
  custom?: { from: string; to: string },
): { fromMs: number; toMs: number } | null {
  if (period === 'alltime') return null;
  if (period === 'custom' && custom?.from && custom?.to) {
    const iso = customRangeToIsoBounds(custom.from, custom.to);
    if (!iso) return null;
    return { fromMs: new Date(iso.from).getTime(), toMs: new Date(iso.to).getTime() };
  }
  const key = period === 'today' ? 'today' : period === '7days' ? '7days' : '30days';
  const b = calendarPeriodBounds(key);
  return { fromMs: b.fromMs, toMs: b.toMs };
}

export function eventsInDriverPeriod(
  events: LogEntry[],
  period: DriverPeriod,
  custom?: { from: string; to: string },
) {
  const bounds = driverPeriodBounds(period, custom);
  if (!bounds) return events;
  return events.filter(e => {
    const t = new Date(e.eventTime || e.timestamp).getTime();
    return Number.isFinite(t) && t >= bounds.fromMs && t <= bounds.toMs;
  });
}

/** URL for km/HOS in the selected window. `assessment` = current + last month (All). */
export function periodDistanceSpec(
  period: DriverPeriod,
  custom?: { from: string; to: string },
): { kind: 'assessment' } | { kind: 'url'; url: string } {
  if (period === 'alltime') return { kind: 'assessment' };
  if (period === 'custom' && custom?.from && custom?.to) {
    return {
      kind: 'url',
      url: `/api/driver-distance?from=${encodeURIComponent(custom.from)}&to=${encodeURIComponent(custom.to)}&trips=0`,
    };
  }
  if (period === 'today') return { kind: 'url', url: '/api/driver-distance?range=today&trips=0' };
  if (period === '7days') return { kind: 'url', url: '/api/driver-distance?range=7d&trips=0' };
  return { kind: 'url', url: '/api/driver-distance?range=30d&trips=0' };
}

export function tripStatsByDriverKey(tripDrivers: TripDriver[]) {
  const map = new Map<string, { km: number; drivingTimeSeconds: number; journeyCount: number }>();
  const add = (key: string, t: TripDriver) => {
    if (!key) return;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, {
        km: t.totalDistanceKm || 0,
        drivingTimeSeconds: t.totalDrivingTimeSeconds || 0,
        journeyCount: t.journeyCount || 0,
      });
    } else {
      prev.km += t.totalDistanceKm || 0;
      prev.drivingTimeSeconds += t.totalDrivingTimeSeconds || 0;
      prev.journeyCount += t.journeyCount || 0;
    }
  };
  tripDrivers.forEach(t => {
    const key = assessmentDriverKey(t.driverId, t.driverName);
    add(key, t);
    const nameKey = (t.driverName || '').trim();
    if (nameKey && nameKey !== key) add(nameKey, t);
  });
  return map;
}

export function periodCardStats(
  driver: AssessedDriver,
  period: DriverPeriod,
  custom: { from: string; to: string } | undefined,
  periodTrips: Map<string, { km: number; drivingTimeSeconds: number; journeyCount: number }>,
) {
  const windowed = eventsInDriverPeriod(driver.events, period, custom);
  const counts = countPenaltyEvents(windowed);
  const trip = periodTrips.get(driver.key)
    || periodTrips.get((driver.name || '').trim());
  return {
    events: windowed,
    eventCount: counts.eventCount,
    harshBraking: counts.harshBraking,
    harshAccel: counts.harshAccel,
    overspeeding: counts.overspeeding,
    cornering: counts.cornering,
    km: trip?.km ?? 0,
    drivingTimeSeconds: trip?.drivingTimeSeconds ?? 0,
    journeyCount: trip?.journeyCount ?? 0,
  };
}
