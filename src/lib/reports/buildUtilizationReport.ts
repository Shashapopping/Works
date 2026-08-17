import type { KpiAssetRow } from '../operationalKpi';
import { ASSET_CLASS_LABELS } from '../operationalKpi';
import type { TabularReport } from '../reportTypes';

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
  const q = (opts.search || '').trim().toLowerCase();
  const columns = [
    { header: 'Reg No', textForce: true, width: 14 },
    { header: 'Asset name', width: 22 },
    { header: 'Zone', width: 16 },
    { header: 'Class', width: 12 },
    { header: 'Engine hours', width: 12 },
    { header: 'Trip count', width: 10 },
    { header: 'Distance km', width: 12 },
    { header: 'Loaded hours', width: 12 },
    { header: 'Utilization %', width: 12 },
    { header: 'Availability %', width: 12 },
  ];

  const rows: string[][] = [];
  for (const a of opts.assets || []) {
    if (q) {
      const hay = `${a.regNo} ${a.assetName} ${a.zone}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }
    // Keep assets with any activity signal
    if (
      !(a.engineHours > 0 || a.tripCount > 0 || a.distanceKm > 0 || a.loadedHours > 0)
    ) continue;

    rows.push([
      a.regNo || 'N/A',
      a.assetName || 'N/A',
      a.zone || 'N/A',
      ASSET_CLASS_LABELS[a.assetClass] || a.assetClass || 'Other',
      Number(a.engineHours || 0).toFixed(1),
      String(a.tripCount || 0),
      Number(a.distanceKm || 0).toFixed(1),
      Number(a.loadedHours || 0).toFixed(1),
      pct(a.utilizationPct),
      pct(a.availabilityPct),
    ]);
  }

  rows.sort((a, b) => {
    const ua = a[8] === '—' ? -1 : Number(a[8].replace('%', ''));
    const ub = b[8] === '—' ? -1 : Number(b[8].replace('%', ''));
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
