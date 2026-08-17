import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Fuel, ZoomIn } from 'lucide-react';
import { fetchFuelHistoryCached, peekFuelHistory } from '../hooks/useFuelConsumption';
import { DataRegion } from './data/DataBusy';

export type FuelTimeMode = 'day' | 'week' | 'month' | 'custom';

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

// Zoom levels: scrolling out widens the window and compresses readings into coarser buckets
const WINDOW_STEPS_HOURS = [6, 12, 24, 48, 72, 168, 336, 720] as const;
const BUCKET_STEPS = [5, 15, 30, 60, 180, 360, 720, 1440] as const;
const TARGET_POINTS = 288;

const PRESETS: { label: string; hours: number }[] = [
  { label: 'Today', hours: 24 },
  { label: '2 Days', hours: 48 },
  { label: '7 Days', hours: 168 },
  { label: '30 Days', hours: 720 },
];

function bucketForWindow(windowHours: number) {
  const raw = (windowHours * 60) / TARGET_POINTS;
  for (const step of BUCKET_STEPS) {
    if (step >= raw) return step;
  }
  return BUCKET_STEPS[BUCKET_STEPS.length - 1];
}

function windowLabel(hours: number) {
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function nearestWindowIndex(hours: number) {
  let best = 0;
  for (let i = 0; i < WINDOW_STEPS_HOURS.length; i++) {
    if (Math.abs(WINDOW_STEPS_HOURS[i] - hours) < Math.abs(WINDOW_STEPS_HOURS[best] - hours)) best = i;
  }
  return best;
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

function buildChartPoints(
  series: FuelSeries,
  bucketMin: number,
  startMs: number | null,
  endMs: number | null,
) {
  const bucketMs = bucketMin * 60_000;
  // Last reading per bucket — x uses bucket floor so the series sits on a regular grid
  const buckets = new Map<number, { readingTs: number; level: number }>();
  series.data.forEach(pt => {
    const ts = new Date(pt.time).getTime();
    if (!Number.isFinite(ts)) return;
    if (startMs != null && ts < startMs) return;
    if (endMs != null && ts > endMs) return;
    const b = Math.floor(ts / bucketMs) * bucketMs;
    const level = Math.max(0, pt.level);
    const existing = buckets.get(b);
    if (!existing || ts >= existing.readingTs) {
      buckets.set(b, { readingTs: ts, level });
    }
  });
  return [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([bucketTs, pt]) => ({
      ts: bucketTs,
      readingTs: pt.readingTs,
      level: pt.level,
    }));
}

function seriesDataSpanMs(series: FuelSeries | undefined): { earliest: number; latest: number } | null {
  if (!series?.data.length) return null;
  let earliest = Infinity;
  let latest = -Infinity;
  series.data.forEach(pt => {
    const ts = new Date(pt.time).getTime();
    if (!Number.isFinite(ts)) return;
    if (ts < earliest) earliest = ts;
    if (ts > latest) latest = ts;
  });
  if (!Number.isFinite(earliest) || !Number.isFinite(latest)) return null;
  return { earliest, latest };
}

/** True when history covers at least ~40% of the requested window (or any data for ≤24h). */
function windowHasEnoughData(span: { earliest: number; latest: number } | null, windowHours: number) {
  if (!span) return false;
  const availableMs = Math.max(0, span.latest - span.earliest);
  const needMs = windowHours * 3_600_000;
  if (windowHours <= 24) return availableMs > 0;
  return availableMs >= needMs * 0.4;
}

function latestReading(series: FuelSeries): number {
  if (!series.data.length) return 0;
  const sorted = [...series.data].sort(
    (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime(),
  );
  return Math.max(0, sorted[sorted.length - 1].level);
}

function historyUrl(mode: FuelTimeMode, windowHours: number, customFrom: string, customTo: string) {
  if (mode === 'custom' && customFrom && customTo) {
    return `/api/fuel/history?from=${encodeURIComponent(customFrom)}&to=${encodeURIComponent(customTo)}`;
  }
  const from = new Date(Date.now() - windowHours * 3_600_000).toISOString().slice(0, 10);
  const to = new Date().toISOString().slice(0, 10);
  return `/api/fuel/history?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
}

interface Props {
  selectedRegNo: string | null;
  selectedAssetId?: string | null;
  zone: QuarrySiteKey;
  onSeriesLoaded?: (series: FuelSeries[]) => void;
}

export default function FuelChart({ selectedRegNo, selectedAssetId, zone, onSeriesLoaded }: Props) {
  const [timeMode, setTimeMode] = useState<FuelTimeMode>('day');
  const [windowIdx, setWindowIdx] = useState(() => nearestWindowIndex(24));
  const [customRange, setCustomRange] = useState(defaultCustomRange);
  const [allSeries, setAllSeries] = useState<FuelSeries[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastFetch, setLastFetch] = useState<string | null>(null);
  const chartAreaRef = useRef<HTMLDivElement | null>(null);

  const color = fuelZoneColor(zone);

  const activeSeries = allSeries.find(s => {
    if (selectedAssetId && String(s.assetId) === String(selectedAssetId)) return true;
    if (!selectedRegNo) return false;
    return s.regNo === selectedRegNo || s.regNo?.trim() === selectedRegNo.trim();
  });
  const dataSpan = useMemo(() => seriesDataSpanMs(activeSeries), [activeSeries]);

  const windowHours = timeMode === 'custom'
    ? customWindowHours(customRange.from, customRange.to)
    : WINDOW_STEPS_HOURS[windowIdx];
  const bucketMin = bucketForWindow(windowHours);
  const axisDomain = useMemo(
    () => resolveAxisDomain(timeMode, windowHours, customRange.from, customRange.to),
    [timeMode, windowHours, customRange.from, customRange.to],
  );
  const [domainStartMs, domainEndMs] = axisDomain;
  const axisTicks = useMemo(
    () => buildAxisTicks(domainStartMs, domainEndMs, windowHours),
    [domainStartMs, domainEndMs, windowHours],
  );
  // Multi-day labels follow the selected window, not sparse data extents
  const chartSpansMultipleDays = useMemo(() => {
    if (windowHours > 24) return true;
    const dayKey = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });
    return dayKey(domainStartMs) !== dayKey(domainEndMs);
  }, [windowHours, domainStartMs, domainEndMs]);

  // dir 1 = zoom out (wider window, compressed data), -1 = zoom in
  const zoomBy = useCallback((dir: 1 | -1) => {
    if (timeMode === 'custom') {
      const idx = Math.min(
        WINDOW_STEPS_HOURS.length - 1,
        Math.max(0, nearestWindowIndex(customWindowHours(customRange.from, customRange.to)) + dir),
      );
      setTimeMode('day');
      setWindowIdx(idx);
      return;
    }
    setWindowIdx(prev => {
      let next = prev;
      for (let step = 0; step < WINDOW_STEPS_HOURS.length; step++) {
        const candidate = Math.min(WINDOW_STEPS_HOURS.length - 1, Math.max(0, next + dir));
        if (candidate === next) break;
        next = candidate;
        if (windowHasEnoughData(dataSpan, WINDOW_STEPS_HOURS[next])) break;
      }
      return next;
    });
  }, [timeMode, customRange.from, customRange.to, dataSpan]);

  const canZoomIn = useMemo(() => {
    if (timeMode === 'custom') return true;
    for (let i = windowIdx - 1; i >= 0; i--) {
      if (windowHasEnoughData(dataSpan, WINDOW_STEPS_HOURS[i])) return true;
    }
    return false;
  }, [timeMode, windowIdx, dataSpan]);

  const canZoomOut = useMemo(() => {
    if (timeMode === 'custom') return true;
    for (let i = windowIdx + 1; i < WINDOW_STEPS_HOURS.length; i++) {
      if (windowHasEnoughData(dataSpan, WINDOW_STEPS_HOURS[i])) return true;
    }
    return false;
  }, [timeMode, windowIdx, dataSpan]);

  // Non-passive wheel listener so zooming doesn't scroll the page
  useEffect(() => {
    const el = chartAreaRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomBy(e.deltaY > 0 ? 1 : -1);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomBy]);

  const fetchWindowHours = timeMode === 'custom' ? null : windowHours;
  const load = useCallback(async (silent = false) => {
    if (timeMode === 'custom' && (!customRange.from || !customRange.to)) return;
    const url = historyUrl(timeMode, fetchWindowHours ?? 0, customRange.from, customRange.to);
    if (!silent) {
      setLoading(true);
      const cached = peekFuelHistory<FuelSeries[]>(url);
      if (cached) {
        const normalized = cached.map(s => ({
          ...s,
          data: s.data.map(pt => ({ ...pt, level: Math.max(0, pt.level) })),
        }));
        setAllSeries(normalized);
        onSeriesLoaded?.(normalized);
      } else {
        setAllSeries([]);
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
  }, [timeMode, fetchWindowHours, customRange.from, customRange.to, onSeriesLoaded]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const interval = setInterval(() => load(true), 30_000);
    return () => clearInterval(interval);
  }, [load]);

  const chartData = useMemo(
    () => (activeSeries
      ? buildChartPoints(activeSeries, bucketMin, domainStartMs, domainEndMs)
      : []),
    [activeSeries, bucketMin, domainStartMs, domainEndMs],
  );
  const headerLevel = chartData.length
    ? chartData[chartData.length - 1].level
    : activeSeries
      ? latestReading(activeSeries)
      : 0;

  const activePresetHours = timeMode === 'custom' ? null : WINDOW_STEPS_HOURS[windowIdx];

  // If current stepped window has no usable coverage, snap back to the widest available preset
  useEffect(() => {
    if (timeMode === 'custom' || loading || !activeSeries) return;
    if (windowHasEnoughData(dataSpan, windowHours)) return;
    for (let i = 0; i < WINDOW_STEPS_HOURS.length; i++) {
      if (windowHasEnoughData(dataSpan, WINDOW_STEPS_HOURS[i])) {
        if (i !== windowIdx) setWindowIdx(i);
        return;
      }
    }
  }, [timeMode, loading, activeSeries, dataSpan, windowHours, windowIdx]);

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
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              background: 'var(--cd-surface-2)', padding: '3px 6px', borderRadius: 8,
            }}
            title="Scroll on the chart to zoom — out widens the window and compresses the data"
          >
            <ZoomIn size={13} color="var(--cd-text-muted)" />
            <button
              type="button"
              onClick={() => zoomBy(-1)}
              disabled={!canZoomIn}
              style={{
                border: 'none', background: 'transparent', cursor: canZoomIn ? 'pointer' : 'default',
                fontSize: 14, fontWeight: 700, lineHeight: 1, padding: '2px 4px',
                color: canZoomIn ? 'var(--cd-text)' : 'var(--cd-border)',
              }}
            >
              +
            </button>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--cd-text-muted)', minWidth: 34, textAlign: 'center' }}>
              {timeMode === 'custom' ? 'range' : windowLabel(windowHours)}
            </span>
            <button
              type="button"
              onClick={() => zoomBy(1)}
              disabled={!canZoomOut}
              style={{
                border: 'none', background: 'transparent', cursor: canZoomOut ? 'pointer' : 'default',
                fontSize: 14, fontWeight: 700, lineHeight: 1, padding: '2px 4px',
                color: canZoomOut ? 'var(--cd-text)' : 'var(--cd-border)',
              }}
            >
              −
            </button>
          </div>
          <div style={{ display: 'flex', gap: 3, background: 'var(--cd-surface-2)', padding: 3, borderRadius: 8 }}>
            {PRESETS.map(p => {
              const active = activePresetHours === p.hours;
              const enabled = windowHasEnoughData(dataSpan, p.hours);
              return (
                <button
                  key={p.label}
                  type="button"
                  disabled={!enabled}
                  title={enabled ? undefined : 'Not enough probe history for this window'}
                  onClick={() => {
                    if (!enabled) return;
                    setTimeMode('day');
                    setWindowIdx(nearestWindowIndex(p.hours));
                  }}
                  style={{
                    padding: '4px 10px', borderRadius: 6, border: 'none',
                    cursor: enabled ? 'pointer' : 'not-allowed',
                    fontSize: 12, fontWeight: 600,
                    background: active ? 'var(--cd-surface)' : 'transparent',
                    color: !enabled ? 'var(--cd-border)' : active ? 'var(--cd-text)' : 'var(--cd-text-muted)',
                    boxShadow: active ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                    opacity: enabled ? 1 : 0.4,
                    filter: enabled ? 'none' : 'blur(0.4px)',
                  }}
                >
                  {p.label}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setTimeMode('custom')}
              style={{
                padding: '4px 10px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                background: timeMode === 'custom' ? 'var(--cd-surface)' : 'transparent',
                color: timeMode === 'custom' ? 'var(--cd-text)' : 'var(--cd-text-muted)',
                boxShadow: timeMode === 'custom' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              }}
            >
              Custom
            </button>
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

      {/* Chart body — scroll to zoom the time window */}
      <div ref={chartAreaRef} style={{ flex: 1, padding: '16px 16px 12px' }}>
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
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 14 }}>
                  <div>
                    <span style={{ fontSize: 20, fontWeight: 700, color, fontFamily: 'var(--cd-font-display)' }}>{activeSeries.regNo}</span>
                    <span style={{ fontSize: 12, color: 'var(--cd-text-muted)', marginLeft: 8 }}>{activeSeries.assetName}</span>
                  </div>
                  <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                    <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--cd-text)', fontFamily: 'var(--cd-font-display)', lineHeight: 1 }}>
                      {headerLevel.toFixed(0)}
                      <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--cd-text-muted)', marginLeft: 3 }}>L</span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--cd-text-muted)', marginTop: 2 }}>Current level</div>
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={chartData} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--cd-border)" />
                    <XAxis
                      type="number"
                      dataKey="ts"
                      domain={[domainStartMs, domainEndMs]}
                      ticks={axisTicks}
                      tickFormatter={t => formatAxisTime(Number(t), chartSpansMultipleDays)}
                      tick={{ fontSize: 11, fill: 'var(--cd-text-muted)' }}
                      tickLine={false}
                      axisLine={false}
                      scale="time"
                      allowDataOverflow
                    />
                    <YAxis
                      tickFormatter={v => `${v}L`}
                      tick={{ fontSize: 11, fill: 'var(--cd-text-muted)' }}
                      tickLine={false}
                      axisLine={false}
                      width={46}
                      domain={['auto', 'auto']}
                    />
                    <Tooltip
                      contentStyle={{ background: 'var(--cd-surface)', border: '1px solid var(--cd-border)', borderRadius: 8, fontSize: 12 }}
                      labelFormatter={(_label, payload) => {
                        const row = payload?.[0]?.payload as { readingTs?: number; ts?: number } | undefined;
                        const t = row?.readingTs ?? row?.ts ?? _label;
                        return formatTooltipTime(Number(t), chartSpansMultipleDays);
                      }}
                      formatter={(v: number) => [`${parseFloat(String(v)).toFixed(0)}L`, 'Fuel Level']}
                    />
                    <Line
                      type="monotone"
                      dataKey="level"
                      stroke={color}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4 }}
                      connectNulls
                    />
                  </LineChart>
                </ResponsiveContainer>
              </>
            )}
          </DataRegion>
        )}
      </div>
    </div>
  );
}
