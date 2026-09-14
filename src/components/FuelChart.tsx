import { useState, useEffect, useMemo, useCallback } from 'react';
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
import { startJitteredInterval } from '../lib/pollSchedule';
import {
  chartBucketMinutes,
  dropoutRevealFromRaw,
  formatFuel,
  formatFuelSignalSummary,
  formatRefuelTimes,
  processFuelReadings,
  type FuelSignalMetrics,
} from '../lib/fuelSignal';
import FuelSparkNotes from './FuelSparkNotes';

export type FuelTimeMode = 'today' | 'yesterday' | 'custom';

export interface FuelEntry { time: string; level: number }
export interface FuelSeries {
  assetId: string;
  regNo: string;
  assetName: string;
  zone: string;
  data: FuelEntry[];
}

export const FUEL_ZONE_COLORS: Record<string, string> = {
  'QUARRY EWEKORO': '#0078D4',
  'QUARRY MFAMOSING': '#16a34a',
};

export const QUARRY_SITE_KEYS = ['QUARRY EWEKORO', 'QUARRY MFAMOSING'] as const;
export type QuarrySiteKey = typeof QUARRY_SITE_KEYS[number];

export const QUARRY_SITE_LABELS: Record<QuarrySiteKey, string> = {
  'QUARRY EWEKORO': 'Ewekoro',
  'QUARRY MFAMOSING': 'Mfamosing',
};

export function fuelZoneColor(zone: string) {
  return FUEL_ZONE_COLORS[zone?.toUpperCase()] ?? '#6B7A8D';
}

export function sameAssetId(a?: string | number | null, b?: string | number | null) {
  if (a == null || b == null || a === '' || b === '') return false;
  return String(a).trim() === String(b).trim();
}

export function findFuelSeries(
  all: FuelSeries[],
  opts: { assetId?: string | null; regNo?: string | null },
): FuelSeries | undefined {
  const id = opts.assetId != null ? String(opts.assetId).trim() : '';
  const reg = (opts.regNo || '').trim();
  const regCompact = reg.replace(/\s+/g, '');
  return all.find(s => {
    if (id && sameAssetId(s.assetId, id)) return true;
    const plate = (s.regNo || '').trim();
    if (reg && (plate === reg || plate.replace(/\s+/g, '') === regCompact)) return true;
    return false;
  });
}

function defaultCustomRange() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 7);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

function customWindowHours(customFrom: string, customTo: string) {
  const from = new Date(customFrom);
  const to = new Date(customTo);
  return Math.max(6, (to.getTime() - from.getTime()) / 3_600_000 + 24);
}

function lagosDate(offsetDays: number) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });
}

function formatAxisTime(t: number | string, multiDay: boolean) {
  const d = typeof t === 'number' ? new Date(t) : new Date(t);
  if (Number.isNaN(d.getTime())) return '—';
  // Multi-day spans must include the date — time-only labels collide and look "out of order"
  if (!multiDay) {
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' });
  }
  return d.toLocaleString('en-GB', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos',
  });
}

function formatTooltipTime(t: number | string, multiDay: boolean) {
  return formatAxisTime(t, multiDay);
}

/** Axis domain for the selected window (not sparse data min/max). */
function resolveAxisDomain(
  timeMode: FuelTimeMode,
  windowHours: number,
  customFrom: string,
  customTo: string,
): [number, number] {
  const now = Date.now();
  if (timeMode === 'today' || timeMode === 'yesterday') {
    const day = timeMode === 'today' ? lagosDate(0) : lagosDate(-1);
    const start = new Date(`${day}T00:00:00`).getTime();
    const end = new Date(`${day}T23:59:59.999`).getTime();
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      return [start, timeMode === 'today' ? Math.min(end, now) : end];
    }
  }
  if (timeMode === 'custom' && customFrom && customTo) {
    const start = new Date(`${customFrom}T00:00:00`).getTime();
    const end = new Date(`${customTo}T23:59:59.999`).getTime();
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      return [start, Math.min(end, now)];
    }
  }
  return [now - windowHours * 3_600_000, now];
}

/** Even tick step for a window — aims for ~6–8 labels. */
function tickStepMs(windowHours: number) {
  const targetTicks = 7;
  const raw = (windowHours * 3_600_000) / targetTicks;
  const candidates = [
    15 * 60_000,
    30 * 60_000,
    60 * 60_000,
    2 * 60 * 60_000,
    3 * 60 * 60_000,
    4 * 60 * 60_000,
    6 * 60 * 60_000,
    12 * 60 * 60_000,
    24 * 60 * 60_000,
    2 * 24 * 60 * 60_000,
    7 * 24 * 60 * 60_000,
  ];
  for (const step of candidates) {
    if (step >= raw) return step;
  }
  return candidates[candidates.length - 1];
}

/** Explicit evenly spaced ticks across the axis domain. */
function buildAxisTicks(domainStart: number, domainEnd: number, windowHours: number): number[] {
  if (!(domainEnd > domainStart)) return [domainStart];
  const step = tickStepMs(windowHours);
  // Align first tick to a round step boundary at/after domain start
  const first = Math.ceil(domainStart / step) * step;
  const ticks: number[] = [];
  if (first - domainStart > step * 0.35) {
    ticks.push(domainStart);
  }
  for (let t = first; t <= domainEnd; t += step) {
    ticks.push(t);
  }
  const last = ticks[ticks.length - 1];
  if (last == null || domainEnd - last > step * 0.35) {
    ticks.push(domainEnd);
  }
  // Deduplicate near-duplicates from floating boundaries
  const cleaned: number[] = [];
  ticks.forEach(t => {
    const prev = cleaned[cleaned.length - 1];
    if (prev == null || t - prev >= step * 0.2) cleaned.push(t);
  });
  return cleaned;
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
      <div className="hbm-fuel-tooltip-date">{formatTooltipTime(Number(t), multiDay)}</div>
      {fuel != null && <div><strong>{formatFuel(fuel, 0)} L</strong> fuel</div>}
    </div>
  );
}

function latestReading(series: FuelSeries): number {
  if (!series.data.length) return 0;
  const sorted = [...series.data].sort(
    (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime(),
  );
  return Math.max(0, sorted[sorted.length - 1].level);
}

function appendAssetScope(url: string, assetIds: string[]) {
  if (!assetIds.length) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}assetIds=${encodeURIComponent(assetIds.join(','))}`;
}

function historyUrl(mode: FuelTimeMode, windowHours: number, customFrom: string, customTo: string, assetIds: string[] = []) {
  if (mode === 'custom' && customFrom && customTo) {
    return appendAssetScope(`/api/fuel/history?from=${encodeURIComponent(customFrom)}&to=${encodeURIComponent(customTo)}`, assetIds);
  }
  if (mode === 'yesterday') {
    const day = lagosDate(-1);
    return appendAssetScope(`/api/fuel/history?from=${encodeURIComponent(day)}&to=${encodeURIComponent(day)}`, assetIds);
  }
  if (mode === 'today') {
    const day = lagosDate(0);
    return appendAssetScope(`/api/fuel/history?from=${encodeURIComponent(day)}&to=${encodeURIComponent(day)}`, assetIds);
  }
  const from = new Date(Date.now() - windowHours * 3_600_000).toISOString().slice(0, 10);
  const to = new Date().toISOString().slice(0, 10);
  return appendAssetScope(`/api/fuel/history?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, assetIds);
}

interface Props {
  selectedRegNo: string | null;
  selectedAssetId?: string | null;
  zone: QuarrySiteKey;
  onSeriesLoaded?: (series: FuelSeries[]) => void;
  onSignalMetrics?: (metrics: FuelSignalMetrics | null) => void;
  assetIds?: string[];
}

export default function FuelChart({ selectedRegNo, selectedAssetId, zone, onSeriesLoaded, onSignalMetrics, assetIds }: Props) {
  const [timeMode, setTimeMode] = useState<FuelTimeMode>('today');
  const [customRange, setCustomRange] = useState(defaultCustomRange);
  const scopedAssetIds = useMemo(
    () => assetIds ? [...new Set(assetIds.map(id => id.trim()).filter(Boolean))].sort() : null,
    [assetIds?.join(',')],
  );
  const assetScopeKey = scopedAssetIds?.join(',') ?? '';
  const scopeHasNoAssets = Array.isArray(assetIds) && assetScopeKey === '';
  const initialHistoryUrl = scopeHasNoAssets ? '' : historyUrl('today', 24, customRange.from, customRange.to, scopedAssetIds ?? []);
  const [allSeries, setAllSeries] = useState<FuelSeries[]>(
    () => (initialHistoryUrl ? peekFuelHistory<FuelSeries[]>(initialHistoryUrl) : null) ?? [],
  );
  const [loading, setLoading] = useState(() => Boolean(initialHistoryUrl) && !peekFuelHistory<FuelSeries[]>(initialHistoryUrl));
  const [lastFetch, setLastFetch] = useState<string | null>(null);
  const [highlightedSparkId, setHighlightedSparkId] = useState<string | null>(null);

  const color = fuelZoneColor(zone);

  const activeSeries = findFuelSeries(allSeries, {
    assetId: selectedAssetId,
    regNo: selectedRegNo,
  });

  useEffect(() => {
    setHighlightedSparkId(null);
  }, [selectedRegNo, selectedAssetId]);

  const windowHours = timeMode === 'custom'
    ? customWindowHours(customRange.from, customRange.to)
    : 24;
  const bucketMin = chartBucketMinutes(windowHours);
  const axisDomain = useMemo(
    () => resolveAxisDomain(timeMode, windowHours, customRange.from, customRange.to),
    [timeMode, windowHours, customRange.from, customRange.to],
  );
  const [domainStartMs, domainEndMs] = axisDomain;

  const fetchWindowHours = timeMode === 'custom' ? null : windowHours;
  const load = useCallback(async (silent = false) => {
    if (scopeHasNoAssets) {
      setAllSeries([]);
      onSeriesLoaded?.([]);
      onSignalMetrics?.(null);
      setLoading(false);
      return;
    }
    if (timeMode === 'custom' && (!customRange.from || !customRange.to)) return;
    const url = historyUrl(timeMode, fetchWindowHours ?? 0, customRange.from, customRange.to, scopedAssetIds ?? []);
    if (!silent) {
      const cached = peekFuelHistory<FuelSeries[]>(url);
      if (cached) {
        const normalized = cached.map(s => ({
          ...s,
          data: s.data.map(pt => ({ ...pt, level: Math.max(0, pt.level) })),
        }));
        setAllSeries(normalized);
        onSeriesLoaded?.(normalized);
        setLoading(false);
      } else {
        setAllSeries([]);
        setLoading(true);
      }
    }
    try {
      const data = await fetchFuelHistoryCached<FuelSeries[]>(url, { force: silent });
      if (data) {
        const normalized = data.map(s => ({
          ...s,
          data: s.data.map(pt => ({ ...pt, level: Math.max(0, pt.level) })),
        }));
        setAllSeries(normalized);
        onSeriesLoaded?.(normalized);
        setLastFetch(new Date().toLocaleTimeString('en-GB', { timeZone: 'Africa/Lagos' }));
      }
    } catch { /* ignore */ }
    if (!silent) setLoading(false);
  }, [timeMode, fetchWindowHours, customRange.from, customRange.to, onSeriesLoaded, onSignalMetrics, scopedAssetIds, scopeHasNoAssets]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const refreshMs = timeMode === 'today' ? 60_000 : 5 * 60_000;
    return startJitteredInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void load(true);
    }, refreshMs);
  }, [load, timeMode]);

  const processed = useMemo(() => {
    if (!activeSeries) return null;
    const clipped = processFuelReadings(activeSeries.data, bucketMin, domainStartMs, domainEndMs);
    if (clipped.display.length > 0) return clipped;
    return processFuelReadings(activeSeries.data, bucketMin, null, null);
  }, [activeSeries, bucketMin, domainStartMs, domainEndMs]);

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
    onSignalMetrics?.(signalMetrics);
  }, [signalMetrics, onSignalMetrics]);

  const plotDomain = useMemo((): [number, number] => {
    if (chartData.length === 0) return [domainStartMs, domainEndMs];
    const inWindow = chartData.some(p => p.ts >= domainStartMs && p.ts <= domainEndMs);
    if (inWindow) return [domainStartMs, domainEndMs];
    const start = chartData[0].ts;
    const end = Math.max(chartData[chartData.length - 1].ts, start + 60_000);
    return [start, end];
  }, [chartData, domainStartMs, domainEndMs]);
  const [plotStartMs, plotEndMs] = plotDomain;
  const plotTicks = useMemo(
    () => buildAxisTicks(plotStartMs, plotEndMs, Math.max(1, (plotEndMs - plotStartMs) / 3_600_000)),
    [plotStartMs, plotEndMs],
  );
  const plotSpansMultipleDays = useMemo(() => {
    const dayKey = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });
    return (plotEndMs - plotStartMs) > 24 * 3_600_000 || dayKey(plotStartMs) !== dayKey(plotEndMs);
  }, [plotStartMs, plotEndMs]);
  const headerLevel = chartData.length
    ? chartData[chartData.length - 1].level
    : activeSeries
      ? latestReading(activeSeries)
      : 0;

  const selectedDropout = useMemo(
    () => processed?.dropouts.find(d => d.id === highlightedSparkId) ?? null,
    [processed, highlightedSparkId],
  );

  const sparkReveal = useMemo(() => {
    if (!selectedDropout || !processed) return null;
    return dropoutRevealFromRaw(processed.raw, selectedDropout);
  }, [selectedDropout, processed]);

  const plotData = useMemo(() => {
    if (!sparkReveal || !selectedDropout) {
      return chartData.map(p => ({ ...p, highlight: null as number | null }));
    }
    const held = selectedDropout.beforeLevel;
    const byTs = new Map(chartData.map(p => [p.ts, { ...p, highlight: null as number | null }]));
    sparkReveal.forEach(pt => {
      const existing = byTs.get(pt.ts);
      if (existing) existing.highlight = pt.level;
      else {
        byTs.set(pt.ts, {
          ts: pt.ts,
          readingTs: pt.ts,
          level: held,
          highlight: pt.level,
        });
      }
    });
    return [...byTs.values()].sort((a, b) => a.ts - b.ts);
  }, [chartData, sparkReveal, selectedDropout]);

  const yDomain = useMemo((): [number, number] | ['dataMin - 8', 'dataMax + 8'] => {
    if (!selectedDropout) return ['dataMin - 8', 'dataMax + 8'];
    const values = plotData.map(p => p.level).concat(selectedDropout.dipLevel, selectedDropout.beforeLevel);
    const min = Math.min(...values);
    const max = Math.max(...values);
    return [Math.max(0, min - 8), max + 8];
  }, [plotData, selectedDropout]);

  const efficiencyNote = formatFuelSignalSummary(signalMetrics);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 420 }}>
      {/* Time filter bar */}
      <div style={{
        padding: '12px 16px', borderBottom: '1px solid var(--cd-border)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Fuel size={15} color={color} />
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--cd-text)', fontFamily: 'var(--cd-font-display)' }}>
            Fuel trend
          </span>
          {lastFetch && (
            <span style={{ fontSize: 11, color: 'var(--cd-text-muted)' }}>· updated {lastFetch}</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 3, background: 'var(--cd-surface-2)', padding: 3, borderRadius: 8 }}>
            {([
              ['today', 'Today'],
              ['yesterday', 'Yesterday'],
              ['custom', 'Custom'],
            ] as const).map(([mode, label]) => {
              const active = timeMode === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setTimeMode(mode)}
                  style={{
                    padding: '4px 10px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                    background: active ? 'var(--cd-surface)' : 'transparent',
                    color: active ? 'var(--cd-text)' : 'var(--cd-text-muted)',
                    boxShadow: active ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
          {timeMode === 'custom' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              <input
                type="date"
                value={customRange.from}
                max={customRange.to}
                onChange={e => setCustomRange(r => ({ ...r, from: e.target.value }))}
                style={{
                  padding: '4px 8px', borderRadius: 6, border: '1px solid var(--cd-border)',
                  background: 'var(--cd-surface)', color: 'var(--cd-text)', fontSize: 12,
                }}
              />
              <span style={{ color: 'var(--cd-text-muted)' }}>→</span>
              <input
                type="date"
                value={customRange.to}
                min={customRange.from}
                max={new Date().toISOString().slice(0, 10)}
                onChange={e => setCustomRange(r => ({ ...r, to: e.target.value }))}
                style={{
                  padding: '4px 8px', borderRadius: 6, border: '1px solid var(--cd-border)',
                  background: 'var(--cd-surface)', color: 'var(--cd-text)', fontSize: 12,
                }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Chart body */}
      <div style={{ flex: 1, padding: '16px 16px 12px' }}>
        {!selectedRegNo && !selectedAssetId ? (
          <div style={{ height: 320, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--cd-text-muted)', fontSize: 13 }}>
            Select a vehicle from the list
          </div>
        ) : (
          <DataRegion busy={loading} variant="chart" tall label="Loading fuel chart">
            {!activeSeries || chartData.length === 0 ? (
              <div style={{ height: 320, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <Fuel size={32} color="var(--cd-border)" />
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--cd-text-muted)' }}>No fuel history for this period</div>
                <div style={{ fontSize: 12, color: 'var(--cd-text-muted)' }}>{selectedRegNo}</div>
              </div>
            ) : (
              <>
                <div className="hbm-fuel-chart-head">
                  <div>
                    <span className="hbm-fuel-chart-reg" style={{ color }}>{activeSeries.regNo}</span>
                    <span className="hbm-fuel-chart-asset">{activeSeries.assetName}</span>
                  </div>
                </div>
                <div className="hbm-fuel-summary">
                  <div>
                    <span>Current fuel</span>
                    <strong>{formatFuel(headerLevel, 0)} L</strong>
                  </div>
                  <div>
                    <span>Fuel used</span>
                    <strong>{formatFuel(signalMetrics?.fuelUsedL ?? null, 1)} L</strong>
                  </div>
                  <div>
                    <span>Refuels</span>
                    <strong>{signalMetrics?.refuelCount ?? 0}</strong>
                    {(signalMetrics?.refuelCount ?? 0) > 0 && (
                      <small>{formatRefuelTimes(signalMetrics!.refuelTimes)}</small>
                    )}
                  </div>
                </div>
                <p className="hbm-fuel-signal-note">{efficiencyNote}</p>
                <FuelSparkNotes
                  events={processed?.dropouts ?? []}
                  selectedId={highlightedSparkId}
                  onSelect={setHighlightedSparkId}
                />
                <div className="hbm-fuel-chart-plot">
                  <ResponsiveContainer width="100%" height={260}>
                  <ComposedChart data={plotData} margin={{ top: 8, right: 12, left: 12, bottom: 28 }}>
                    <CartesianGrid stroke="var(--cd-border)" strokeDasharray="4 8" vertical={false} />
                    <XAxis
                      type="number"
                      dataKey="ts"
                      domain={[plotStartMs, plotEndMs]}
                      ticks={plotTicks}
                      tickFormatter={t => formatAxisTime(Number(t), plotSpansMultipleDays)}
                      tick={{ fill: 'var(--cd-text-muted)', fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                      minTickGap={72}
                      height={40}
                      scale="time"
                      allowDataOverflow
                    />
                    <YAxis
                      tickFormatter={v => `${v}L`}
                      tick={{ fill: 'var(--cd-text-muted)', fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                      width={58}
                      domain={yDomain}
                    />
                    <Tooltip content={<FuelTooltip multiDay={plotSpansMultipleDays} />} />
                    <Area
                      type="stepAfter"
                      dataKey="level"
                      stroke={color}
                      strokeWidth={2.5}
                      fill={`${color}1f`}
                      dot={false}
                      activeDot={{ r: 5, fill: color, stroke: '#fff', strokeWidth: 2 }}
                      connectNulls
                      isAnimationActive={false}
                    />
                    {sparkReveal && (
                      <Line
                        type="stepAfter"
                        dataKey="highlight"
                        stroke="#d97706"
                        strokeWidth={3}
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
                {(signalMetrics?.refuelCount ?? 0) > 0 && (
                  <div className="hbm-fuel-refuel-legend">
                    <span className="hbm-fuel-refuel-dot" aria-hidden="true" />
                    Confirmed refuel on chart
                  </div>
                )}
              </>
            )}
          </DataRegion>
        )}
      </div>
    </div>
  );
}
