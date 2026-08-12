import type { LogEntry } from '../context/FleetContext';
import type { TrendsGrouping, TrendsScope } from './trendsDashboard';
import type { EventDayAggregate } from './mixEventInsights';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Lagos calendar day YYYY-MM-DD (UTC+1, no DST). */
export function lagosDayKey(iso: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const lagos = new Date(ms + 3_600_000);
  const y = lagos.getUTCFullYear();
  const m = String(lagos.getUTCMonth() + 1).padStart(2, '0');
  const d = String(lagos.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** ISO week key: YYYY-Www (week starts Monday, Lagos day). */
function isoWeekKey(day: string): string {
  const ms = Date.parse(`${day}T12:00:00+01:00`);
  if (!Number.isFinite(ms)) return day;
  const d = new Date(ms);
  // Thursday of this week determines ISO week year
  const dayNum = (d.getUTCDay() + 6) % 7; // Mon=0
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const week1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week1Day = (week1.getUTCDay() + 6) % 7;
  week1.setUTCDate(week1.getUTCDate() - week1Day);
  const week = 1 + Math.round((d.getTime() - week1.getTime()) / 604800000);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Bucket key for a Lagos calendar day under the selected grouping. */
export function bucketKeyFromDay(day: string, grouping: TrendsGrouping): string {
  if (!day) return '';
  if (grouping === 'day') return day;
  if (grouping === 'month') return day.slice(0, 7); // YYYY-MM
  if (grouping === 'week') return isoWeekKey(day);
  // day-of-week → 0..6 (Sun..Sat), stable across the selected period
  const ms = Date.parse(`${day}T12:00:00+01:00`);
  if (!Number.isFinite(ms)) return day;
  return `dow-${new Date(ms).getUTCDay()}`;
}

export function bucketLabel(key: string, grouping: TrendsGrouping): string {
  if (!key) return '';
  if (grouping === 'day-of-week') {
    const i = Number(key.replace('dow-', ''));
    return WEEKDAYS[i] || key;
  }
  if (grouping === 'month') {
    const [y, m] = key.split('-').map(Number);
    if (!y || !m) return key;
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  }
  if (grouping === 'week') {
    return key.replace('-W', ' W');
  }
  // day
  const ms = Date.parse(`${key}T12:00:00+01:00`);
  if (!Number.isFinite(ms)) return key;
  return new Date(ms).toLocaleString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' });
}

export function bucketKeyFromIso(iso: string, grouping: TrendsGrouping): string {
  return bucketKeyFromDay(lagosDayKey(iso), grouping);
}

export function sortBucketKeys(keys: string[], grouping: TrendsGrouping): string[] {
  return [...keys].sort((a, b) => {
    if (grouping === 'day-of-week') {
      return Number(a.replace('dow-', '')) - Number(b.replace('dow-', ''));
    }
    return a.localeCompare(b);
  });
}

/** Merge a day-level aggregate into week / month / day-of-week buckets. */
export function rebucketAggregate(agg: EventDayAggregate, grouping: TrendsGrouping): EventDayAggregate {
  if (grouping === 'day') return agg;
  const byDay: Record<string, Record<string, number>> = Object.create(null);
  let minDay = '';
  let maxDay = '';

  for (const [day, counts] of Object.entries(agg.byDay)) {
    const key = bucketKeyFromDay(day, grouping);
    if (!key) continue;
    if (!byDay[key]) byDay[key] = Object.create(null);
    const bucket = byDay[key];
    for (const [stackKey, n] of Object.entries(counts)) {
      bucket[stackKey] = (bucket[stackKey] || 0) + n;
    }
    // Keep chronological bounds from original days
    if (!minDay || day < minDay) minDay = day;
    if (!maxDay || day > maxDay) maxDay = day;
  }

  return {
    byDay,
    byLegend: agg.byLegend,
    minDay: minDay || agg.minDay,
    maxDay: maxDay || agg.maxDay,
    eventCount: agg.eventCount,
  };
}

export function entityKey(e: LogEntry, scope: TrendsScope): string {
  if (scope === 'driver') {
    const name = (e.driverName || '').trim();
    if (name && name !== 'N/A' && name.toLowerCase() !== 'unknown') return name;
    return e.driverId ? `Driver ${e.driverId}` : 'Unknown driver';
  }
  const reg = (e.regNo || '').trim();
  if (reg && reg !== 'N/A') return reg;
  const asset = (e.assetName || '').trim();
  if (asset && asset !== 'N/A') return asset;
  return e.assetId ? `Asset ${e.assetId}` : 'Unknown asset';
}

export function downloadTextFile(filename: string, content: string, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function rowsToCsv(rows: Record<string, string | number>[]): string {
  if (!rows.length) return '';
  const keys = Object.keys(rows[0]);
  const esc = (v: string | number) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [keys.join(','), ...rows.map(r => keys.map(k => esc(r[k] ?? '')).join(','))].join('\n');
}
