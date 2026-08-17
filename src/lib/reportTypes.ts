/**
 * Multi-type report contracts — Events, Driver scorecard, Trips, Asset utilization.
 */

export type ReportType =
  | 'events'
  | 'driver_scorecard'
  | 'trips'
  | 'asset_utilization';

export const REPORT_TYPE_OPTIONS: { id: ReportType; label: string; hint: string }[] = [
  { id: 'events', label: 'Event report', hint: 'Safety & operational events' },
  { id: 'driver_scorecard', label: 'Driver score card', hint: 'Consequence scores per 100 km' },
  { id: 'trips', label: 'Trip report', hint: 'Distance by asset or driver — start/end, km, times, speeds' },
  { id: 'asset_utilization', label: 'Asset utilization', hint: 'Utilization & availability KPIs' },
];

export interface ReportColumn {
  header: string;
  /** Force Excel/CSV phone/reg text treatment */
  textForce?: boolean;
  width?: number;
}

export interface TabularReport {
  reportType: ReportType;
  title: string;
  meta: string;
  columns: ReportColumn[];
  /** Parallel to columns — string cells ready for export */
  rows: string[][];
  rowCount: number;
  archiveType: string;
}

export function reportTypeLabel(type: ReportType): string {
  return REPORT_TYPE_OPTIONS.find(o => o.id === type)?.label || type;
}
