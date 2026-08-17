import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import PeriodSelect, { type PeriodValue } from './PeriodSelect';
import { useFleet } from '../../context/FleetContext';
import {
  QUARRY_SITE_KEYS,
  QUARRY_SITE_LABELS,
  fuelZoneColor,
  type FuelSeries,
  type QuarrySiteKey,
} from '../FuelChart';
import type { RefuelRow } from '../../lib/fuelConsumption';
import {
  fetchFuelConsumptionCached,
  fetchFuelHistoryCached,
  peekFuelConsumption,
  peekFuelHistory,
} from '../../hooks/useFuelConsumption';
import { DataRegion } from '../data/DataBusy';

type FuelPeriod = PeriodValue;

interface ChartPoint {
  label: string;
  level: number;
  time: string;
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

function historyUrl(period: FuelPeriod, custom: { from: string; to: string }) {
  if (period === 'custom' && custom.from && custom.to) {
    return `/api/fuel/history?from=${encodeURIComponent(custom.from)}&to=${encodeURIComponent(custom.to)}`;
  }
  const mapped = period === 'day' || period === 'week' || period === 'month' ? period : 'week';
  return `/api/fuel/history?period=${mapped}`;
}

function isQuarryZone(zone: string | undefined): zone is QuarrySiteKey {
  return QUARRY_SITE_KEYS.includes((zone || '').toUpperCase() as QuarrySiteKey);
}

function seriesLastTs(s: FuelSeries): number {
  if (!s.data.length) return 0;
  return Math.max(...s.data.map(p => new Date(p.time).getTime()).filter(Number.isFinite));
}

function seriesLatestLevel(s: FuelSeries): number {
  if (!s.data.length) return 0;
  const sorted = [...s.data].sort(
    (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime(),
  );
  return Math.max(0, sorted[sorted.length - 1].level);
}

/** Prefer quarry assets with real fuel (>0), live probe if possible, then most recent history. */
function pickActiveQuarrySeries(
  all: FuelSeries[],
  liveIds: Set<string>,
  liveLevels: Map<string, number>,
): FuelSeries | null {
  const quarry = all.filter(s => isQuarryZone(s.zone) && s.data.length > 0);
  if (!quarry.length) return null;

  const scored = quarry.map(s => {
    const live = liveLevels.get(s.assetId);
    const hist = seriesLatestLevel(s);
    const level = live != null && live > 0 ? live : hist;
    return {
      series: s,
      level,
      hasLive: liveIds.has(s.assetId) && (live == null || live > 0),
      lastTs: seriesLastTs(s),
    };
  });

  const withFuel = scored.filter(s => s.level > 0);
  const pool = withFuel.length ? withFuel : scored;
  const livePool = pool.filter(s => s.hasLive);
  const final = livePool.length ? livePool : pool;

  return [...final]
    .sort((a, b) => b.level - a.level || b.lastTs - a.lastTs)[0]?.series ?? null;
}

function bucketSeries(series: FuelSeries, period: FuelPeriod): ChartPoint[] {
  const points = [...series.data].sort(
    (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime(),
  );
  if (!points.length) return [];

  const bucketMs =
    period === 'day' ? 30 * 60_000
      : period === 'month' ? 6 * 60 * 60_000
        : 2 * 60 * 60_000;

  const buckets = new Map<number, { ts: number; level: number }>();
  points.forEach(pt => {
    const ts = new Date(pt.time).getTime();
    const b = Math.floor(ts / bucketMs) * bucketMs;
    const existing = buckets.get(b);
    if (!existing || ts >= existing.ts) {
      buckets.set(b, { ts, level: Math.max(0, pt.level) });
    }
  });

  return [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, pt]) => {
      const d = new Date(pt.ts);
      const label = period === 'day'
        ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' })
        : period === 'month'
          ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Africa/Lagos' })
          : d.toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', timeZone: 'Africa/Lagos' });
      return { label, level: Math.round(pt.level * 10) / 10, time: d.toISOString() };
    });
}

function fmtRefillWhen(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function lastRefillForAsset(refuels: RefuelRow[] | undefined, assetId: string): RefuelRow | null {
  if (!refuels?.length) return null;
  const forAsset = refuels
    .filter(r => r.assetId === assetId)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return forAsset[0] ?? null;
}

export default function FuelChartWidget() {
  const { vehicles } = useFleet();
  const [period, setPeriod] = useState<FuelPeriod>('week');
  const [customRange, setCustomRange] = useState(defaultCustomRange);
  const consPeriod = period === 'custom' ? 'week' : period === 'day' || period === 'month' ? period : 'week';
  const consUrl = `/api/fuel/consumption?period=${consPeriod}`;
  const histUrl = historyUrl(period, customRange);
  const [allSeries, setAllSeries] = useState<FuelSeries[]>(
    () => peekFuelHistory<FuelSeries[]>(histUrl) ?? [],
  );
  const [refuels, setRefuels] = useState<RefuelRow[]>(
    () => peekFuelConsumption(consUrl)?.refuels ?? [],
  );
  const [loading, setLoading] = useState(
    () => !peekFuelHistory(histUrl),
  );

  const liveQuarryIds = useMemo(() => {
    const ids = new Set<string>();
    vehicles.forEach(v => {
      const zone = (v.zone || '').toUpperCase();
      if (!isQuarryZone(zone)) return;
      const level = (v as { fuelLevel?: { level: number } | null }).fuelLevel;
      if (level != null) ids.add(v.id);
    });
    return ids;
  }, [vehicles]);

  const liveLevels = useMemo(() => {
    const map = new Map<string, number>();
    vehicles.forEach(v => {
      const zone = (v.zone || '').toUpperCase();
      if (!isQuarryZone(zone)) return;
      const level = (v as { fuelLevel?: { level: number } | null }).fuelLevel?.level;
      if (level != null && Number.isFinite(level)) map.set(v.id, Math.max(0, level));
    });
    return map;
  }, [vehicles]);

  // History drives the card; consumption (refills) is optional and must not block display.
  useEffect(() => {
    let cancelled = false;
    const url = historyUrl(period, customRange);
    setLoading(true);
    const cached = peekFuelHistory<FuelSeries[]>(url);
    if (cached) {
      setAllSeries(cached.map(s => ({
        ...s,
        data: s.data.map(pt => ({ ...pt, level: Math.max(0, pt.level) })),
      })));
    } else {
      setAllSeries([]);
    }

    const pull = async (silent = false) => {
      try {
        const hist = await fetchFuelHistoryCached<FuelSeries[]>(url, { force: silent });
        if (cancelled || !hist) return;
        setAllSeries(hist.map(s => ({
          ...s,
          data: s.data.map(pt => ({ ...pt, level: Math.max(0, pt.level) })),
        })));
      } catch {
        /* keep prior on silent poll failure */
      } finally {
        if (!cancelled && !silent) setLoading(false);
      }
    };

    void pull(false);
    const id = setInterval(() => void pull(true), 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [period, customRange.from, customRange.to]);

  useEffect(() => {
    let cancelled = false;
    const nextConsPeriod = period === 'custom' ? 'week' : period === 'day' || period === 'month' ? period : 'week';
    const url = `/api/fuel/consumption?period=${nextConsPeriod}`;
    const cached = peekFuelConsumption(url);
    if (cached) setRefuels(cached.refuels ?? []);

    const pull = async (silent = false) => {
      try {
        const cons = await fetchFuelConsumptionCached(url, { force: silent });
        if (!cancelled && cons) setRefuels(cons.refuels ?? []);
      } catch { /* keep prior */ }
    };

    void pull(false);
    const id = setInterval(() => void pull(true), 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [period]);

  const active = useMemo(
    () => pickActiveQuarrySeries(allSeries, liveQuarryIds, liveLevels),
    [allSeries, liveQuarryIds, liveLevels],
  );

  // Live probe fallback: show a real non-zero quarry reading even before history arrives
  const liveFallback = useMemo(() => {
    if (active) return null;
    let best: { id: string; regNo: string; zone: string; level: number } | null = null;
    vehicles.forEach(v => {
      const zone = (v.zone || '').toUpperCase();
      if (!isQuarryZone(zone)) return;
      const level = (v as { fuelLevel?: { level: number } | null }).fuelLevel?.level;
      if (level == null || !(level > 0)) return;
      if (!best || level > best.level) {
        best = { id: v.id, regNo: v.regNo, zone, level };
      }
    });
    return best;
  }, [active, vehicles]);

  const chartData = useMemo(
    () => (active ? bucketSeries(active, period) : []),
    [active, period],
  );

  const liveLevel = active ? liveLevels.get(active.assetId) : liveFallback?.level;
  const chartLevel = chartData.length ? chartData[chartData.length - 1].level : null;
  const currentLevel = liveLevel != null && liveLevel > 0
    ? liveLevel
    : chartLevel != null && chartLevel > 0
      ? chartLevel
      : liveFallback?.level ?? liveLevel ?? chartLevel;

  const lastRefill = active ? lastRefillForAsset(refuels, active.assetId) : null;
  const zone = ((active?.zone || liveFallback?.zone) || '').toUpperCase() as QuarrySiteKey;
  const color = fuelZoneColor(zone);
  const siteLabel = isQuarryZone(zone) ? QUARRY_SITE_LABELS[zone] : 'Quarry';
  const displayReg = (active?.regNo || liveFallback?.regNo || '').trim();
  const detailAssetId = active?.assetId || liveFallback?.id;

  const detailHref = detailAssetId
    ? `/fuel/monitoring?site=${encodeURIComponent(zone)}&asset=${encodeURIComponent(detailAssetId)}`
    : '/fuel/monitoring';

  return (
    <div className="bpl-card bpl-home-mid-panel bpl-fuel-widget-card">
      <div className="bpl-card-header">
        <div className="bpl-fuel-widget-title-row">
          <span className="bpl-card-title">Fuel Consumption</span>
          {lastRefill && (
            <span className="bpl-fuel-widget-refill-meta" title="Most recent refill on this device">
              Last refill +{Math.round(lastRefill.deltaLiters)} L · {fmtRefillWhen(lastRefill.timestamp)}
            </span>
          )}
        </div>
        <Link to={detailHref} className="bpl-card-link">See all</Link>
      </div>
      <div className="bpl-card-body bpl-fuel-widget-body">
        {period === 'custom' && (
          <div className="bpl-fuel-custom-row">
            <input type="date" value={customRange.from} max={customRange.to} onChange={e => setCustomRange(r => ({ ...r, from: e.target.value }))} />
            <span>to</span>
            <input type="date" value={customRange.to} min={customRange.from} onChange={e => setCustomRange(r => ({ ...r, to: e.target.value }))} />
          </div>
        )}

        <div className="bpl-fuel-summary">
          <div className="bpl-fuel-summary-meta">
            <div className="bpl-fuel-period-label">
              <PeriodSelect value={period} onChange={setPeriod} includeCustom />
            </div>
            <div className="bpl-fuel-total" style={{ color }}>
              {currentLevel != null && currentLevel > 0
                ? `${Math.round(currentLevel).toLocaleString()} L`
                : loading
                  ? '—'
                  : currentLevel != null
                    ? `${Math.round(currentLevel).toLocaleString()} L`
                    : '—'}
            </div>
            <div className="bpl-fuel-total-scope">
              {displayReg
                ? `${displayReg} · ${siteLabel} probe`
                : 'Quarry probe'}
            </div>
          </div>
        </div>

        <div className="bpl-fuel-chart-area">
          <DataRegion busy={loading} variant="chart" tall label="Loading fuel data">
            {chartData.length === 0 ? (
              <div className="bpl-fuel-chart-empty">No quarry probe readings in this period</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="fuelGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={color} stopOpacity={0.3} />
                      <stop offset="100%" stopColor={color} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 10, fill: 'var(--cd-text-muted)' }}
                    axisLine={false}
                    tickLine={false}
                    interval={period === 'month' ? 4 : period === 'day' ? 3 : 2}
                  />
                  <YAxis
                    tickFormatter={v => `${v}L`}
                    tick={{ fontSize: 10, fill: 'var(--cd-text-muted)' }}
                    tickLine={false}
                    axisLine={false}
                    width={40}
                    allowDecimals={false}
                    tickCount={5}
                    domain={['auto', 'auto']}
                  />
                  <Tooltip
                    contentStyle={{ background: 'var(--cd-surface)', border: '1px solid var(--cd-border)', borderRadius: 8, fontSize: 12 }}
                    formatter={(value: number) => [`${Math.round(value).toLocaleString()} L`, 'Fuel level']}
                    labelFormatter={label => String(label)}
                  />
                  <Area type="monotone" dataKey="level" stroke={color} fill="url(#fuelGrad)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </DataRegion>
        </div>
      </div>
    </div>
  );
}
