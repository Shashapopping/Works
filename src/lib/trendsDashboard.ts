/** Trends — named dashboards + organisational goal chart catalog. */

export type TrendsChartId =
  | 'event-values'
  | 'event-duration'
  | 'events-important'
  | 'events-occur-most'
  | 'events-asset-costs'
  | 'events-risk-safety'
  | 'events-driver-scores'
  | 'driver-band-distance'
  | 'driver-pct-scoring-band'
  | 'driver-top-bottom'
  | 'driver-avg-scores'
  | 'fleet-distance-trips'
  | 'fleet-utilisation-trend'
  | 'fleet-drive-idle'
  | 'distance-fuel-metrics'
  | 'driver-id-trends'
  | 'driver-id-adherence'
  | 'fleet-movement-by-hour';

export type TrendsChartKind =
  | 'mix'
  | 'event-values'
  | 'event-duration'
  | 'driver-band-distance'
  | 'driver-band-score'
  | 'driver-performance'
  | 'driver-avg-scores'
  | 'fleet-distance'
  | 'fleet-util-pct'
  | 'fleet-idle'
  | 'fleet-hour'
  | 'fuel-distance'
  | 'driver-id-trend'
  | 'driver-id-adherence';

export interface TrendsChartDef {
  id: TrendsChartId;
  label: string;
  mixWidget?: 'driverScores' | 'occurMost' | 'assetCosts' | 'riskSafety';
  kind: TrendsChartKind;
  title: string;
  subtitle: string;
}

export const TRENDS_CHART_CATALOG: TrendsChartDef[] = [
  { id: 'event-values', label: 'Event values', kind: 'event-values', title: 'Event values', subtitle: 'Event counts over time' },
  { id: 'event-duration', label: 'Event duration', kind: 'event-duration', title: 'Event duration', subtitle: 'Average event duration over time' },
  { id: 'events-important', label: 'Events important to me', kind: 'mix', mixWidget: 'driverScores', title: 'Events important to me', subtitle: 'Events trend over time' },
  { id: 'events-occur-most', label: 'Events that occur most in my fleet', kind: 'mix', mixWidget: 'occurMost', title: 'Events that occur most in my fleet', subtitle: 'Events trend over time' },
  { id: 'events-asset-costs', label: 'Events that affect my assets and associated costs', kind: 'mix', mixWidget: 'assetCosts', title: 'Events that affect my assets and associated costs', subtitle: 'Events trend over time' },
  { id: 'events-risk-safety', label: 'Events that affect my risk or safety', kind: 'mix', mixWidget: 'riskSafety', title: 'Events that affect my risk or safety', subtitle: 'Events trend over time' },
  { id: 'events-driver-scores', label: 'Events that affect my driver scores', kind: 'mix', mixWidget: 'driverScores', title: 'Events that affect my driver scores', subtitle: 'Events trend over time' },
  { id: 'driver-band-distance', label: 'Distance by scoring band', kind: 'driver-band-distance', title: 'Distance by scoring band', subtitle: 'Distance by green / amber / red drivers' },
  { id: 'driver-pct-scoring-band', label: 'Driver % per scoring band', kind: 'driver-band-score', title: 'Driver % per scoring band', subtitle: 'Drivers by score band' },
  { id: 'driver-top-bottom', label: 'Driver scoring top/bottom drivers', kind: 'driver-performance', title: 'Driver Performance', subtitle: 'Driver % per scoring band & top/bottom range' },
  { id: 'driver-avg-scores', label: 'Driver performance average scores', kind: 'driver-avg-scores', title: 'Driver average scores', subtitle: 'Average safety score over time' },
  { id: 'fleet-distance-trips', label: 'Fleet utilisation - distance and trip insights', kind: 'fleet-distance', title: 'Distance and trip insights', subtitle: 'Fleet distance & trip KPIs' },
  { id: 'fleet-utilisation-trend', label: 'Fleet utilisation trend', kind: 'fleet-util-pct', title: 'Fleet utilisation %', subtitle: 'Assets with trips / available assets × 100' },
  { id: 'fleet-drive-idle', label: 'Fleet utilisation - drive/idle time', kind: 'fleet-idle', title: 'Driving and idling time', subtitle: 'Drive vs idle activity' },
  { id: 'distance-fuel-metrics', label: 'Distance and fuel metrics', kind: 'fuel-distance', title: 'Manage fuels and energy', subtitle: 'Total distance and fuel used (gallons)' },
  { id: 'driver-id-trends', label: 'Driver identification - identified/unidentified trends', kind: 'driver-id-trend', title: 'Driver identification trends', subtitle: 'Identified / unidentified' },
  { id: 'driver-id-adherence', label: 'Driver identification - driver adherence %', kind: 'driver-id-adherence', title: 'Driver adherence %', subtitle: 'Driver identification adherence' },
  { id: 'fleet-movement-by-hour', label: 'Fleet utilisation - movement by hour', kind: 'fleet-hour', title: 'Movement by hour of day', subtitle: 'Event activity by hour' },
];

export interface TrendsDashboard {
  id: string;
  name: string;
  description: string;
  chartIds: TrendsChartId[];
  preset?: boolean;
}

export const PRESET_DASHBOARDS: TrendsDashboard[] = [
  {
    id: 'preset-driver-performance',
    name: 'Driver Performance (Default)',
    description: 'Scoring bands, top/bottom drivers',
    chartIds: ['driver-band-distance', 'driver-pct-scoring-band', 'driver-top-bottom'],
    preset: true,
  },
  {
    id: 'preset-fleet-utilisation',
    name: 'Fleet Utilisation (Default)',
    description: 'Distance, utilisation %, drive/idle, movement',
    chartIds: ['fleet-distance-trips', 'fleet-utilisation-trend', 'fleet-drive-idle', 'fleet-movement-by-hour'],
    preset: true,
  },
  {
    id: 'preset-fuel-energies',
    name: 'Fuels and Energy (Default)',
    description: 'Distance and fuel used',
    chartIds: ['distance-fuel-metrics'],
    preset: true,
  },
  {
    id: 'preset-driver-identifications',
    name: 'Driver Identifications (Default)',
    description: 'Identified vs unidentified drivers',
    chartIds: ['driver-id-trends', 'driver-id-adherence'],
    preset: true,
  },
];

export function chartDef(id: TrendsChartId): TrendsChartDef | undefined {
  return TRENDS_CHART_CATALOG.find(c => c.id === id);
}

export function createDashboardId() {
  return `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export interface TrendsStoredState {
  activeId: string;
  presetCharts: Record<string, TrendsChartId[]>;
  custom: TrendsDashboard[];
}

const STORAGE_KEY = 'bpl-trends-dashboards-v3';

export function loadTrendsState(): TrendsStoredState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { activeId: PRESET_DASHBOARDS[0].id, presetCharts: {}, custom: [] };
    }
    const parsed = JSON.parse(raw) as TrendsStoredState;
    return {
      activeId: parsed.activeId || PRESET_DASHBOARDS[0].id,
      presetCharts: parsed.presetCharts || {},
      custom: Array.isArray(parsed.custom) ? parsed.custom : [],
    };
  } catch {
    return { activeId: PRESET_DASHBOARDS[0].id, presetCharts: {}, custom: [] };
  }
}

export function saveTrendsState(state: TrendsStoredState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch { /* ignore */ }
}

export function resolveDashboard(state: TrendsStoredState, id: string): TrendsDashboard | undefined {
  const preset = PRESET_DASHBOARDS.find(d => d.id === id);
  if (preset) {
    const charts = state.presetCharts[id];
    return { ...preset, chartIds: charts && charts.length > 0 ? charts : [...preset.chartIds] };
  }
  return state.custom.find(d => d.id === id);
}

export function listDashboards(state: TrendsStoredState): TrendsDashboard[] {
  return [
    ...PRESET_DASHBOARDS.map(p => resolveDashboard(state, p.id)!),
    ...state.custom,
  ];
}

export type TrendsPeriod = 'today' | 'week' | 'month' | 'custom';
export type TrendsGrouping = 'day-of-week' | 'day' | 'week' | 'month';
export type TrendsScope = 'asset' | 'driver';
export type TrendsLayout = 'grid' | 'list';
