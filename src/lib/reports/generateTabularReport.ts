import { authFetch } from '../../context/FleetContext';
import type { LogEntry } from '../reportExport';
import { buildKpiUrl, type KpiData } from '../operationalKpi';
import type { ReportType, TabularReport } from '../reportTypes';
import { reportTypeLabel } from '../reportTypes';
import { buildEventReport } from './buildEventReport';
import {
  buildDriverScorecardReport,
  type DistanceDriverRow,
} from './buildDriverScorecardReport';
import {
  buildTripReport,
  flattenJourneysFromDistanceAssets,
  type TripReportGroupBy,
} from './buildTripReport';
import { buildUtilizationReport } from './buildUtilizationReport';

export interface ReportBuildContext {
  reportType: ReportType;
  baseTitle: string;
  meta: string;
  search: string;
  /** Filtered event rows (events report + scorecard) */
  events: LogEntry[];
  /** ISO from/to for distance + KPI */
  fromIso: string | null;
  toIso: string | null;
  /** Trip report: nest under assets or drivers */
  tripGroupBy?: TripReportGroupBy;
}

async function fetchDistanceSummary(fromIso: string | null, toIso: string | null, includeJourneys: boolean) {
  const params = new URLSearchParams();
  if (fromIso && toIso) {
    params.set('from', fromIso);
    params.set('to', toIso);
  } else {
    params.set('range', '24h');
  }
  if (includeJourneys) params.set('includeJourneys', '1');
  const res = await authFetch(`/api/driver-distance?${params}&trips=0`);
  if (!res.ok) return { drivers: [] as DistanceDriverRow[], assets: [] as any[] };
  return res.json();
}

async function fetchKpi(fromIso: string | null, toIso: string | null): Promise<KpiData | null> {
  const fromDay = fromIso ? fromIso.slice(0, 10) : undefined;
  const toDay = toIso ? toIso.slice(0, 10) : undefined;
  const url = fromDay && toDay
    ? buildKpiUrl('custom', 'all', fromDay, toDay)
    : buildKpiUrl('week', 'all');
  const res = await authFetch(url);
  if (!res.ok) return null;
  return res.json();
}

export async function generateTabularReport(ctx: ReportBuildContext): Promise<TabularReport> {
  const typeTitle = `${ctx.baseTitle} — ${reportTypeLabel(ctx.reportType)}`;

  if (ctx.reportType === 'events') {
    return buildEventReport(ctx.events, typeTitle, ctx.meta);
  }

  if (ctx.reportType === 'driver_scorecard') {
    const data = await fetchDistanceSummary(ctx.fromIso, ctx.toIso, false);
    return buildDriverScorecardReport({
      events: ctx.events,
      drivers: (data.drivers || []) as DistanceDriverRow[],
      reportTitle: typeTitle,
      meta: ctx.meta,
      search: ctx.search,
    });
  }

  if (ctx.reportType === 'trips') {
    const data = await fetchDistanceSummary(ctx.fromIso, ctx.toIso, true);
    const journeys = flattenJourneysFromDistanceAssets(data.assets || []);
    const groupBy = ctx.tripGroupBy === 'driver' ? 'driver' : 'asset';
    return buildTripReport({
      journeys,
      reportTitle: typeTitle,
      meta: `${ctx.meta}  ·  Grouped by ${groupBy === 'driver' ? 'driver' : 'asset'}`,
      search: ctx.search,
      groupBy,
    });
  }

  // asset_utilization
  const kpi = await fetchKpi(ctx.fromIso, ctx.toIso);
  return buildUtilizationReport({
    assets: kpi?.assets || [],
    reportTitle: typeTitle,
    meta: ctx.meta,
    search: ctx.search,
  });
}
