import { useEffect, useMemo, useState } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Fuel } from 'lucide-react';
import { fetchFuelHistoryCached, peekFuelHistory } from '../hooks/useFuelConsumption';
import { DataRegion } from './data/DataBusy';
import {
  findFuelSeries,
  fuelZoneColor,
  type FuelSeries,
} from './FuelChart';
import type { RefuelRow } from '../lib/fuelConsumption';
import {
  chartBucketMinutes,
  detectedRefuelToRow,
  dropoutRevealFromRaw,
  formatFuel,
  periodBucketMinutes,
  processFuelReadings,
  refuelStepFromSeries,
} from '../lib/fuelSignal';
import FuelSparkNotes from './FuelSparkNotes';

function formatAxisTime(t: number, multiDay: boolean) {
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return '—';
  if (!multiDay) {
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' });
  }
  return d.toLocaleString('en-GB', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos',
  });
}

function FuelTooltip({ active, payload, label, multiDay }: {
  active?: boolean;
  payload?: Array<{ value?: number }>;
  label?: string | number;
  multiDay: boolean;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as { readingTs?: number; ts?: number } | undefined;
  const t = row?.readingTs ?? row?.ts ?? label;
  const fuel = payload[0]?.value;
  return (
    <div className="hbm-fuel-tooltip">
      <div className="hbm-fuel-tooltip-date">{formatAxisTime(Number(t), multiDay)}</div>
      {fuel != null && <div><strong>{formatFuel(fuel, 0)} L</strong> fuel</div>}
    </div>
  );
}

function buildHistoryUrl(from: string, to: string) {
  const fromDate = from.slice(0, 10);
  const toDate = to.slice(0, 10);
  return `/api/fuel/history?from=${encodeURIComponent(fromDate)}&to=${encodeURIComponent(toDate)}`;
}

export interface FuelRefuelChartPanelProps {
  assetId: string;
  regNo: string;
  assetName?: string;
  zone: string;
  periodStart: string;
  periodEnd: string;
  highlightRefuel?: RefuelRow | null;
  periodMode?: 'day' | 'week' | 'month' | 'custom';
  onChartRefuels?: (refuels: RefuelRow[]) => void;
}

export default function FuelRefuelChartPanel({
  assetId,
  regNo,
  assetName,
  zone,
  periodStart,
  periodEnd,
  highlightRefuel,
  periodMode = 'week',
  onChartRefuels,
}: FuelRefuelChartPanelProps) {
  const color = fuelZoneColor(zone);
  const historyUrl = useMemo(
    () => buildHistoryUrl(periodStart, periodEnd),
    [periodStart, periodEnd],
  );

  const [series, setSeries] = useState<FuelSeries | null>(() => {
    const cached = peekFuelHistory<FuelSeries[]>(historyUrl);
    return findFuelSeries(cached ?? [], { assetId, regNo }) ?? null;
  });
  const [loading, setLoading] = useState(() => !peekFuelHistory(historyUrl));

  useEffect(() => {
    let cancelled = false;
    const cached = peekFuelHistory<FuelSeries[]>(historyUrl);
    if (cached) {
      setSeries(findFuelSeries(cached, { assetId, regNo }) ?? null);
      setLoading(false);
    } else {
      setSeries(null);
      setLoading(true);
    }

    void (async () => {
      try {
        const data = await fetchFuelHistoryCached<FuelSeries[]>(historyUrl);
        if (cancelled || !data) return;
        setSeries(findFuelSeries(data, { assetId, regNo }) ?? null);
      } catch { /* ignore */ }
      finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [historyUrl, assetId, regNo]);

  useEffect(() => {
    setHighlightedSparkId(null);
  }, [assetId, periodStart, periodEnd]);

  const [highlightedSparkId, setHighlightedSparkId] = useState<string | null>(null);

  const bucketMin = periodMode === 'custom'
    ? chartBucketMinutes(Math.max(24, (new Date(periodEnd).getTime() - new Date(periodStart).getTime()) / 3_600_000))
    : periodBucketMinutes(periodMode);

  const plotDomain = useMemo((): [number, number] => {
    const start = new Date(periodStart).getTime();
    const end = new Date(periodEnd).getTime();
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      return [start, Math.min(end, Date.now())];
    }
    const now = Date.now();
    return [now - 7 * 86_400_000, now];
  }, [periodStart, periodEnd]);

  const [plotStartMs, plotEndMs] = plotDomain;

  const processed = useMemo(() => {
    if (!series?.data.length) return null;
    return processFuelReadings(series.data, bucketMin, plotStartMs, plotEndMs);
  }, [series, bucketMin, plotStartMs, plotEndMs]);

  const chartData = useMemo(() => {
    if (!processed?.display.length) return [];
    return processed.display.map(pt => ({
      ts: new Date(pt.timestamp).getTime(),
      readingTs: new Date(pt.timestamp).getTime(),
      level: pt.levelL,
    }));
  }, [processed]);

  const signalMetrics = processed?.metrics ?? null;

  useEffect(() => {
    if (!onChartRefuels) return;
    if (!signalMetrics?.refuels.length) {
      onChartRefuels([]);
      return;
    }
    onChartRefuels(signalMetrics.refuels.map(r => detectedRefuelToRow(assetId, r)));
  }, [signalMetrics, onChartRefuels, assetId]);

  const plotSpansMultipleDays = (plotEndMs - plotStartMs) > 24 * 3_600_000;
  const headerLevel = chartData.length
    ? chartData[chartData.length - 1].level
    : highlightRefuel?.afterLevel ?? 0;

  const selectedDropout = useMemo(
    () => processed?.dropouts.find(d => d.id === highlightedSparkId) ?? null,
    [processed, highlightedSparkId],
  );

  const highlightSegment = useMemo(() => {
    if (selectedDropout && processed) {
      return dropoutRevealFromRaw(processed.raw, selectedDropout);
    }
    if (!highlightRefuel) return null;
    return refuelStepFromSeries(chartData, highlightRefuel.timestamp);
  }, [selectedDropout, processed, highlightRefuel, chartData]);

  const plotData = useMemo(() => {
    // For a dropout reveal: interleave raw-timestamp points into the bucketed series.
    // Raw points carry highlight only (level=undefined so Area skips them).
    // Bucketed points carry level only (highlight=null so Line skips them).
    // This avoids the "multiple yellow markers" bug caused by timestamp mismatch
    // between raw probe readings and bucketed chart points.
    if (selectedDropout && processed && highlightSegment) {
      const dropoutTsSet = new Set(highlightSegment.map(p => p.ts));
      const base = chartData.map(p => ({
        ...p,
        highlight: null as number | null,
        // Keep the area flat over the dropout window (already collapsed in display)
      }));
      // Guard edges: one null-highlight point just before and just after the window
      // ensures the Line segment is isolated with no spurious connections.
      const rawOverlay = highlightSegment.map(pt => ({
        ts: pt.ts,
        readingTs: pt.ts,
        level: undefined as number | undefined,
        highlight: pt.level as number | null,
      }));
      const merged = [...base, ...rawOverlay].sort((a, b) => a.ts - b.ts);
      // Deduplicate: if a bucketed point's ts happens to equal a raw point, prefer raw.
      const seen = new Set<number>();
      const deduped: typeof merged = [];
      for (const row of merged) {
        if (dropoutTsSet.has(row.ts) && row.level !== undefined) continue; // skip bucketed dupe inside window
        if (seen.has(row.ts)) continue;
        seen.add(row.ts);
        deduped.push(row);
      }
      return deduped;
    }
    if (!highlightSegment) return chartData.map(p => ({ ...p, highlight: null as number | null }));
    // Refuel highlight: bucketed points inside the step window get highlight set.
    const keys = new Set(highlightSegment.map(p => p.ts));
    return chartData.map(p => ({
      ...p,
      highlight: keys.has(p.ts) ? p.level : null,
    }));
  }, [chartData, highlightSegment, selectedDropout, processed]);

  const yDomain = useMemo((): [number, number] => {
    const values = [
      ...chartData.map(p => p.level),
      ...(selectedDropout ? [selectedDropout.dipLevel, selectedDropout.beforeLevel] : []),
    ];
    if (!values.length) return [0, 8];
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 8];
    return [Math.max(0, min - 20), max + 20];
  }, [chartData, selectedDropout]);

  const note = highlightRefuel
    ? `Refuel +${formatFuel(highlightRefuel.deltaLiters, 0)} L · ${formatFuel(highlightRefuel.beforeLevel, 0)} → ${formatFuel(highlightRefuel.afterLevel, 0)} L`
    : signalMetrics?.refuelCount
      ? `${signalMetrics.refuelCount} refuel${signalMetrics.refuelCount === 1 ? '' : 's'} in period`
      : 'Probe trend for selected period';

  return (
    <div className="hbm-fuel-refuel-panel">
      <div className="hbm-fuel-refuel-panel-head">
        <Fuel size={14} color={color} />
        <span>Fuel probe</span>
      </div>
      <div className="hbm-fuel-chart-head">
        <div>
          <span className="hbm-fuel-chart-reg" style={{ color }}>{regNo}</span>
          {assetName && <span className="hbm-fuel-chart-asset">{assetName}</span>}
        </div>
      </div>

      <DataRegion busy={loading} variant="chart" label="Loading fuel chart">
        {!series || chartData.length === 0 ? (
          <div className="hbm-fuel-refuel-panel-empty">
            <Fuel size={24} color="var(--cd-border)" />
            <span>No probe history for this window</span>
          </div>
        ) : (
          <>
            <div className="hbm-fuel-summary hbm-fuel-summary-compact">
              <div>
                <span>Level</span>
                <strong>{formatFuel(headerLevel, 0)} L</strong>
              </div>
              <div>
                <span>Used</span>
                <strong>{formatFuel(signalMetrics?.fuelUsedL ?? null, 1)} L</strong>
              </div>
              <div>
                <span>Refuels</span>
                <strong>{signalMetrics?.refuelCount ?? 0}</strong>
              </div>
            </div>
            <p className="hbm-fuel-signal-note hbm-fuel-signal-note-compact">{note}</p>
            <FuelSparkNotes
              events={processed?.dropouts ?? []}
              selectedId={highlightedSparkId}
              onSelect={setHighlightedSparkId}
            />
            <div className="hbm-fuel-chart-plot hbm-fuel-chart-plot-compact">
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart data={plotData} margin={{ top: 24, right: 16, left: 4, bottom: 24 }}>
                  <CartesianGrid stroke="var(--cd-border)" strokeDasharray="4 8" vertical={false} />
                  <XAxis
                    type="number"
                    dataKey="ts"
                    domain={[plotStartMs, plotEndMs]}
                    tickFormatter={t => formatAxisTime(Number(t), plotSpansMultipleDays)}
                    tick={{ fill: 'var(--cd-text-muted)', fontSize: 9 }}
                    tickLine={false}
                    axisLine={false}
                    minTickGap={48}
                    height={32}
                    scale="time"
                    allowDataOverflow={false}
                  />
                  <YAxis
                    tickFormatter={v => `${v}L`}
                    tick={{ fill: 'var(--cd-text-muted)', fontSize: 9 }}
                    tickLine={false}
                    axisLine={false}
                    width={44}
                    domain={yDomain}
                    allowDataOverflow={false}
                  />
                  <Tooltip content={<FuelTooltip multiDay={plotSpansMultipleDays} />} />
                  <Area
                    type="stepAfter"
                    dataKey="level"
                    stroke={color}
                    strokeWidth={2.5}
                    fill={`${color}1f`}
                    dot={false}
                    activeDot={{ r: 4, fill: color, stroke: '#fff', strokeWidth: 2 }}
                    connectNulls
                    isAnimationActive={false}
                  />
                  {highlightSegment && (
                    <Line
                      type="stepAfter"
                      dataKey="highlight"
                      stroke="#d97706"
                      strokeWidth={4}
                      dot={false}
                      activeDot={false}
                      connectNulls={false}
                      isAnimationActive={false}
                      legendType="none"
                    />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            {highlightSegment && (
              <div className="hbm-fuel-refuel-legend">
                <span className="hbm-fuel-refuel-step-line" aria-hidden="true" />
                {selectedDropout ? 'Highlighted probe note' : 'Highlighted refuel step'}
              </div>
            )}
          </>
        )}
      </DataRegion>
    </div>
  );
}
