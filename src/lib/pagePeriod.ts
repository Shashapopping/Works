import {
  calendarPeriodBounds,
  customRangeToIsoBounds,
  defaultCustomDateTimeRange,
  presetDateBounds,
  toLocalDateValue,
} from './dateRange';

export { ensureCustomRangeDefaults } from '../components/CustomDateTimeRange';

/** Standard page period chips (Chevron-style). */
export type PageDateRange = 'today' | '7days' | '30days' | 'custom';

export const PAGE_PERIOD_LABELS: Record<PageDateRange, string> = {
  today: 'Today',
  '7days': '7 Days',
  '30days': '30 Days',
  custom: 'Custom',
};

export function defaultPageCustomRange() {
  return defaultCustomDateTimeRange();
}

/** ISO bounds for API calls from page chips + optional custom inputs. */
export function pagePeriodIsoBounds(
  range: PageDateRange,
  customFrom = '',
  customTo = '',
): { from: string | null; to: string | null } {
  if (range === 'custom') {
    const b = customRangeToIsoBounds(customFrom, customTo);
    return b ? { from: b.from, to: b.to } : { from: null, to: null };
  }
  return presetDateBounds(range, customFrom, customTo);
}

export function pagePeriodSummaryLabel(range: PageDateRange, customFrom: string, customTo: string) {
  if (range === 'custom' && customFrom && customTo) {
    return `${customFrom} → ${customTo}`;
  }
  return PAGE_PERIOD_LABELS[range];
}

export function buildDriverDistanceUrl(
  period: 'day' | 'week' | 'month' | 'custom',
  custom?: { from: string; to: string },
): string {
  if (period === 'day') return '/api/driver-distance?range=today&trips=0';
  if (period === 'week') return '/api/driver-distance?range=7d&trips=0';
  if (period === 'month') return '/api/driver-distance?range=30d&trips=0';
  if (period === 'custom' && custom?.from && custom?.to) {
    const b = pagePeriodIsoBounds('custom', custom.from, custom.to);
    if (b.from && b.to) {
      return `/api/driver-distance?from=${encodeURIComponent(b.from)}&to=${encodeURIComponent(b.to)}&trips=0`;
    }
  }
  return '/api/driver-distance?range=7d&trips=0';
}

export function metricPeriodBounds(period: 'day' | 'week' | 'month') {
  const token = period === 'day' ? 'today' : period === 'week' ? '7days' : '30days';
  return calendarPeriodBounds(token);
}

export function dateOnlyToday() {
  return toLocalDateValue(new Date());
}
