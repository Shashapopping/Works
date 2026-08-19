import { useState, useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import PeriodSelect, { type PeriodValue } from './PeriodSelect';
import { useFleet } from '../../context/FleetContext';
import {
  QUARRY_SITE_KEYS,
  QUARRY_SITE_LABELS,
  fuelZoneColor,
  findFuelSeries,
  type FuelSeries,
  type QuarrySiteKey,
} from '../FuelChart';
import {
  analyzeFuelSignal,
  buildStableFuelSeries,
  periodBucketMinutes,
} from '../../lib/fuelSignal';
import {
  fetchFuelHistoryCached,
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

function scoreFuelSeries(
  s: FuelSeries,
  liveLevels: Map<string, number>,
  period: FuelPeriod,
) {
  const live = liveLevels.get(String(s.assetId));
  const hist = seriesLatestLevel(s);
  const level = live != null && live > 0 ? live : hist;
  const points = bucketSeries(s, period).length;
  const hasLiveFuel = live != null && live > 0;
  return {
    series: s,
    level,
    points,
    hasLiveFuel,
    lastTs: seriesLastTs(s),
  };
}

/** Prefer quarry assets that can actually draw a fuel line (not an empty / 1-point series). */
function pickActiveQuarrySeries(
  all: FuelSeries[],
  liveLevels: Map<string, number>,
  period: FuelPeriod,
  pinnedAssetId?: string | null,
): FuelSeries | null {
  const withData = all.filter(s => s.data.length > 0);
  if (!withData.length) return null;

  const quarryTagged = withData.filter(s => isQuarryZone(s.zone));
  const pool = quarryTagged.length ? quarryTagged : withData;

  const scored = pool.map(s => scoreFuelSeries(s, liveLevels, period));
  const drawable = scored.filter(s => s.points >= 2);
  const withPoints = scored.filter(s => s.points >= 1);
  const ranked = (drawable.length ? drawable : withPoints.length ? withPoints : scored)
    .sort((a, b) => (
      b.points - a.points
      || Number(b.hasLiveFuel) - Number(a.hasLiveFuel)
      || b.lastTs - a.lastTs
      || b.level - a.level
      || String(a.series.assetId).localeCompare(String(b.series.assetId))
    ));

  if (pinnedAssetId) {
    const pinned = ranked.find(s => String(s.series.assetId) === String(pinnedAssetId));
    if (pinned && pinned.points >= 1) return pinned.series;
  }

  return ranked[0]?.series ?? null;
}

function bucketSeries(series: FuelSeries, period: FuelPeriod): ChartPoint[] {
  const bucketMin = periodBucketMinutes(period === 'custom' ? 'week' : period);
  const stable = buildStableFuelSeries(series.data, bucketMin);
  return stable.map(pt => {
    const d = new Date(pt.timestamp);
    const label = period === 'day'
      ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' })
      : period === 'month'
        ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Africa/Lagos' })
        : d.toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', timeZone: 'Africa/Lagos' });
    return { label, level: pt.levelL, time: d.toISOString() };
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

function lastRefillFromSeries(series: FuelSeries, period: FuelPeriod) {
  const bucketMin = periodBucketMinutes(period === 'custom' ? 'week' : period);
  const stable = buildStableFuelSeries(series.data, bucketMin);
  const { refuels } = analyzeFuelSignal(stable, bucketMin);
  if (!refuels.length) return null;
  return refuels[refuels.length - 1];
}

export default function FuelChartWidget() {
  const { vehicles } = useFleet();
  const [period, setPeriod] = useState<FuelPeriod>('week');
  const [customRange, setCustomRange] = useState(defaultCustomRange);
  const histUrl = historyUrl(period, customRange);
  const [allSeries, setAllSeries] = useState<FuelSeries[]>(
    () => peekFuelHistory<FuelSeries[]>(histUrl) ?? [],
  );
  const [loading, setLoading] = useState(
    () => !peekFuelHistory(histUrl),
  );

  const pinnedAssetRef = useRef<string | null>(null);

  const liveLevels = useMemo(() => {
    const map = new Map<string, number>();
    vehicles.forEach(v => {
      const zone = (v.zone || '').toUpperCase();
      if (!isQuarryZone(zone)) return;
      const level = (v as { fuelLevel?: { level: number } | null }).fuelLevel?.level;
      if (level != null && Number.isFinite(level)) map.set(String(v.id), Math.max(0, level));
    });
    return map;
  }, [vehicles]);

  // History drives the card; consumption (refills) is optional and must not block display.
  useEffect(() => {
    pinnedAssetRef.current = null;
  }, [period, customRange.from, customRange.to]);

  useEffect(() => {
    let cancelled = false;
    const url = historyUrl(period, customRange);
    const cached = peekFuelHistory<FuelSeries[]>(url);
    const hasCached = Boolean(cached?.length);
    if (hasCached) setLoading(false);
    else setLoading(true);
    if (cached?.length) {
      setAllSeries(cached.map(s => ({
        ...s,
        data: s.data.map(pt => ({ ...pt, level: Math.max(0, pt.level) })),
      })));
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

    void pull(!hasCached);
    const id = setInterval(() => void pull(true), 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [period, customRange.from, customRange.to]);

  const active = useMemo(() => {
    const picked = pickActiveQuarrySeries(
      allSeries,
      liveLevels,
      period,
      pinnedAssetRef.current,
    );
    if (picked) pinnedAssetRef.current = String(picked.assetId);
    else pinnedAssetRef.current = null;
    return picked;
  }, [allSeries, liveLevels, period]);

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
        best = { id: String(v.id), regNo: v.regNo, zone, level };
      }
    });
    return best;
  }, [active, vehicles]);

  const displaySeries = useMemo(() => {
    if (active) return active;
    if (!liveFallback) return null;
    return findFuelSeries(allSeries, { assetId: liveFallback.id, regNo: liveFallback.regNo }) ?? null;
  }, [active, liveFallback, allSeries]);

  const chartData = useMemo(
    () => (displaySeries ? bucketSeries(displaySeries, period) : []),
    [displaySeries, period],
  );

  const liveLevel = displaySeries ? liveLevels.get(String(displaySeries.assetId)) : liveFallback?.level;
  const chartLevel = chartData.length ? chartData[chartData.length - 1].level : null;
  const currentLevel = liveLevel != null && liveLevel > 0
    ? liveLevel
    : chartLevel != null && chartLevel > 0
      ? chartLevel
      : liveFallback?.level ?? liveLevel ?? chartLevel;

  const lastRefill = displaySeries ? lastRefillFromSeries(displaySeries, period) : null;
  const zone = ((displaySeries?.zone || liveFallback?.zone) || '').toUpperCase() as QuarrySiteKey;
  const color = fuelZoneColor(zone);
  const siteLabel = isQuarryZone(zone) ? QUARRY_SITE_LABELS[zone] : 'Quarry';
  const displayReg = (displaySeries?.regNo || liveFallback?.regNo || '').trim();
  const detailAssetId = displaySeries?.assetId || liveFallback?.id;

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
          <DataRegion busy={loading && chartData.length === 0} variant="chart" tall label="Loading fuel data">
            {chartData.length === 0 ? (
              <div className="bpl-fuel-chart-empty">No quarry probe readings in this period</div>
            ) : (
              <ResponsiveContainer width="100%" height={160}>
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
                  <Area
                    type="stepAfter"
                    dataKey="level"
                    stroke={color}
                    fill="url(#fuelGrad)"
                    strokeWidth={2.5}
                    dot={false}
                    activeDot={{ r: 4, fill: color, stroke: '#fff', strokeWidth: 2 }}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </DataRegion>
        </div>
      </div>
    </div>
  );
}
