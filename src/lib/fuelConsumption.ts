/**
 * Fuel consumption helpers — aligned with bpl-core-template FuelConsumptionPage.
 * Trip fuel is estimated from probe readings at trip start/end via /api/fuel/consumption.
 */

export type PeriodMode = 'day' | 'week' | 'month' | 'custom';

export interface AssetRow {
  assetId: string;
  regNo: string;
  assetName: string;
  zone: string;
  tripCount: number;
  totalFuelLiters: number;
  totalDistanceKm: number;
  totalDrivingHours: number;
  periodFuelLiters: number;
  refuelCount: number;
  refuelLiters: number;
  litersPerKm: number | null;
  litersPerHour: number | null;
}

export interface TripRow {
  tripId: string;
  assetId: string;
  regNo: string;
  driverName: string;
  tripStart: string;
  tripEnd: string;
  distanceKm: number;
  drivingHours: number;
  fuelUsedLiters: number | null;
  litersPerKm: number | null;
  litersPerHour: number | null;
  startAddress: string | null;
  endAddress: string | null;
}

export interface RefuelRow {
  assetId: string;
  timestamp: string;
  startTime?: string;
  endTime?: string;
  durationMinutes?: number;
  beforeLevel: number;
  afterLevel: number;
  deltaLiters: number;
}

export interface ConsumptionData {
  period: { start: string; end: string };
  assets: AssetRow[];
  trips: TripRow[];
  refuels?: RefuelRow[];
  dailySeries?: { date?: string; day?: string; label: string; liters: number }[];
  summary?: {
    totalFuelLiters: number;
    totalDistanceKm: number;
    totalDrivingHours?: number;
    tripCount?: number;
    refuelCount?: number;
  };
}

export interface SummaryMetrics {
  fuel: number;
  distance: number;
  drivingHours: number;
  trips: number;
  refuels: number;
  litersPerKm: number | null;
  litersPerHour: number | null;
}

export interface FuelChartPoint {
  label: string;
  liters: number;
}

export interface FuelDay {
  day: string;
  liters: number;
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEK_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function buildConsumptionUrl(
  mode: PeriodMode,
  site: string | 'ALL' = 'ALL',
  customFrom?: string,
  customTo?: string,
): string {
  const siteQ = site !== 'ALL' ? `&site=${encodeURIComponent(site)}` : '';
  if (mode === 'custom' && customFrom && customTo) {
    return `/api/fuel/consumption?from=${encodeURIComponent(customFrom)}&to=${encodeURIComponent(customTo)}${siteQ}`;
  }
  return `/api/fuel/consumption?period=${mode}${siteQ}`;
}

export function aggregateMetrics(
  rows: Pick<AssetRow, 'totalFuelLiters' | 'totalDistanceKm' | 'totalDrivingHours' | 'tripCount' | 'refuelCount'>[],
): SummaryMetrics {
  const fuel = rows.reduce((s, a) => s + a.totalFuelLiters, 0);
  const distance = rows.reduce((s, a) => s + a.totalDistanceKm, 0);
  const drivingHours = rows.reduce((s, a) => s + a.totalDrivingHours, 0);
  const trips = rows.reduce((s, a) => s + a.tripCount, 0);
  const refuels = rows.reduce((s, a) => s + a.refuelCount, 0);
  return {
    fuel,
    distance,
    drivingHours,
    trips,
    refuels,
    litersPerKm: fuel > 0 && distance > 0 ? fuel / distance : null,
    litersPerHour: fuel > 0 && drivingHours > 0 ? fuel / drivingHours : null,
  };
}

/** Group trip fuel estimates by calendar day (probe start/end delta per trip). */
export function buildChartFromTrips(
  trips: TripRow[],
  period: PeriodMode,
  bounds?: { start: string; end: string },
): FuelChartPoint[] {
  const buckets = new Map<string, number>();
  trips.forEach(t => {
    if (t.fuelUsedLiters == null || t.fuelUsedLiters <= 0) return;
    const key = new Date(t.tripEnd || t.tripStart).toISOString().slice(0, 10);
    buckets.set(key, (buckets.get(key) || 0) + t.fuelUsedLiters);
  });

  const startMs = bounds?.start ? new Date(bounds.start).getTime() : null;
  const endMs = bounds?.end ? new Date(bounds.end).getTime() : null;

  if (startMs != null && endMs != null) {
    const series: FuelChartPoint[] = [];
    const cur = new Date(startMs);
    cur.setHours(0, 0, 0, 0);
    const endD = new Date(endMs);
    endD.setHours(0, 0, 0, 0);

    while (cur <= endD) {
      const key = cur.toISOString().slice(0, 10);
      const liters = Math.round((buckets.get(key) || 0) * 10) / 10;
      const day = WEEKDAY_LABELS[cur.getDay()];
      const label = period === 'month'
        ? cur.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
        : day;
      series.push({ label, liters });
      cur.setDate(cur.getDate() + 1);
    }

    if (period === 'week' && series.length <= 7) {
      const byDay = new Map<string, FuelChartPoint>();
      let walk = new Date(startMs);
      walk.setHours(0, 0, 0, 0);
      series.forEach(row => {
        byDay.set(WEEKDAY_LABELS[walk.getDay()], row);
        walk.setDate(walk.getDate() + 1);
      });
      return WEEK_ORDER.map(day => byDay.get(day) ?? { label: day, liters: 0 });
    }

    return series;
  }

  const sorted = [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b));
  return sorted.map(([date, liters]) => ({
    label: period === 'month'
      ? new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
      : WEEKDAY_LABELS[new Date(date).getDay()],
    liters: Math.round(liters * 10) / 10,
  }));
}

export function deriveFromConsumptionData(data: ConsumptionData, period: PeriodMode) {
  const assets = data.assets ?? [];
  const trips = data.trips ?? [];
  const fromSummary = data.summary;
  const aggregated = aggregateMetrics(assets);

  const summary: SummaryMetrics = {
    fuel: fromSummary?.totalFuelLiters ?? aggregated.fuel,
    distance: fromSummary?.totalDistanceKm ?? aggregated.distance,
    drivingHours: fromSummary?.totalDrivingHours ?? aggregated.drivingHours,
    trips: fromSummary?.tripCount ?? aggregated.trips,
    refuels: fromSummary?.refuelCount ?? aggregated.refuels,
    litersPerKm: aggregated.litersPerKm,
    litersPerHour: aggregated.litersPerHour,
  };

  const chartData: FuelChartPoint[] = data.dailySeries?.length
    ? data.dailySeries.map(row => ({
      label: row.label || row.day || '—',
      liters: row.liters ?? 0,
    }))
    : buildChartFromTrips(trips, period, data.period);

  const fuelSeries: FuelDay[] = chartData.map(row => ({
    day: row.label,
    liters: row.liters,
  }));

  return { summary, chartData, fuelSeries };
}

export type DistanceFuelRange = '24h' | 'currentMonth' | 'lastMonth';

export function distanceRangeToConsumptionRequest(range: DistanceFuelRange): {
  period: PeriodMode;
  customFrom?: string;
  customTo?: string;
} {
  if (range === '24h') return { period: 'day' };
  if (range === 'currentMonth') return { period: 'month' };
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const to = new Date(now.getFullYear(), now.getMonth(), 0);
  return {
    period: 'custom',
    customFrom: from.toISOString().slice(0, 10),
    customTo: to.toISOString().slice(0, 10),
  };
}

export function defaultCustomRange() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 7);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}
