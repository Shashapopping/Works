import {
  createContext, useContext, useEffect, useMemo, useState, useTransition, type ReactNode,
} from 'react';
import {
  ArrowDown, ArrowUp, BarChart3, Car, Download, Info, MapPin, Settings, User,
} from 'lucide-react';
import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { authFetch, type LogEntry, type TripDriver } from '../context/FleetContext';
import { buildDriverConsequenceCard } from '../lib/consequenceScore';
import { isActiveDriver, isActiveDriverId, isKnownDriver, displayDriverName } from '../lib/driverUtils';
import { sanitizeTripDriver } from '../lib/demoSanitize';
import type { ConsumptionData } from '../lib/fuelConsumption';
import { CACHE_KEYS, CACHE_TTL, cachedFetchJson } from '../lib/apiCache';
import { chartDef, type TrendsChartId, type TrendsGrouping, type TrendsScope } from '../lib/trendsDashboard';
import {
  bucketKeyFromDay,
  bucketKeyFromIso,
  bucketLabel,
  downloadTextFile,
  entityKey,
  rowsToCsv,
  sortBucketKeys,
} from '../lib/trendsBucket';
import { useFleet } from '../context/FleetContext';

const BAND = { green: '#58b06d', amber: '#f0ad4e', red: '#e74c3c' };
const SERIES = ['#2b71b1', '#50b2e1', '#58b06d', '#f0ad4e', '#9333ea', '#0d9488', '#64748b'];

const TrendsViewCtx = createContext<{ grouping: TrendsGrouping; scope: TrendsScope }>({
  grouping: 'day',
  scope: 'asset',
});

function useTrendsView() {
  return useContext(TrendsViewCtx);
}

/** Estimated minutes per event type when MiX duration is absent. */
const DURATION_MIN: Record<string, number> = {
  'Harsh Braking': 0.2,
  'Harsh Acceleration': 0.2,
  'Harsh Cornering': 0.3,
  Overspeeding: 2,
  'Overspeed Tiered': 3,
  Idle: 5,
  'Excessive Idle': 10,
};

/** Calendar day in Africa/Lagos (WAT, UTC+1) — not raw UTC from ISO slice. */
function dayKey(iso: string) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
    return '';
  }
  const lagos = new Date(ms + 3_600_000);
  const y = lagos.getUTCFullYear();
  const m = String(lagos.getUTCMonth() + 1).padStart(2, '0');
  const d = String(lagos.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function todayLagosKey() {
  return dayKey(new Date().toISOString());
}

function litersToGallons(l: number) {
  return l * 0.264172;
}

type ChartAction = 'edit' | 'remove';

const ChartActionsCtx = createContext<{
  onAction?: (action: ChartAction) => void;
  infoText?: string;
}>({});

function cardShell({
  title,
  icon,
  subtitle,
  caption,
  children,
  wide,
  scope,
  infoText,
  onDownload,
}: {
  title: string;
  icon?: React.ReactNode;
  subtitle?: string;
  caption?: string;
  children: React.ReactNode;
  wide?: boolean;
  scope?: TrendsScope;
  infoText?: string;
  onDownload?: () => void;
}) {
  const actions = useContext(ChartActionsCtx);
  const tip = infoText || actions.infoText || subtitle || title;
  const [menuOpen, setMenuOpen] = useState(false);
  const canSettings = Boolean(actions.onAction);

  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: 6,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 320,
        gridColumn: wide ? '1 / -1' : undefined,
        position: 'relative',
      }}
    >
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 12px', borderBottom: '1px solid #eef0f2', gap: 8,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          {icon}
          <strong style={{
            fontSize: 12, letterSpacing: '0.02em', color: '#374151',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            textTransform: 'uppercase',
          }}>
            {title}
          </strong>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0, position: 'relative' }}>
          <button
            type="button"
            title={tip}
            aria-label={tip}
            style={{
              width: 34, height: 30, border: 'none', cursor: 'help',
              background: 'transparent', color: '#6b7280',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Info size={14} />
          </button>
          <button
            type="button"
            title="Download CSV"
            onClick={onDownload}
            disabled={!onDownload}
            style={{
              width: 34, height: 30, border: 'none', cursor: onDownload ? 'pointer' : 'default',
              borderLeft: '1px solid #e5e7eb',
              background: 'transparent', color: onDownload ? '#6b7280' : '#d1d5db',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Download size={14} />
          </button>
          <button
            type="button"
            title="Chart settings"
            onClick={() => canSettings && setMenuOpen(v => !v)}
            disabled={!canSettings}
            style={{
              width: 34, height: 30, border: 'none', cursor: canSettings ? 'pointer' : 'default',
              borderLeft: '1px solid #e5e7eb',
              background: menuOpen ? '#f3f4f6' : 'transparent',
              color: canSettings ? '#6b7280' : '#d1d5db',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Settings size={14} />
          </button>
          {menuOpen && actions.onAction && (
            <div
              style={{
                position: 'absolute', top: '100%', right: 0, zIndex: 20,
                marginTop: 4, minWidth: 180, background: '#fff',
                border: '1px solid #e5e7eb', borderRadius: 6,
                boxShadow: '0 8px 24px rgba(0,0,0,0.12)', overflow: 'hidden',
              }}
            >
              <button
                type="button"
                onClick={() => { actions.onAction?.('edit'); setMenuOpen(false); }}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px',
                  border: 'none', background: '#fff', fontSize: 13, color: '#374151', cursor: 'pointer',
                }}
              >
                Customise dashboard
              </button>
              <button
                type="button"
                onClick={() => { actions.onAction?.('remove'); setMenuOpen(false); }}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px',
                  border: 'none', borderTop: '1px solid #eef0f2', background: '#fff',
                  fontSize: 13, color: '#b91c1c', cursor: 'pointer',
                }}
              >
                Remove this chart
              </button>
            </div>
          )}
        </div>
      </div>
      <div style={{ padding: '12px 14px 16px', flex: 1 }}>
        {(subtitle || caption) && (
          <>
            {subtitle && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#1f2937' }}>{subtitle}</div>
                {scope === 'driver' ? <User size={13} color="#9ca3af" /> : <Car size={13} color="#9ca3af" />}
              </div>
            )}
            {caption && <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>{caption}</div>}
          </>
        )}
        {children}
      </div>
    </div>
  );
}

type TripStats = {
  km: number;
  trips: number;
  hours: number;
  assets: number;
  drivers: TripDriver[];
  loading: boolean;
};

type DriverBands = {
  counts: { Green: number; Amber: number; Red: number };
  distance: { Green: number; Amber: number; Red: number };
  totalDrivers: number;
  pct: { green: number; amber: number; red: number };
  top: { name: string; score: number; category: 'Green' | 'Amber' | 'Red'; km: number }[];
  bottom: { name: string; score: number; category: 'Green' | 'Amber' | 'Red'; km: number }[];
  avg: number;
  dayLabel: string;
  scored: { name: string; score: number; category: 'Green' | 'Amber' | 'Red'; km: number }[];
  ready: boolean;
};

type TrendsSharedValue = {
  caption: string;
  tripStats: TripStats;
  consumption: ConsumptionData | null;
  consumptionLoading: boolean;
  bands: DriverBands;
};

const EMPTY_BANDS: DriverBands = {
  counts: { Green: 0, Amber: 0, Red: 0 },
  distance: { Green: 0, Amber: 0, Red: 0 },
  totalDrivers: 0,
  pct: { green: 0, amber: 0, red: 0 },
  top: [],
  bottom: [],
  avg: 0,
  dayLabel: new Date().toLocaleDateString('en-GB', { weekday: 'long' }),
  scored: [],
  ready: false,
};

const TrendsSharedCtx = createContext<TrendsSharedValue | null>(null);

function computeCaption(events: LogEntry[]) {
  let min = '';
  let max = '';
  for (const e of events) {
    const d = dayKey(e.eventTime || e.timestamp);
    if (!d) continue;
    if (!min || d < min) min = d;
    if (!max || d > max) max = d;
  }
  if (!min) {
    return new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  }
  const fmt = (iso: string) => {
    const dt = new Date(`${iso}T12:00:00`);
    return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  };
  return min === max ? fmt(min) : `${fmt(min)} – ${fmt(max)}`;
}

function computeDriverBands(events: LogEntry[], drivers: TripDriver[]): DriverBands {
  const byDriver = new Map<string, { name: string; events: LogEntry[]; km: number }>();
  for (const e of events) {
    if (e.type === 'panic') continue;
    if (!isActiveDriver(e.driverName, e.driverId)) continue;
    const key = (e.driverId && isActiveDriverId(e.driverId)) ? e.driverId : e.driverName!;
    if (!byDriver.has(key)) byDriver.set(key, { name: e.driverName!, events: [], km: 0 });
    byDriver.get(key)!.events.push(e);
  }
  for (const t of drivers) {
    if (!isActiveDriver(t.driverName, t.driverId)) continue;
    const key = (t.driverId && isActiveDriverId(t.driverId)) ? t.driverId : t.driverName;
    const row = byDriver.get(key);
    if (row) row.km += t.totalDistanceKm || 0;
    else byDriver.set(key, { name: t.driverName, events: [], km: t.totalDistanceKm || 0 });
  }

  const counts = { Green: 0, Amber: 0, Red: 0 };
  const distance = { Green: 0, Amber: 0, Red: 0 };
  const scored: DriverBands['scored'] = [];

  for (const row of byDriver.values()) {
    const card = buildDriverConsequenceCard({ events: row.events, distanceKm: row.km || 1 });
    const band: 'Green' | 'Amber' | 'Red' =
      card.category === 'Green' ? 'Green' : card.category === 'Red' ? 'Red' : 'Amber';
    counts[band]++;
    distance[band] += row.km;
    scored.push({ name: displayDriverName(row.name), score: card.displayScore, category: band, km: row.km });
  }

  const total = counts.Green + counts.Amber + counts.Red || 1;
  scored.sort((a, b) => a.score - b.score);
  const n = Math.max(1, Math.ceil(scored.length * 0.1));
  const bottom = scored.slice(0, n);
  const top = scored.slice(-n).reverse();
  const avg = scored.length ? scored.reduce((s, d) => s + d.score, 0) / scored.length : 0;

  return {
    counts,
    distance,
    totalDrivers: counts.Green + counts.Amber + counts.Red,
    pct: {
      green: (counts.Green / total) * 100,
      amber: (counts.Amber / total) * 100,
      red: (counts.Red / total) * 100,
    },
    top,
    bottom,
    avg,
    dayLabel: new Date().toLocaleDateString('en-GB', { weekday: 'long' }),
    scored,
    ready: true,
  };
}

async function fetchTripStats(): Promise<Omit<TripStats, 'loading'>> {
  const data = await cachedFetchJson<{
    drivers?: TripDriver[];
    totalDistanceKm?: number;
  }>(
    'trends:driver-distance:currentMonth',
    60_000,
    async () => {
      const res = await authFetch('/api/driver-distance?range=currentMonth');
      if (!res.ok) return null;
      return res.json();
    },
  );
  const drivers = ((data?.drivers || []) as TripDriver[]).map(sanitizeTripDriver);
  const assets = new Set(drivers.flatMap(d => d.vehicles || [])).size;
  return {
    km: Number(data?.totalDistanceKm || drivers.reduce((s, d) => s + (d.totalDistanceKm || 0), 0)),
    trips: drivers.reduce((s, d) => s + (d.journeyCount || 0), 0),
    hours: drivers.reduce((s, d) => s + ((d.totalDrivingTimeSeconds || 0) / 3600), 0),
    assets: assets || drivers.length,
    drivers,
  };
}

/** Shared once per Trends page — kills N× trip/fuel fetches and N× band scoring. */
export function TrendsSharedDataProvider({
  events,
  children,
}: {
  events: LogEntry[];
  children: ReactNode;
}) {
  const [, startTransition] = useTransition();
  const [tripStats, setTripStats] = useState<TripStats>({
    km: 0, trips: 0, hours: 0, assets: 0, drivers: [], loading: true,
  });
  const [consumption, setConsumption] = useState<ConsumptionData | null>(null);
  const [consumptionLoading, setConsumptionLoading] = useState(true);
  const [bands, setBands] = useState<DriverBands>(EMPTY_BANDS);

  const caption = useMemo(() => computeCaption(events), [events]);

  useEffect(() => {
    let cancelled = false;
    setTripStats(prev => ({ ...prev, loading: true }));
    fetchTripStats()
      .then(next => {
        if (!cancelled) setTripStats({ ...next, loading: false });
      })
      .catch(() => {
        if (!cancelled) setTripStats(prev => ({ ...prev, loading: false }));
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setConsumptionLoading(true);
    const url = '/api/fuel/consumption?period=week';
    cachedFetchJson<ConsumptionData>(
      CACHE_KEYS.fuelConsumption(url),
      CACHE_TTL.fuelConsumption,
      async () => {
        const res = await authFetch(url);
        if (!res.ok) return null;
        return res.json();
      },
    )
      .then(json => {
        if (!cancelled) {
          setConsumption(json);
          setConsumptionLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setConsumptionLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    setBands(prev => ({ ...prev, ready: false }));
    const handle = window.setTimeout(() => {
      startTransition(() => {
        setBands(computeDriverBands(events, tripStats.drivers));
      });
    }, 0);
    return () => window.clearTimeout(handle);
  }, [events, tripStats.drivers]);

  const value = useMemo<TrendsSharedValue>(() => ({
    caption,
    tripStats,
    consumption,
    consumptionLoading,
    bands,
  }), [caption, tripStats, consumption, consumptionLoading, bands]);

  return (
    <TrendsSharedCtx.Provider value={value}>
      {children}
    </TrendsSharedCtx.Provider>
  );
}

function useCaption(events: LogEntry[]) {
  const shared = useContext(TrendsSharedCtx);
  const local = useMemo(() => computeCaption(events), [events]);
  return shared?.caption ?? local;
}

function useTripStats(): TripStats {
  const shared = useContext(TrendsSharedCtx);
  const [stats, setStats] = useState<TripStats>({
    km: 0, trips: 0, hours: 0, assets: 0, drivers: [], loading: !shared,
  });
  useEffect(() => {
    if (shared) return;
    let cancelled = false;
    fetchTripStats()
      .then(next => {
        if (!cancelled) setStats({ ...next, loading: false });
      })
      .catch(() => {
        if (!cancelled) setStats(prev => ({ ...prev, loading: false }));
      });
    return () => { cancelled = true; };
  }, [shared]);
  return shared?.tripStats ?? stats;
}

function useConsumption(period: 'week' | 'month' = 'week') {
  const shared = useContext(TrendsSharedCtx);
  const [data, setData] = useState<ConsumptionData | null>(
    shared && period === 'week' ? shared.consumption : null,
  );
  useEffect(() => {
    if (shared && period === 'week') {
      setData(shared.consumption);
      return;
    }
    let cancelled = false;
    const url = `/api/fuel/consumption?period=${period}`;
    cachedFetchJson<ConsumptionData>(
      CACHE_KEYS.fuelConsumption(url),
      CACHE_TTL.fuelConsumption,
      async () => {
        const res = await authFetch(url);
        if (!res.ok) return null;
        return res.json();
      },
    )
      .then(json => {
        if (!cancelled) setData(json);
      })
      .catch(() => { /* ignore */ });
    return () => { cancelled = true; };
  }, [period, shared, shared?.consumption]);
  return data;
}

function useConsumptionLoading() {
  return useContext(TrendsSharedCtx)?.consumptionLoading ?? false;
}

function useDriverBands(events: LogEntry[]): DriverBands {
  const shared = useContext(TrendsSharedCtx);
  const tripStats = useTripStats();
  const local = useMemo(
    () => (shared ? EMPTY_BANDS : computeDriverBands(events, tripStats.drivers)),
    [shared, events, tripStats.drivers],
  );
  return shared?.bands ?? local;
}

function ChartSkeleton({ tall }: { tall?: boolean }) {
  return (
    <div
      className={`bpl-chart-skel${tall ? ' bpl-chart-skel--tall' : ''}`}
      role="status"
      aria-live="polite"
      aria-label="Loading chart"
    >
      <div className="bpl-chart-skel__bars" aria-hidden>
        {[42, 68, 55, 82, 48, 74, 60, 36].map((h, i) => (
          <span key={i} style={{ height: `${h}%`, animationDelay: `${i * 70}ms` }} />
        ))}
      </div>
      <div className="bpl-chart-skel__footer">
        <span className="bpl-skel bpl-skel--line-mid" />
        <span className="bpl-chart-skel__label">Preparing chart…</span>
      </div>
    </div>
  );
}

function TrendsChartPlaceholder({
  chartId,
  wide,
}: {
  chartId: TrendsChartId;
  wide?: boolean;
}) {
  const def = chartDef(chartId);
  return (
    <div
      className="bpl-trends-chart-placeholder"
      style={{ gridColumn: wide ? '1 / -1' : undefined }}
      aria-busy="true"
    >
      <div className="bpl-trends-chart-placeholder__head">
        <strong>{def?.title || 'Chart'}</strong>
      </div>
      <div className="bpl-trends-chart-placeholder__body">
        {def?.subtitle && (
          <div style={{ fontSize: 14, fontWeight: 600, color: '#1f2937', marginBottom: 2 }}>
            {def.subtitle}
          </div>
        )}
        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>Loading figures…</div>
        <ChartSkeleton tall={def?.kind === 'driver-performance' || def?.kind === 'fuel-distance'} />
      </div>
    </div>
  );
}

/** Mount chart after paint so the page shell / placeholders appear instantly on tap. */
export function DeferredTrendsExtraChart({
  chartId,
  events,
  scope,
  grouping = 'day',
  mountDelay = 0,
  onEditDashboard,
  onRemoveChart,
}: {
  chartId: TrendsChartId;
  events: LogEntry[];
  scope: TrendsScope;
  grouping?: TrendsGrouping;
  mountDelay?: number;
  onEditDashboard?: () => void;
  onRemoveChart?: (id: TrendsChartId) => void;
}) {
  const [ready, setReady] = useState(false);
  const def = chartDef(chartId);
  const wide = def?.kind === 'driver-performance' || def?.kind === 'fuel-distance';

  useEffect(() => {
    setReady(false);
    let idleId = 0;
    let timer = 0;
    const show = () => setReady(true);
    const schedule = () => {
      if (typeof requestIdleCallback !== 'undefined') {
        idleId = requestIdleCallback(show, { timeout: 500 + mountDelay }) as unknown as number;
      } else {
        timer = window.setTimeout(show, Math.max(16, mountDelay));
      }
    };
    timer = window.setTimeout(schedule, mountDelay);
    return () => {
      window.clearTimeout(timer);
      if (idleId && typeof cancelIdleCallback !== 'undefined') cancelIdleCallback(idleId);
    };
  }, [chartId, mountDelay, scope, grouping]);

  if (!ready) return <TrendsChartPlaceholder chartId={chartId} wide={wide} />;

  return (
    <TrendsExtraChart
      chartId={chartId}
      events={events}
      scope={scope}
      grouping={grouping}
      onEditDashboard={onEditDashboard}
      onRemoveChart={onRemoveChart}
    />
  );
}

function EventValuesChart({ events, scope }: { events: LogEntry[]; scope: TrendsScope }) {
  const caption = useCaption(events);
  const { grouping } = useTrendsView();
  const { data, keys } = useMemo(() => {
    const byBucket = new Map<string, Record<string, number>>();
    const totals = new Map<string, number>();
    for (const e of events) {
      if (e.type === 'panic') continue;
      const seriesKey = entityKey(e, scope);
      const bucket = bucketKeyFromIso(e.eventTime || e.timestamp, grouping);
      if (!bucket) continue;
      if (!byBucket.has(bucket)) byBucket.set(bucket, {});
      const row = byBucket.get(bucket)!;
      row[seriesKey] = (row[seriesKey] || 0) + 1;
      totals.set(seriesKey, (totals.get(seriesKey) || 0) + 1);
    }
    const keys = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k]) => k);
    const data = sortBucketKeys([...byBucket.keys()], grouping).map(bucket => {
      const counts = byBucket.get(bucket) || {};
      const row: Record<string, string | number> = { label: bucketLabel(bucket, grouping) };
      for (const k of keys) row[k] = counts[k] || 0;
      return row;
    });
    return { data, keys };
  }, [events, grouping, scope]);

  return cardShell({
    title: 'Event values',
    icon: <BarChart3 size={15} color="#6b7280" />,
    subtitle: scope === 'driver' ? 'Event counts by driver over time' : 'Event counts by asset over time',
    caption,
    scope,
    infoText: 'Stacked event counts for the top entities in the selected period, grouped by the toolbar grouping.',
    onDownload: data.length
      ? () => downloadTextFile('event-values.csv', rowsToCsv(data))
      : undefined,
    children: data.length === 0 ? (
      <Empty />
    ) : (
      <>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 4 }}>
            <CartesianGrid stroke="rgba(0,0,0,0.08)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={40} />
            <Tooltip contentStyle={{ fontSize: 12 }} />
            {keys.map((k, i) => (
              <Bar key={k} dataKey={k} stackId="a" fill={SERIES[i % SERIES.length]} maxBarSize={56} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
        <LegendRow items={keys.map((k, i) => [k, SERIES[i % SERIES.length]] as [string, string])} />
      </>
    ),
  });
}

function EventDurationChart({ events, scope }: { events: LogEntry[]; scope: TrendsScope }) {
  const caption = useCaption(events);
  const { grouping } = useTrendsView();
  const data = useMemo(() => {
    const byBucket = new Map<string, { totalMin: number; count: number }>();
    for (const e of events) {
      if (e.type === 'panic') continue;
      const label = e.label || '';
      const bucket = bucketKeyFromIso(e.eventTime || e.timestamp, grouping);
      if (!bucket) continue;
      const mins = DURATION_MIN[label] ?? 1;
      if (!byBucket.has(bucket)) byBucket.set(bucket, { totalMin: 0, count: 0 });
      const row = byBucket.get(bucket)!;
      row.totalMin += mins;
      row.count += 1;
    }
    return sortBucketKeys([...byBucket.keys()], grouping).map(bucket => {
      const v = byBucket.get(bucket)!;
      return {
        label: bucketLabel(bucket, grouping),
        avgMinutes: v.count ? +(v.totalMin / v.count).toFixed(2) : 0,
        totalMinutes: +v.totalMin.toFixed(1),
      };
    });
  }, [events, grouping]);

  return cardShell({
    title: 'Event duration',
    icon: <BarChart3 size={15} color="#6b7280" />,
    subtitle: 'Average event duration over time',
    caption,
    scope,
    infoText: 'Estimated average and total event duration using typical durations per event type.',
    onDownload: data.length
      ? () => downloadTextFile('event-duration.csv', rowsToCsv(data))
      : undefined,
    children: data.length === 0 ? (
      <Empty />
    ) : (
      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 4 }}>
          <CartesianGrid stroke="rgba(0,0,0,0.08)" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} width={40} />
          <Tooltip contentStyle={{ fontSize: 12 }} />
          <Bar dataKey="avgMinutes" name="Avg minutes" fill="#2b71b1" maxBarSize={48} isAnimationActive={false} />
          <Line type="monotone" dataKey="totalMinutes" name="Total minutes" stroke="#50b2e1" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    ),
  });
}

function FuelDistanceChart({ events, scope }: { events: LogEntry[]; scope: TrendsScope }) {
  const caption = useCaption(events);
  const cons = useConsumption('week');
  const consLoading = useConsumptionLoading();
  const { grouping } = useTrendsView();

  const data = useMemo(() => {
    const byDay = new Map<string, { distance: number; gallons: number }>();
    const today = todayLagosKey();
    for (const t of cons?.trips || []) {
      const day = dayKey(t.tripStart || t.tripEnd);
      if (!day || day > today) continue;
      if (!byDay.has(day)) byDay.set(day, { distance: 0, gallons: 0 });
      const row = byDay.get(day)!;
      row.distance += t.distanceKm || 0;
      row.gallons += litersToGallons(t.fuelUsedLiters || 0);
    }
    if (byDay.size === 0 && cons?.summary) {
      const days = new Set<string>();
      for (const e of events) {
        const d = dayKey(e.eventTime || e.timestamp);
        if (d && d <= today) days.add(d);
      }
      const list = [...days].sort();
      if (list.length === 0) list.push(today);
      const dist = (cons.summary.totalDistanceKm || 0) / list.length;
      const gal = litersToGallons(cons.summary.totalFuelLiters || 0) / list.length;
      for (const d of list) byDay.set(d, { distance: dist, gallons: gal });
    }
    const byBucket = new Map<string, { distance: number; gallons: number }>();
    for (const [day, v] of byDay) {
      if (day > today) continue;
      const key = bucketKeyFromDay(day, grouping);
      if (!key) continue;
      if (!byBucket.has(key)) byBucket.set(key, { distance: 0, gallons: 0 });
      const row = byBucket.get(key)!;
      row.distance += v.distance;
      row.gallons += v.gallons;
    }
    return sortBucketKeys([...byBucket.keys()], grouping).map(key => {
      const v = byBucket.get(key)!;
      return {
        label: bucketLabel(key, grouping),
        distance: Math.round(v.distance),
        gallons: +v.gallons.toFixed(1),
      };
    });
  }, [cons, events, grouping]);

  return cardShell({
    title: 'Manage fuels and energy',
    icon: <Info size={15} color="#6b7280" />,
    subtitle: 'Total distance and fuel used (gallons)',
    caption,
    scope,
    wide: true,
    infoText: 'Distance and fuel from trip consumption data, bucketed by the selected grouping.',
    onDownload: !consLoading && data.length
      ? () => downloadTextFile('distance-fuel.csv', rowsToCsv(data))
      : undefined,
    children: consLoading ? (
      <ChartSkeleton tall />
    ) : data.length === 0 ? (
      <Empty />
    ) : (
      <>
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={data} margin={{ top: 8, right: 16, left: 4, bottom: 4 }}>
            <CartesianGrid stroke="rgba(0,0,0,0.08)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis
              yAxisId="left"
              tick={{ fontSize: 11 }}
              width={52}
              tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(1)}K` : String(v)}
              label={{ value: 'Total distance', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: '#6b7280' } }}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={{ fontSize: 11 }}
              width={48}
              label={{ value: 'Fuel used (gallons)', angle: 90, position: 'insideRight', style: { fontSize: 11, fill: '#6b7280' } }}
            />
            <Tooltip contentStyle={{ fontSize: 12 }} />
            <Legend />
            <Bar yAxisId="left" dataKey="distance" name="Total distance" fill="#2b71b1" maxBarSize={64} isAnimationActive={false} />
            <Line yAxisId="right" type="monotone" dataKey="gallons" name="Fuel used (gallons)" stroke="#50b2e1" strokeWidth={2} dot={{ r: 4, fill: '#50b2e1' }} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </>
    ),
  });
}

function FleetDistanceInsights({ scope }: { scope: TrendsScope }) {
  const stats = useTripStats();
  const { vehicles } = useFleet();
  const entityCount = Math.max(
    scope === 'driver' ? (stats.drivers.length || 1) : Math.max(stats.assets, vehicles.length || 1),
    1,
  );
  const days = 30;
  const avgKmPerEntityDay = stats.km / entityCount / days;
  const avgTripsPerEntityDay = stats.trips / entityCount / days;
  const avgMiPerTrip = stats.trips ? stats.km / stats.trips : 0;
  const entityLabel = scope === 'driver' ? 'driver' : 'asset';
  const rows = [
    { metric: `Avg km/${entityLabel}/day`, value: avgKmPerEntityDay.toFixed(2) },
    { metric: `Avg trips/${entityLabel}/day`, value: avgTripsPerEntityDay.toFixed(2) },
    { metric: 'Avg km/trip', value: avgMiPerTrip.toFixed(2) },
    { metric: 'Total km', value: Math.round(stats.km) },
  ];

  return cardShell({
    title: 'Distance and trip insights',
    icon: scope === 'driver' ? <User size={15} color="#6b7280" /> : <Car size={15} color="#6b7280" />,
    subtitle: undefined,
    caption: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
    scope,
    infoText: `Fleet distance KPIs averaged per ${entityLabel} over ~30 days.`,
    onDownload: stats.loading ? undefined : () => downloadTextFile('fleet-distance-insights.csv', rowsToCsv(rows)),
    children: stats.loading ? (
      <ChartSkeleton />
    ) : (
      <div>
        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Distance</div>
        <div style={{ fontSize: 36, fontWeight: 700, color: '#1f2937', marginBottom: 20 }}>
          {Math.round(stats.km).toLocaleString()} km
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          {[
            { icon: scope === 'driver' ? <User size={16} color="#6b7280" /> : <Car size={16} color="#6b7280" />, value: avgKmPerEntityDay.toFixed(2), label: `Avg km/${entityLabel}/day` },
            { icon: <MapPin size={16} color="#6b7280" />, value: avgTripsPerEntityDay.toFixed(2), label: `Avg trips/${entityLabel}/day` },
            { icon: <BarChart3 size={16} color="#6b7280" />, value: avgMiPerTrip.toFixed(2), label: 'Avg km/trip' },
          ].map(m => (
            <div key={m.label} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              {m.icon}
              <div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{m.value}</div>
                <div style={{ fontSize: 11, color: '#6b7280' }}>{m.label}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    ),
  });
}

function FleetUtilPctChart({ events, scope }: { events: LogEntry[]; scope: TrendsScope }) {
  const caption = useCaption(events);
  const { vehicles } = useFleet();
  const cons = useConsumption('week');
  const consLoading = useConsumptionLoading();
  const { grouping } = useTrendsView();
  const stats = useTripStats();
  const available = Math.max(
    scope === 'driver' ? (stats.drivers.length || 1) : Math.max(vehicles.length, 1),
    1,
  );

  const data = useMemo(() => {
    const byDay = new Map<string, Set<string>>();
    for (const t of cons?.trips || []) {
      const day = dayKey(t.tripStart || t.tripEnd);
      if (!day) continue;
      if (!byDay.has(day)) byDay.set(day, new Set());
      const trip = t as { assetId: string; driverName?: string; driverId?: string };
      const id = scope === 'driver'
        ? String(trip.driverName || trip.driverId || 'unknown')
        : String(trip.assetId);
      byDay.get(day)!.add(id);
    }
    if (byDay.size === 0) {
      for (const e of events) {
        const day = dayKey(e.eventTime || e.timestamp);
        if (!day) continue;
        if (!byDay.has(day)) byDay.set(day, new Set());
        byDay.get(day)!.add(entityKey(e, scope));
      }
    }
    const byBucket = new Map<string, Set<string>>();
    for (const [day, set] of byDay) {
      const key = bucketKeyFromDay(day, grouping);
      if (!key) continue;
      if (!byBucket.has(key)) byBucket.set(key, new Set());
      const merged = byBucket.get(key)!;
      for (const id of set) merged.add(id);
    }
    return sortBucketKeys([...byBucket.keys()], grouping).map(key => {
      const set = byBucket.get(key)!;
      const pct = Math.min(100, Math.round((set.size / available) * 100));
      return {
        label: bucketLabel(key, grouping),
        pct,
        fill: pct < 60 ? BAND.red : pct < 95 ? BAND.amber : BAND.green,
      };
    });
  }, [cons, events, available, grouping, scope]);

  return cardShell({
    title: 'Fleet utilisation %',
    icon: <Car size={15} color="#6b7280" />,
    subtitle: undefined,
    caption,
    scope,
    infoText: scope === 'driver'
      ? 'Drivers with activity / available drivers × 100'
      : 'Assets with trips / available assets × 100',
    onDownload: !consLoading && !stats.loading && data.length
      ? () => downloadTextFile('fleet-utilisation.csv', rowsToCsv(data.map(({ label, pct }) => ({ label, pct }))))
      : undefined,
    children: consLoading || stats.loading ? (
      <ChartSkeleton />
    ) : data.length === 0 ? (
      <Empty />
    ) : (
      <>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 4 }}>
            <CartesianGrid stroke="rgba(0,0,0,0.08)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} width={36} />
            <Tooltip contentStyle={{ fontSize: 12 }} />
            <Bar dataKey="pct" name="Utilisation %" maxBarSize={56} isAnimationActive={false}>
              {data.map((d, i) => <Cell key={i} fill={d.fill} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <LegendRow items={[
          ['0–59%', BAND.red],
          ['60–94%', BAND.amber],
          ['>95%', BAND.green],
        ]} />
        <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 8, textAlign: 'center' }}>
          {scope === 'driver'
            ? '(Calculation: Drivers with activity / available drivers × 100)'
            : '(Calculation: Assets with trips / available assets × 100)'}
        </div>
      </>
    ),
  });
}

function FleetDriveIdleChart({ events, scope }: { events: LogEntry[]; scope: TrendsScope }) {
  const caption = useCaption(events);
  const stats = useTripStats();
  const { grouping } = useTrendsView();
  const data = useMemo(() => {
    const byBucket = new Map<string, { drive: number; idle: number }>();
    for (const e of events) {
      if (e.type === 'panic') continue;
      const bucket = bucketKeyFromIso(e.eventTime || e.timestamp, grouping);
      if (!bucket) continue;
      if (!byBucket.has(bucket)) byBucket.set(bucket, { drive: 0, idle: 0 });
      const row = byBucket.get(bucket)!;
      const label = (e.label || '').toLowerCase();
      if (label.includes('idle')) row.idle += 1;
      else row.drive += 1;
    }
    const keys = sortBucketKeys([...byBucket.keys()], grouping);
    const driveHoursPerBucket = keys.length ? stats.hours / keys.length : 0;
    return keys.map(bucket => {
      const row = byBucket.get(bucket)!;
      return {
        label: bucketLabel(bucket, grouping),
        drive: Math.round(driveHoursPerBucket * 60) || row.drive,
        idle: row.idle * 5,
      };
    });
  }, [events, stats.hours, grouping]);

  return cardShell({
    title: 'Driving and idling time',
    icon: <Car size={15} color="#6b7280" />,
    caption,
    scope,
    infoText: 'Estimated driving vs idling activity from events, grouped by the toolbar setting.',
    onDownload: data.length
      ? () => downloadTextFile('drive-idle.csv', rowsToCsv(data))
      : undefined,
    children: data.length === 0 ? (
      <Empty />
    ) : (
      <>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 4 }}>
            <CartesianGrid stroke="rgba(0,0,0,0.08)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} width={40} />
            <Tooltip contentStyle={{ fontSize: 12 }} />
            <Bar dataKey="drive" name="Driving" stackId="a" fill="#2b71b1" maxBarSize={56} isAnimationActive={false} />
            <Bar dataKey="idle" name="Idling" stackId="a" fill="#94a3b8" maxBarSize={56} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
        <LegendRow items={[['Driving', '#2b71b1'], ['Idling', '#94a3b8']]} />
      </>
    ),
  });
}

function FleetHourChart({ events, scope }: { events: LogEntry[]; scope: TrendsScope }) {
  const caption = useCaption(events);
  const hourData = useMemo(() => {
    const hours = Array.from({ length: 24 }, (_, h) => ({ hour: `${h}:00`, count: 0 }));
    for (const e of events) {
      if (e.type === 'panic') continue;
      const ts = new Date(e.eventTime || e.timestamp);
      if (!Number.isFinite(ts.getTime())) continue;
      const h = (ts.getUTCHours() + 1) % 24;
      hours[h].count++;
    }
    return hours;
  }, [events]);

  return cardShell({
    title: 'Movement by hour of day',
    icon: <Car size={15} color="#6b7280" />,
    caption,
    scope,
    infoText: 'Event activity by hour of day (Lagos time). Grouping does not apply to this hour-of-day view.',
    onDownload: () => downloadTextFile('movement-by-hour.csv', rowsToCsv(hourData)),
    children: (
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={hourData} margin={{ top: 8, right: 8, left: 4, bottom: 4 }}>
          <CartesianGrid stroke="rgba(0,0,0,0.08)" vertical={false} />
          <XAxis dataKey="hour" tick={{ fontSize: 9 }} interval={2} />
          <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={36} />
          <Tooltip contentStyle={{ fontSize: 12 }} />
          <Bar dataKey="count" name="Events" fill="#50b2e1" maxBarSize={18} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    ),
  });
}

function DriverBandDistanceChart({ events, scope }: { events: LogEntry[]; scope: TrendsScope }) {
  const bands = useDriverBands(events);
  const caption = useCaption(events);
  const data = [{
    label: bands.dayLabel,
    green: Math.round(bands.distance.Green),
    amber: Math.round(bands.distance.Amber),
    red: Math.round(bands.distance.Red),
  }];
  return cardShell({
    title: 'Distance by scoring band',
    icon: <Car size={15} color="#6b7280" />,
    caption: bands.ready ? caption : 'Loading figures…',
    scope,
    children: !bands.ready ? (
      <ChartSkeleton />
    ) : (
      <>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 4 }}>
            <CartesianGrid stroke="rgba(0,0,0,0.08)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(1)}K` : String(v)} width={48} />
            <Tooltip contentStyle={{ fontSize: 12 }} />
            <Bar dataKey="green" name="Distance green drivers" stackId="a" fill={BAND.green} maxBarSize={72} isAnimationActive={false} />
            <Bar dataKey="amber" name="Distance amber drivers" stackId="a" fill={BAND.amber} maxBarSize={72} isAnimationActive={false} />
            <Bar dataKey="red" name="Distance red drivers" stackId="a" fill={BAND.red} maxBarSize={72} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
        <LegendRow items={[
          ['Distance green drivers', BAND.green],
          ['Distance amber drivers', BAND.amber],
          ['Distance red drivers', BAND.red],
        ]} />
      </>
    ),
  });
}

function DriverBandScoreChart({ events, scope }: { events: LogEntry[]; scope: TrendsScope }) {
  const bands = useDriverBands(events);
  const caption = useCaption(events);
  const data = [{
    label: bands.dayLabel,
    green: bands.counts.Green,
    amber: bands.counts.Amber,
    red: bands.counts.Red,
  }];
  return cardShell({
    title: 'Driver % per scoring band',
    icon: <User size={15} color="#6b7280" />,
    caption: bands.ready ? caption : 'Loading figures…',
    scope,
    children: !bands.ready ? (
      <ChartSkeleton />
    ) : (
      <>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 4 }}>
            <CartesianGrid stroke="rgba(0,0,0,0.08)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={36} />
            <Tooltip contentStyle={{ fontSize: 12 }} />
            <Bar dataKey="green" name="Green score" stackId="a" fill={BAND.green} maxBarSize={72} isAnimationActive={false} />
            <Bar dataKey="amber" name="Amber score" stackId="a" fill={BAND.amber} maxBarSize={72} isAnimationActive={false} />
            <Bar dataKey="red" name="Red score" stackId="a" fill={BAND.red} maxBarSize={72} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
        <LegendRow items={[
          ['Green score', BAND.green],
          ['Amber score', BAND.amber],
          ['Red score', BAND.red],
        ]} />
      </>
    ),
  });
}

function DriverPerformanceCard({ events, scope }: { events: LogEntry[]; scope: TrendsScope }) {
  const bands = useDriverBands(events);
  const caption = useCaption(events);
  const pie = [
    { name: 'Green', value: bands.counts.Green, color: BAND.green },
    { name: 'Amber', value: bands.counts.Amber, color: BAND.amber },
    { name: 'Red', value: bands.counts.Red, color: BAND.red },
  ].filter(p => p.value > 0);
  const topAvg = bands.top.length ? bands.top.reduce((s, d) => s + d.score, 0) / bands.top.length : 0;
  const bottomAvg = bands.bottom.length ? bands.bottom.reduce((s, d) => s + d.score, 0) / bands.bottom.length : 0;

  return cardShell({
    title: 'Driver Performance',
    icon: <User size={15} color="#6b7280" />,
    subtitle: 'Driver % per scoring band & top/bottom range',
    caption: bands.ready ? caption : 'Loading figures…',
    scope,
    wide: true,
    children: !bands.ready ? (
      <ChartSkeleton tall />
    ) : (
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(160px, 220px) 1fr', gap: 20, alignItems: 'center' }}>
        <div>
          <div style={{ color: BAND.green, fontWeight: 700, fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
            TOP 10% <ArrowUp size={12} />
          </div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>{bands.top.length} Drivers</div>
          <div style={{ fontSize: 36, fontWeight: 700, color: '#1f2937', lineHeight: 1.1, marginTop: 4 }}>{topAvg.toFixed(2)}</div>
          <div style={{ height: 1, background: '#e5e7eb', margin: '16px 0' }} />
          <div style={{ color: BAND.red, fontWeight: 700, fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
            BOTTOM 10% <ArrowDown size={12} />
          </div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>{bands.bottom.length} Drivers</div>
          <div style={{ fontSize: 36, fontWeight: 700, color: '#1f2937', lineHeight: 1.1, marginTop: 4 }}>{bottomAvg.toFixed(2)}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ position: 'relative', width: 200, height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pie.length ? pie : [{ name: 'None', value: 1, color: '#e5e7eb' }]}
                  dataKey="value"
                  innerRadius={62}
                  outerRadius={88}
                  startAngle={90}
                  endAngle={-270}
                  isAnimationActive={false}
                >
                  {(pie.length ? pie : [{ color: '#e5e7eb' }]).map((e, i) => (
                    <Cell key={i} fill={e.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div style={{
              position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', pointerEvents: 'none',
            }}>
              <div style={{ fontSize: 12, color: '#6b7280' }}>Avg. Score</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: '#1f2937' }}>{(bands.avg / 100).toFixed(2)}</div>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8, fontSize: 12, color: '#4b5563' }}>
            <div><span style={{ color: BAND.red }}>●</span> {bands.counts.Red} drivers ({bands.pct.red.toFixed(2)}%)</div>
            <div><span style={{ color: BAND.amber }}>●</span> {bands.counts.Amber} drivers ({bands.pct.amber.toFixed(2)}%)</div>
            <div><span style={{ color: BAND.green }}>●</span> {bands.counts.Green} drivers ({bands.pct.green.toFixed(2)}%)</div>
          </div>
        </div>
      </div>
    ),
  });
}

function DriverAvgScoresChart({ events, scope }: { events: LogEntry[]; scope: TrendsScope }) {
  const bands = useDriverBands(events);
  const caption = useCaption(events);
  const { grouping } = useTrendsView();
  const data = useMemo(() => {
    const byBucket = new Map<string, number>();
    for (const e of events) {
      if (e.type === 'panic' || !isKnownDriver(e.driverName)) continue;
      const bucket = bucketKeyFromIso(e.eventTime || e.timestamp, grouping);
      if (!bucket) continue;
      byBucket.set(bucket, (byBucket.get(bucket) || 0) + 1);
    }
    const avg = bands.avg || 0;
    return sortBucketKeys([...byBucket.keys()], grouping).map(bucket => {
      const count = byBucket.get(bucket) || 0;
      const penalty = Math.min(40, count * 0.5);
      return { label: bucketLabel(bucket, grouping), score: Math.max(0, +(avg - penalty + 20).toFixed(1)) };
    });
  }, [events, bands.avg, grouping]);

  return cardShell({
    title: 'Driver average scores',
    icon: <User size={15} color="#6b7280" />,
    subtitle: 'Average safety score over time',
    caption: bands.ready ? caption : 'Loading figures…',
    scope,
    infoText: 'Approximate average safety score over time from event volume and fleet average.',
    onDownload: bands.ready && data.length
      ? () => downloadTextFile('driver-avg-scores.csv', rowsToCsv(data))
      : undefined,
    children: !bands.ready ? (
      <ChartSkeleton />
    ) : data.length === 0 ? (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <div style={{ fontSize: 40, fontWeight: 700, color: '#1f2937' }}>{bands.avg.toFixed(1)}</div>
        <div style={{ fontSize: 13, color: '#6b7280' }}>Fleet average score (0–100)</div>
      </div>
    ) : (
      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 4 }}>
          <CartesianGrid stroke="rgba(0,0,0,0.08)" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} width={36} />
          <Tooltip contentStyle={{ fontSize: 12 }} />
          <Line type="monotone" dataKey="score" name="Avg score" stroke="#58b06d" strokeWidth={2} dot={{ r: 4 }} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    ),
  });
}

function DriverIdTrendChart({ events, scope }: { events: LogEntry[]; scope: TrendsScope }) {
  const caption = useCaption(events);
  const { grouping } = useTrendsView();
  const data = useMemo(() => {
    const byBucket = new Map<string, { identified: number; unidentified: number }>();
    for (const e of events) {
      if (e.type === 'panic') continue;
      const bucket = bucketKeyFromIso(e.eventTime || e.timestamp, grouping);
      if (!bucket) continue;
      if (!byBucket.has(bucket)) byBucket.set(bucket, { identified: 0, unidentified: 0 });
      const row = byBucket.get(bucket)!;
      if (isKnownDriver(e.driverName)) row.identified++;
      else row.unidentified++;
    }
    return sortBucketKeys([...byBucket.keys()], grouping).map(bucket => {
      const row = byBucket.get(bucket)!;
      return {
        label: bucketLabel(bucket, grouping),
        identified: row.identified,
        unidentified: row.unidentified,
      };
    });
  }, [events, grouping]);

  return cardShell({
    title: 'Driver identification trends',
    icon: <User size={15} color="#6b7280" />,
    subtitle: 'Identified / unidentified',
    caption,
    scope,
    infoText: 'Events with a known driver vs unidentified, over the selected grouping.',
    onDownload: data.length
      ? () => downloadTextFile('driver-id-trends.csv', rowsToCsv(data))
      : undefined,
    children: data.length === 0 ? (
      <Empty />
    ) : (
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 4 }}>
          <CartesianGrid stroke="rgba(0,0,0,0.08)" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={40} />
          <Tooltip contentStyle={{ fontSize: 12 }} />
          <Bar dataKey="identified" name="Identified" stackId="a" fill="#0d9488" maxBarSize={56} isAnimationActive={false} />
          <Bar dataKey="unidentified" name="Unidentified" stackId="a" fill="#94a3b8" maxBarSize={56} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    ),
  });
}

function DriverIdAdherenceChart({ events, scope }: { events: LogEntry[]; scope: TrendsScope }) {
  const caption = useCaption(events);
  const { pct, identified, total } = useMemo(() => {
    let identified = 0;
    let total = 0;
    for (const e of events) {
      if (e.type === 'panic') continue;
      total++;
      if (isKnownDriver(e.driverName)) identified++;
    }
    return { identified, total, pct: total ? (identified / total) * 100 : 0 };
  }, [events]);

  return cardShell({
    title: 'Driver adherence %',
    icon: <User size={15} color="#6b7280" />,
    subtitle: 'Driver identification adherence',
    caption,
    scope,
    infoText: 'Share of events with a known driver identity in the selected period.',
    onDownload: () => downloadTextFile(
      'driver-adherence.csv',
      rowsToCsv([{ identified, total, pct: +pct.toFixed(1) }]),
    ),
    children: (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 220, gap: 12 }}>
        <div style={{ fontSize: 48, fontWeight: 700, color: '#0d9488' }}>{pct.toFixed(1)}%</div>
        <div style={{ fontSize: 13, color: '#6b7280' }}>
          {identified.toLocaleString()} of {total.toLocaleString()} events with known driver
        </div>
        <div style={{ width: '80%', height: 10, borderRadius: 6, background: '#e5e7eb', overflow: 'hidden' }}>
          <div style={{ width: `${Math.min(100, pct)}%`, height: '100%', background: '#0d9488' }} />
        </div>
      </div>
    ),
  });
}

function Empty() {
  return <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>No data in this period</div>;
}

function LegendRow({ items }: { items: [string, string][] }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, justifyContent: 'center', marginTop: 6 }}>
      {items.map(([label, color]) => (
        <span key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#333' }}>
          <span style={{ width: 14, height: 3, background: color, display: 'inline-block' }} />
          {label}
        </span>
      ))}
    </div>
  );
}

/** Render one organisational-goal chart instance (never a placeholder). */
export function TrendsExtraChart({
  chartId,
  events,
  scope,
  grouping = 'day',
  onEditDashboard,
  onRemoveChart,
}: {
  chartId: TrendsChartId;
  events: LogEntry[];
  scope: TrendsScope;
  grouping?: TrendsGrouping;
  onEditDashboard?: () => void;
  onRemoveChart?: (id: TrendsChartId) => void;
}) {
  const def = chartDef(chartId);
  if (!def || def.kind === 'mix') return null;

  const body = (() => {
    switch (def.kind) {
      case 'event-values':
        return <EventValuesChart events={events} scope={scope} />;
      case 'event-duration':
        return <EventDurationChart events={events} scope={scope} />;
      case 'driver-band-distance':
        return <DriverBandDistanceChart events={events} scope={scope} />;
      case 'driver-band-score':
        return <DriverBandScoreChart events={events} scope={scope} />;
      case 'driver-performance':
        return <DriverPerformanceCard events={events} scope={scope} />;
      case 'driver-avg-scores':
        return <DriverAvgScoresChart events={events} scope={scope} />;
      case 'fleet-distance':
        return <FleetDistanceInsights scope={scope} />;
      case 'fleet-util-pct':
        return <FleetUtilPctChart events={events} scope={scope} />;
      case 'fleet-idle':
        return <FleetDriveIdleChart events={events} scope={scope} />;
      case 'fleet-hour':
        return <FleetHourChart events={events} scope={scope} />;
      case 'fuel-distance':
        return <FuelDistanceChart events={events} scope={scope} />;
      case 'driver-id-trend':
        return <DriverIdTrendChart events={events} scope={scope} />;
      case 'driver-id-adherence':
        return <DriverIdAdherenceChart events={events} scope={scope} />;
      default:
        return null;
    }
  })();

  return (
    <TrendsViewCtx.Provider value={{ grouping, scope }}>
      <ChartActionsCtx.Provider
        value={{
          infoText: def.subtitle,
          onAction: action => {
            if (action === 'edit') onEditDashboard?.();
            if (action === 'remove') onRemoveChart?.(chartId);
          },
        }}
      >
        {body}
      </ChartActionsCtx.Provider>
    </TrendsViewCtx.Provider>
  );
}
