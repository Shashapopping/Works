import type { LogEntry } from '../reportExport';
import type { ReportType } from '../reportTypes';

function norm(search: string) {
  return search.trim().toLowerCase();
}

/** Events — driver, asset, transporter, and inactive/offline vehicle status. */
export function matchesEventReportSearch(
  entry: LogEntry,
  search: string,
  assetStatus?: string | null,
): boolean {
  const q = norm(search);
  if (!q) return true;
  const hay = [
    entry.regNo,
    entry.assetName,
    entry.assetId,
    entry.transporter,
    entry.site,
    entry.driverName,
    entry.driverPhone,
    assetStatus,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return hay.includes(q);
}

/** Driver scorecard — driver name/phone and transporter only. */
export function matchesDriverScorecardSearch(
  driverName: string,
  phone: string,
  transporter: string,
  search: string,
): boolean {
  const q = norm(search);
  if (!q) return true;
  const hay = `${driverName} ${phone} ${transporter}`.toLowerCase();
  return hay.includes(q);
}

/** Asset utilization — reg/asset name and transporter only. */
export function matchesUtilizationSearch(
  regNo: string,
  assetName: string,
  transporter: string,
  search: string,
): boolean {
  const q = norm(search);
  if (!q) return true;
  const hay = `${regNo} ${assetName} ${transporter}`.toLowerCase();
  return hay.includes(q);
}

/** Trips — driver, asset, or transporter. */
export function matchesTripSearch(
  fields: {
    regNo?: string | null;
    assetName?: string | null;
    assetId?: string | null;
    driverName?: string | null;
    transporter?: string | null;
  },
  search: string,
): boolean {
  const q = norm(search);
  if (!q) return true;
  const hay = [
    fields.regNo,
    fields.assetName,
    fields.assetId,
    fields.driverName,
    fields.transporter,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return hay.includes(q);
}

export function reportSearchPlaceholder(reportType: ReportType): string {
  switch (reportType) {
    case 'driver_scorecard':
      return 'Driver or transporter…';
    case 'asset_utilization':
      return 'Asset or transporter…';
    case 'trips':
      return 'Driver, asset, or transporter…';
    default:
      return 'Driver, asset, or transporter…';
  }
}

export interface ReportVehicleRef {
  id?: string;
  regNo?: string;
  transporter?: string;
  site?: string;
  status?: string;
}

export function transporterByReg(vehicles: ReportVehicleRef[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const v of vehicles) {
    const reg = (v.regNo || '').trim().toLowerCase();
    if (!reg) continue;
    const label = (v.transporter || v.site || '').trim();
    if (label) map.set(reg, label);
  }
  return map;
}

export function vehicleStatusForEntry(
  entry: Pick<LogEntry, 'assetId' | 'regNo'>,
  vehicles: ReportVehicleRef[],
): string | undefined {
  const id = entry.assetId?.toString();
  const reg = entry.regNo?.trim().toLowerCase();
  const match = vehicles.find(
    v => (id && v.id === id) || (reg && v.regNo?.trim().toLowerCase() === reg),
  );
  return match?.status;
}
