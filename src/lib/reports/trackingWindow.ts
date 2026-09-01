export type LookbackUnit = 'hours' | 'days' | 'weeks';

export type TrackingWindowConfig = {
  windowMode: 'last24h' | 'customLookback';
  lookbackValue?: number;
  lookbackUnit?: LookbackUnit;
};

export const TRACKING_WINDOW_HELPER =
  'Only activity within this period is included — IVMS events by event time, trips and scorecards from trip data, utilization from KPI period. No recent communication uses this window; Offline and Non-Operational use fixed GPS-age tiers.';

export function trackingWindowHours(config: TrackingWindowConfig): number {
  if (config.windowMode === 'last24h') return 24;
  const value = Math.max(1, Math.floor(Number(config.lookbackValue) || 2));
  const unit = config.lookbackUnit === 'days' || config.lookbackUnit === 'weeks'
    ? config.lookbackUnit
    : 'hours';
  if (unit === 'weeks') return value * 7 * 24;
  if (unit === 'days') return value * 24;
  return value;
}

/** Hours between ISO bounds (Reports page date range). */
export function trackingWindowHoursFromIso(fromIso: string | null, toIso: string | null): number {
  if (!fromIso || !toIso) return 24;
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 24;
  return Math.max(1, ms / 3_600_000);
}

export function trackingWindowLabel(config: TrackingWindowConfig): string {
  if (config.windowMode === 'last24h') return 'the last 24 hours';
  const value = Math.max(1, Math.floor(Number(config.lookbackValue) || 2));
  const unit = config.lookbackUnit === 'days' || config.lookbackUnit === 'weeks'
    ? config.lookbackUnit
    : 'hours';
  const singular = value === 1 ? unit.replace(/s$/, '') : unit;
  return `the last ${value} ${singular}`;
}

/** Title-style label (capitalised, no leading article). */
export function trackingWindowTitleLabel(config: TrackingWindowConfig): string {
  const phrase = trackingWindowLabel(config);
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

export function trackingWindowFilterHint(reportType: string): string {
  switch (reportType) {
    case 'driver_scorecard':
      return 'Filters distance rollups and scored IVMS events in this window.';
    case 'trips':
      return 'Filters trip rows that fall inside this window.';
    case 'asset_utilization':
      return 'Filters utilization KPIs for this window.';
    default:
      return 'Filters IVMS events by event time. No recent communication = no GPS in this window (excludes Offline & Non-Operational).';
  }
}
