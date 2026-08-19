/**
 * Today / This week / Custom window used by Bulk Tankers, Quarry, Cement, Ready Mix.
 */
import {
  calendarPeriodBounds,
  customRangeToIsoBounds,
  toLocalDateValue,
} from './dateRange';
import type { PeriodMode } from './fuelConsumption';

export type SegmentPeriod = 'today' | 'week' | 'custom';

export const SEGMENT_PERIOD_OPTIONS: { id: SegmentPeriod; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This week' },
  { id: 'custom', label: 'Custom' },
];

export function defaultSegmentCustomRange() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 6);
  return { from: toLocalDateValue(from), to: toLocalDateValue(to) };
}

export function segmentPeriodBounds(
  period: SegmentPeriod,
  customRange?: { from: string; to: string },
) {
  if (period === 'custom' && customRange?.from && customRange?.to) {
    const iso = customRangeToIsoBounds(customRange.from, customRange.to);
    if (iso) {
      const from = new Date(iso.from);
      const to = new Date(iso.to);
      return {
        from,
        to,
        fromMs: from.getTime(),
        toMs: to.getTime(),
        fromIso: iso.from,
        toIso: iso.to,
        fromDate: customRange.from,
        toDate: customRange.to,
      };
    }
  }
  const key = period === 'today' ? 'today' : 'week';
  const b = calendarPeriodBounds(key);
  return {
    ...b,
    fromDate: toLocalDateValue(b.from),
    toDate: toLocalDateValue(b.to),
  };
}

export function buildDriverDistanceUrl(
  period: SegmentPeriod,
  customRange?: { from: string; to: string },
) {
  if (period === 'custom' && customRange?.from && customRange?.to) {
    return `/api/driver-distance?from=${encodeURIComponent(customRange.from)}&to=${encodeURIComponent(customRange.to)}&trips=0`;
  }
  return period === 'today'
    ? '/api/driver-distance?range=today&trips=0'
    : '/api/driver-distance?range=7d&trips=0';
}

export function segmentPeriodToFuel(
  period: SegmentPeriod,
  customRange?: { from: string; to: string },
): { mode: PeriodMode; custom?: { from: string; to: string } } {
  const b = segmentPeriodBounds(period, customRange);
  return { mode: 'custom', custom: { from: b.fromDate, to: b.toDate } };
}

export function segmentPeriodLabel(
  period: SegmentPeriod,
  customRange?: { from: string; to: string },
) {
  if (period === 'today') return 'today';
  if (period === 'week') return 'this week';
  if (customRange?.from && customRange?.to) {
    const a = new Date(`${customRange.from}T00:00:00`);
    const b = new Date(`${customRange.to}T00:00:00`);
    const fmt = (d: Date) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    if (customRange.from === customRange.to) return fmt(a);
    return `${fmt(a)} – ${fmt(b)}`;
  }
  return 'custom range';
}

export function eventsInPeriod<T extends { eventTime?: string; timestamp?: string }>(
  events: T[],
  period: SegmentPeriod,
  customRange?: { from: string; to: string },
) {
  const { fromMs, toMs } = segmentPeriodBounds(period, customRange);
  return events.filter(e => {
    const t = new Date(e.eventTime || e.timestamp).getTime();
    return Number.isFinite(t) && t >= fromMs && t <= toMs;
  });
}

export function previousPeriodBounds(period: SegmentPeriod, customRange?: { from: string; to: string }) {
  const { fromMs, toMs } = segmentPeriodBounds(period, customRange);
  const dur = Math.max(toMs - fromMs, 1);
  return { fromMs: fromMs - dur, toMs: fromMs };
}
