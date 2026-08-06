import type { LogEntry } from '../context/FleetContext';

export type EventMetric =
  | 'occurrences'
  | 'per100'
  | 'per1000'
  | 'per10000'
  | 'distancePerEvent';

export const EVENT_METRICS: { id: EventMetric; label: string }[] = [
  { id: 'occurrences', label: 'Occurrences' },
  { id: 'per100', label: 'Events/100 distance' },
  { id: 'per1000', label: 'Events/1000 distance' },
  { id: 'per10000', label: 'Events/10000 distance' },
  { id: 'distancePerEvent', label: 'Distance/events' },
];

/** Relatable events we actually ingest — MiX settings list capped to these. */
export const RELATABLE_EVENTS = [
  'Harsh Braking',
  'Harsh Acceleration',
  'Overspeeding',
  'Overspeed Tiered',
  'Harsh Cornering',
] as const;

export type RelatableEvent = (typeof RELATABLE_EVENTS)[number];

export const SERIES_STYLE: Record<string, { legend: string; color: string; stackKey: string }> = {
  'Harsh Acceleration': { legend: 'Harsh acceleration', color: '#2b71b1', stackKey: 'harshAccel' },
  'Overspeeding': { legend: 'Over speeding', color: '#50b2e1', stackKey: 'overspeed' },
  'Overspeed Tiered': { legend: 'Over speeding', color: '#50b2e1', stackKey: 'overspeed' },
  'Harsh Braking': { legend: 'Harsh braking', color: '#58b06d', stackKey: 'harshBrake' },
  'Harsh Cornering': { legend: 'Harsh cornering', color: '#f0ad4e', stackKey: 'cornering' },
};

const LABEL_TO_RELATABLE = new Set<string>(RELATABLE_EVENTS);

export const WIDGET_DEFAULTS = {
  driverScores: {
    title: 'EVENTS THAT AFFECT MY DRIVER SCORES',
    subtitle: 'Events trend over time',
    icon: 'file' as const,
    chart: 'stacked' as const,
    events: ['Harsh Acceleration', 'Overspeeding', 'Overspeed Tiered', 'Harsh Braking'] as RelatableEvent[],
  },
  occurMost: {
    title: 'EVENTS THAT OCCUR MOST IN MY FLEET',
    subtitle: 'Events trend over time',
    icon: 'warning' as const,
    chart: 'rank' as const,
    events: [...RELATABLE_EVENTS] as RelatableEvent[],
  },
  assetCosts: {
    title: 'EVENTS THAT AFFECT MY ASSETS AND ASSOCIATED COSTS',
    subtitle: 'Events trend over time',
    icon: 'car' as const,
    chart: 'stacked' as const,
    events: ['Harsh Braking', 'Harsh Acceleration', 'Overspeeding', 'Overspeed Tiered'] as RelatableEvent[],
  },
  riskSafety: {
    title: 'EVENTS THAT AFFECT MY RISK OR SAFETY',
    subtitle: 'Events trend over time',
    icon: 'shield' as const,
    chart: 'stacked' as const,
    events: ['Harsh Braking', 'Overspeeding', 'Overspeed Tiered', 'Harsh Cornering', 'Harsh Acceleration'] as RelatableEvent[],
  },
};

export type WidgetId = keyof typeof WIDGET_DEFAULTS;

export interface WidgetSettings {
  metric: EventMetric;
  selectedEvents: RelatableEvent[];
}

export function defaultSettings(id: WidgetId): WidgetSettings {
  return {
    metric: 'occurrences',
    selectedEvents: [...WIDGET_DEFAULTS[id].events],
  };
}

/** Lagos is UTC+1 year-round — avoid Intl in hot loops. */
function dayKeyLagosFast(iso: string) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const lagos = new Date(ms + 3_600_000);
  const y = lagos.getUTCFullYear();
  const m = String(lagos.getUTCMonth() + 1).padStart(2, '0');
  const d = String(lagos.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function dayLabelLagos(isoDay: string) {
  const ms = Date.parse(`${isoDay}T12:00:00+01:00`);
  if (!Number.isFinite(ms)) return isoDay;
  return WEEKDAYS[new Date(ms).getUTCDay()] || isoDay;
}

function formatCaptionDay(isoDay: string) {
  const ms = Date.parse(`${isoDay}T12:00:00+01:00`);
  if (!Number.isFinite(ms)) return isoDay;
  const d = new Date(ms);
  const day = d.getUTCDate();
  const month = d.toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' });
  const year = d.getUTCFullYear();
  return `${day} ${month} ${year}`;
}

export interface EventDayAggregate {
  /** day (YYYY-MM-DD) → stackKey → count */
  byDay: Record<string, Record<string, number>>;
  /** legend label → count */
  byLegend: Record<string, number>;
  minDay: string;
  maxDay: string;
  eventCount: number;
}

/** Single pass over events — call once per Trends load / date-range change. */
export function preaggregateRelatableEvents(events: LogEntry[]): EventDayAggregate {
  const byDay: Record<string, Record<string, number>> = Object.create(null);
  const byLegend: Record<string, number> = Object.create(null);
  let minDay = '';
  let maxDay = '';
  let eventCount = 0;

  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.type === 'panic') continue;
    const raw = e.label || '';
    if (!LABEL_TO_RELATABLE.has(raw)) continue;
    const style = SERIES_STYLE[raw];
    if (!style) continue;
    const day = dayKeyLagosFast(e.eventTime || e.timestamp);
    if (!day) continue;

    let dayBucket = byDay[day];
    if (!dayBucket) {
      dayBucket = Object.create(null);
      byDay[day] = dayBucket;
    }
    dayBucket[style.stackKey] = (dayBucket[style.stackKey] || 0) + 1;
    byLegend[style.legend] = (byLegend[style.legend] || 0) + 1;
    eventCount++;
    if (!minDay || day < minDay) minDay = day;
    if (!maxDay || day > maxDay) maxDay = day;
  }

  return { byDay, byLegend, minDay, maxDay, eventCount };
}

export function formatDateCaptionFromAggregate(agg: EventDayAggregate) {
  if (!agg.minDay) return 'No date range';
  if (agg.minDay === agg.maxDay) {
    const f = formatCaptionDay(agg.minDay);
    const day = f.split(' ')[0];
    return f.replace(/^(\d+)/, `${day} - ${day}`);
  }
  return `${formatCaptionDay(agg.minDay)} – ${formatCaptionDay(agg.maxDay)}`;
}

function applyMetric(count: number, distanceKm: number, metric: EventMetric): number {
  if (metric === 'occurrences') return count;
  if (!distanceKm || distanceKm <= 0) return 0;
  if (metric === 'per100') return (count / distanceKm) * 100;
  if (metric === 'per1000') return (count / distanceKm) * 1000;
  if (metric === 'per10000') return (count / distanceKm) * 10000;
  if (metric === 'distancePerEvent') return count > 0 ? distanceKm / count : 0;
  return count;
}

export function formatMetricValue(n: number, metric: EventMetric) {
  if (metric === 'occurrences') {
    if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K`;
    return String(Math.round(n));
  }
  if (n >= 100) return n.toFixed(0);
  if (n >= 10) return n.toFixed(1);
  return n.toFixed(2);
}

/** Unique stack series keys in legend order for selected events. */
export function legendSeries(selected: RelatableEvent[]) {
  const seen = new Set<string>();
  const out: { stackKey: string; legend: string; color: string; labels: RelatableEvent[] }[] = [];
  for (const label of selected) {
    const style = SERIES_STYLE[label];
    if (!style) continue;
    if (seen.has(style.stackKey)) {
      const existing = out.find(o => o.stackKey === style.stackKey);
      if (existing && !existing.labels.includes(label)) existing.labels.push(label);
      continue;
    }
    seen.add(style.stackKey);
    out.push({ stackKey: style.stackKey, legend: style.legend, color: style.color, labels: [label] });
  }
  return out;
}

export function needsDistanceMetric(metric: EventMetric) {
  return metric !== 'occurrences';
}

export function buildStackedFromAggregate(
  agg: EventDayAggregate,
  selected: RelatableEvent[],
  metric: EventMetric,
  distanceKm: number,
) {
  const series = legendSeries(selected);
  const dayKeys = Object.keys(agg.byDay).sort();
  const perDayKm = dayKeys.length ? distanceKm / dayKeys.length : 0;

  return dayKeys.map(day => {
    const row: Record<string, string | number> = {
      day,
      label: dayLabelLagos(day),
    };
    const bucket = agg.byDay[day] || {};
    for (const s of series) {
      const count = bucket[s.stackKey] || 0;
      row[s.stackKey] = applyMetric(count, perDayKm, metric);
    }
    return row;
  });
}

export function buildRankFromAggregate(
  agg: EventDayAggregate,
  selected: RelatableEvent[],
  metric: EventMetric,
  distanceKm: number,
) {
  const series = legendSeries(selected);
  const wanted = new Set(series.map(s => s.legend));
  return Object.entries(agg.byLegend)
    .filter(([name]) => wanted.has(name))
    .map(([name, count]) => ({
      name,
      value: applyMetric(count, distanceKm, metric),
      raw: count,
    }))
    .sort((a, b) => b.value - a.value);
}
