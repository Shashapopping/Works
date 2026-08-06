import type { LogEntry } from '../context/FleetContext';

export const DURATION_SERIES = [
  {
    key: 'overspeed',
    legend: 'Over speeding',
    color: '#368DDD',
    labels: ['Overspeeding', 'Overspeed Tiered'],
  },
  {
    key: 'idle',
    legend: 'Idle - excessive',
    color: '#50B2E1',
    labels: ['Idle - Excessive', 'Excessive Idle', 'Idle'],
  },
  {
    key: 'harshBrake',
    legend: 'Harsh braking',
    color: '#58B06D',
    labels: ['Harsh Braking'],
  },
  {
    key: 'harshAccel',
    legend: 'Harsh acceleration',
    color: '#F0AD4E',
    labels: ['Harsh Acceleration'],
  },
] as const;

export type DurationSeriesKey = (typeof DURATION_SERIES)[number]['key'];

/** Merge gap for consecutive same-asset pings that form one duration episode. */
const MERGE_GAP_MS = 90_000;
/** Instant events (harsh brake/accel) still count a brief duration when alone. */
const POINT_FLOOR_SEC = 2;

function seriesKeyForLabel(label: string): DurationSeriesKey | null {
  for (const s of DURATION_SERIES) {
    if ((s.labels as readonly string[]).includes(label)) return s.key;
  }
  return null;
}

function dayKeyLagos(iso: string) {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' }); // YYYY-MM-DD
}

function dayLabelLagos(isoDay: string) {
  const d = new Date(`${isoDay}T12:00:00Z`);
  return d.toLocaleDateString('en-GB', { timeZone: 'Africa/Lagos', weekday: 'short', day: '2-digit', month: 'short' });
}

/** Format seconds as MiX-style HH:MM:SS */
export function formatDurationHms(totalSeconds: number) {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

interface Episode {
  seriesKey: DurationSeriesKey;
  day: string;
  durationSec: number;
}

/**
 * Build duration episodes by clustering consecutive same-asset / same-series events.
 * MiX library poll often emits overspeed as a stream of points without EndDateTime;
 * clustering recovers an approximate episode length.
 */
export function buildDurationEpisodes(events: LogEntry[]): Episode[] {
  type Point = { t: number; day: string; seriesKey: DurationSeriesKey; assetId: string };
  const points: Point[] = [];

  for (const e of events) {
    if (e.type === 'panic') continue;
    const label = e.label || '';
    const seriesKey = seriesKeyForLabel(label);
    if (!seriesKey) continue;
    const iso = e.eventTime || e.timestamp;
    if (!iso) continue;
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) continue;
    points.push({
      t,
      day: dayKeyLagos(iso),
      seriesKey,
      assetId: (e.assetId || 'unknown').toString(),
    });
  }

  points.sort((a, b) => a.t - b.t || a.assetId.localeCompare(b.assetId));

  const episodes: Episode[] = [];
  const open = new Map<string, { start: number; end: number; day: string; seriesKey: DurationSeriesKey }>();

  const flush = (key: string) => {
    const cur = open.get(key);
    if (!cur) return;
    const durationSec = Math.max(POINT_FLOOR_SEC, (cur.end - cur.start) / 1000);
    episodes.push({ seriesKey: cur.seriesKey, day: cur.day, durationSec });
    open.delete(key);
  };

  for (const p of points) {
    const key = `${p.assetId}|${p.seriesKey}`;
    const cur = open.get(key);
    if (!cur) {
      open.set(key, { start: p.t, end: p.t, day: p.day, seriesKey: p.seriesKey });
      continue;
    }
    if (p.t - cur.end <= MERGE_GAP_MS && p.day === cur.day) {
      cur.end = p.t;
    } else {
      flush(key);
      open.set(key, { start: p.t, end: p.t, day: p.day, seriesKey: p.seriesKey });
    }
  }
  for (const key of [...open.keys()]) flush(key);

  return episodes;
}

export interface DurationChartRow {
  day: string;
  label: string;
  overspeed: number;
  idle: number;
  harshBrake: number;
  harshAccel: number;
  overspeedCount: number;
  idleCount: number;
  harshBrakeCount: number;
  harshAccelCount: number;
}

/** Average episode duration (seconds) per day per series — MiX "Average event duration over time". */
export function averageDurationByDay(events: LogEntry[]): DurationChartRow[] {
  const episodes = buildDurationEpisodes(events);
  const buckets = new Map<string, Record<DurationSeriesKey, { sum: number; n: number }>>();

  for (const ep of episodes) {
    if (!buckets.has(ep.day)) {
      buckets.set(ep.day, {
        overspeed: { sum: 0, n: 0 },
        idle: { sum: 0, n: 0 },
        harshBrake: { sum: 0, n: 0 },
        harshAccel: { sum: 0, n: 0 },
      });
    }
    const b = buckets.get(ep.day)![ep.seriesKey];
    b.sum += ep.durationSec;
    b.n += 1;
  }

  return [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, series]) => ({
      day,
      label: dayLabelLagos(day),
      overspeed: series.overspeed.n ? series.overspeed.sum / series.overspeed.n : 0,
      idle: series.idle.n ? series.idle.sum / series.idle.n : 0,
      harshBrake: series.harshBrake.n ? series.harshBrake.sum / series.harshBrake.n : 0,
      harshAccel: series.harshAccel.n ? series.harshAccel.sum / series.harshAccel.n : 0,
      overspeedCount: series.overspeed.n,
      idleCount: series.idle.n,
      harshBrakeCount: series.harshBrake.n,
      harshAccelCount: series.harshAccel.n,
    }));
}

export function dateRangeCaption(rows: DurationChartRow[]) {
  if (!rows.length) return 'No date range';
  const first = rows[0].day;
  const last = rows[rows.length - 1].day;
  const fmt = (isoDay: string) =>
    new Date(`${isoDay}T12:00:00Z`).toLocaleDateString('en-GB', {
      timeZone: 'Africa/Lagos',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  return first === last ? fmt(first) : `${fmt(first)} – ${fmt(last)}`;
}
