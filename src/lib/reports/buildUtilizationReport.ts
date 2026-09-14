import type { KpiAssetRow } from '../operationalKpi';
import { ASSET_CLASS_LABELS } from '../operationalKpi';
import type { TabularReport } from '../reportTypes';
import { matchesUtilizationSearch } from './reportSearch';

function pct(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${Math.round(n)}%`;
}

export function buildUtilizationReport(opts: {
  assets: KpiAssetRow[];
  reportTitle: string;
  meta: string;
  search?: string;
}): TabularReport {
  const columns = [
    { header: 'Reg No', textForce: true, width: 14 },
    { header: 'Asset name', width: 22 },
    { header: 'Transporter', width: 18 },
    { header: 'Zone', width: 16 },
    { header: 'Class', width: 12 },
    { header: 'Engine hours', width: 12 },
    { header: 'Driving hours', width: 12 },
    { header: 'Idle hours', width: 12 },
    { header: 'Trip count', width: 10 },
    { header: 'Distance km', width: 12 },
    { header: 'Utilization %', width: 12 },
    { header: 'Availability %', width: 12 },
  ];

  const rows: string[][] = [];
  for (const a of opts.assets || []) {
    const transporter = a.transporter || '';
    if (!matchesUtilizationSearch(a.regNo || '', a.assetName || '', transporter, opts.search || '')) {
      continue;
    }
    // Keep assets with any activity signal
    if (
      !(a.engineHours > 0 || a.tripCount > 0 || a.distanceKm > 0 || a.drivingHours > 0)
    ) continue;

    rows.push([
      a.regNo || 'N/A',
      a.assetName || 'N/A',
      transporter || 'N/A',
      a.zone || 'N/A',
      ASSET_CLASS_LABELS[a.assetClass] || a.assetClass || 'Other',
      Number(a.engineHours || 0).toFixed(1),
      Number(a.drivingHours || 0).toFixed(1),
      Number(a.idleHours || 0).toFixed(1),
      String(a.tripCount || 0),
      Number(a.distanceKm || 0).toFixed(1),
      pct(a.utilizationPct),
      pct(a.availabilityPct),
    ]);
  }

  rows.sort((a, b) => {
    const ua = a[10] === '—' ? -1 : Number(a[10].replace('%', ''));
    const ub = b[10] === '—' ? -1 : Number(b[10].replace('%', ''));
    return ub - ua;
  });

  return {
    reportType: 'asset_utilization',
    title: opts.reportTitle,
    meta: opts.meta,
    columns,
    rows,
    rowCount: rows.length,
    archiveType: 'AssetUtilization',
  };
}
