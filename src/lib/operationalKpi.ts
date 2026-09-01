/**
 * Operational KPI helpers — utilization, availability, harsh braking,
 * overspeeding and fatigue management served by /api/kpi.
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
  tripCount: number;
  distanceKm: number;
  loadedHours: number;
  loadCount: number;
  utilizationPct: number | null;
  availabilityPct: number | null;
  harshBrakingCount: number;
  harshBrakingScore: number;
  harshBrakingSharePct: number | null;
  overspeedCount: number;
  overspeedHours: number;
  overspeedScore: number;
  overspeedRatio: number | null;
  yawningCount: number;
  eyeClosingCount: number;
  distractionCount: number;
  phoneDistractionCount: number;
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

export interface FatigueEventRow {
  eventId: string | null;
  category: string;
  label: string;
  assetId: string | null;
  regNo: string;
  driverName: string;
  eventTime: string;
  speed: number | null;
}

export interface KpiData {
  generatedAt: string;
  period: { start: string; end: string };
  windowHours: number;
  scope: KpiScope;
  summary: {
    assetCount: number;
    totalEngineHours: number;
    totalLoadedHours: number;
    totalDistanceKm: number;
    avgUtilizationPct: number | null;
    avgAvailabilityPct: number | null;
    harshBrakingTotal: number;
    overspeedTotal: number;
    overspeedHoursTotal: number;
    fatigueEventTotal: number;
    yawningTotal: number;
  };
  assets: KpiAssetRow[];
  fatigue: {
    drivers: FatigueDriverRow[];
    events: FatigueEventRow[];
  };
}

export function buildKpiUrl(
  mode: KpiPeriodMode,
  scope: KpiScope,
  customFrom?: string,
  customTo?: string,
): string {
  const scopeQ = `&scope=${scope}`;
  if (mode === 'custom' && customFrom && customTo) {
    return `/api/kpi?from=${encodeURIComponent(customFrom)}&to=${encodeURIComponent(customTo)}${scopeQ}`;
  }
  return `/api/kpi?period=${mode}${scopeQ}`;
}

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
