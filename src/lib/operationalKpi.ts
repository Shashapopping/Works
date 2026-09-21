/**
 * Utilization helpers — drive / idle / engine-on from trips, served by /api/utilization.
 */

export type KpiPeriodMode = 'day' | 'week' | 'month' | 'custom';
export type KpiScope = 'quarry' | 'all';

export interface KpiAssetRow {
  assetId: string;
  regNo: string;
  assetName: string;
  transporter?: string;
  zone: string;
  assetClass: 'dumpTruck' | 'excavator' | 'other';
  engineHours: number;
  drivingHours: number;
  idleHours: number;
  tripCount: number;
  distanceKm: number;
  utilizationPct: number | null;
  availabilityPct: number | null;
}

export interface FatigueDriverRow {
  driverId: string | null;
  driverName: string;
  yawningCount: number;
  eyeClosingCount: number;
  distractionCount: number;
  phoneDistractionCount: number;
  totalEvents: number;
  lastEventTime: string | null;
  vehicles: string[];
}

export interface KpiData {
  generatedAt: string;
  period: { start: string; end: string };
  windowHours: number;
  scope: KpiScope;
  summary: {
    assetCount: number;
    /** Vehicles in scope (full fleet size) — for activity %, not only assets with trips. */
    fleetAssetCount?: number;
    assetsWithTrips?: number;
    totalEngineHours: number;
    totalDrivingHours: number;
    totalIdleHours: number;
    totalDistanceKm: number;
    avgUtilizationPct: number | null;
    avgAvailabilityPct: number | null;
  };
  assets: KpiAssetRow[];
}

export function buildUtilUrl(
  mode: KpiPeriodMode,
  scope: KpiScope,
  customFrom?: string,
  customTo?: string,
  options: { assetIds?: string[]; siteScope?: string[] } = {},
): string {
  const params = new URLSearchParams();
  if (mode === 'custom' && customFrom && customTo) { params.set('from', customFrom); params.set('to', customTo); }
  else { params.set('period', mode); }
  params.set('scope', scope);
  const assetIds = [...new Set((options.assetIds || []).map(id => id.trim()).filter(Boolean))].sort();
  const siteScope = [...new Set((options.siteScope || []).map(site => site.trim()).filter(Boolean))].sort();
  if (assetIds.length) params.set('assetIds', assetIds.join(','));
  else if (siteScope.length) params.set('siteScope', siteScope.join(','));
  return `/api/utilization?${params.toString()}`;
}

/** @deprecated Use buildUtilUrl */
export const buildKpiUrl = buildUtilUrl;

export const ASSET_CLASS_LABELS: Record<KpiAssetRow['assetClass'], string> = {
  dumpTruck: 'Dump Truck',
  excavator: 'Excavator',
  other: 'Other',
};

export function defaultKpiCustomRange() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 7);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}
