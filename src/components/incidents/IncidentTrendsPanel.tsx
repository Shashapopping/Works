import { useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { authFetch } from '../../context/FleetContext';
import { authCachedJson, cachePeek, CACHE_TTL } from '../../lib/apiCache';
import {
  TREND_EVENT_LABELS,
  type EventFilterKey,
} from '../../lib/eventFilters';
import { pagePeriodIsoBounds, type PageDateRange } from '../../lib/pagePeriod';
import { SkelChart } from '../data/DataBusy';

type TrendDay = {
  date: string;
  Total: number;
} & Record<EventFilterKey, number>;

type TrendBucket = {
  dayKey: string;
  byLabel: Record<string, number>;
  total: number;
};

type TrendsPayload = {
  from: string | null;
  to: string | null;
  buckets: TrendBucket[];
};

const EVENT_COLORS: Record<string, string> = {
  Total: '#0f172a',
  'Harsh Braking': '#0f766e',
  'Harsh Acceleration': '#1d4ed8',
  'Overspeeding': '#7c3aed',
  'Overspeed Tiered': '#ea580c',
  'Road Speed Overspeeding': '#c026d3',
  'Harsh Cornering': '#15803d',
};

function emptyTrendDay(date: string): TrendDay {
  const day = { date, Total: 0 } as TrendDay;
  TREND_EVENT_LABELS.forEach(label => { day[label] = 0; });
  return day;
}

function trendsUrl(
  range: PageDateRange,
  customFrom: string,
  customTo: string,
  activeFilter: EventFilterKey,
  siteScope?: string[] | null,
) {
  const b = pagePeriodIsoBounds(range, customFrom, customTo);
  const params = new URLSearchParams();
  if (b.from) params.set('from', b.from);
  if (b.to) params.set('to', b.to);
  if (activeFilter !== 'All') params.set('types', activeFilter);
  if (siteScope?.length) params.set('siteScope', siteScope.join(','));
  return `/api/events/trends?${params}`;
}

function lagosDayKey(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Lagos',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const y = parts.find(p => p.type === 'year')?.value ?? '1970';
  const m = parts.find(p => p.type === 'month')?.value ?? '01';
  const day = parts.find(p => p.type === 'day')?.value ?? '01';
  return `${y}-${m}-${day}`;
}

function bucketsToTrendDays(
  buckets: TrendBucket[],
  range: PageDateRange,
  customFrom: string,
  customTo: string,
): TrendDay[] {
  const bounds = pagePeriodIsoBounds(range, customFrom, customTo);
  const now = new Date();
  let startDate = bounds.from ? new Date(bounds.from) : new Date(now.getTime() - 6 * 86400000);
  let endDate = bounds.to ? new Date(bounds.to) : now;
  startDate.setHours(0, 0, 0, 0);
  endDate.setHours(23, 59, 59, 999);

  const bucketMap = new Map(buckets.map(b => [b.dayKey, b]));
  const days: TrendDay[] = [];
  const cursor = new Date(startDate);
  while (cursor <= endDate) {
    const lagosKey = lagosDayKey(cursor);
    const dateKey = cursor.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      timeZone: 'Africa/Lagos',
    });
    const day = emptyTrendDay(dateKey);
    const bucket = bucketMap.get(lagosKey);
    if (bucket) {
      for (const label of TREND_EVENT_LABELS) {
        const n = bucket.byLabel[label] ?? 0;
        day[label] = n;
        day.Total += n;
      }
    }
    days.push(day);
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function CustomTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ payload?: TrendDay }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const data = payload[0]?.payload;
  if (!data) return null;
  return (
    <div style={{
      background: '#1e293b', border: 'none', borderRadius: 10,
      padding: '10px 14px', fontSize: 11, color: '#fff',
      boxShadow: '0 4px 16px rgba(0,0,0,0.3)', minWidth: 160,
    }}>
      <div style={{ color: '#94a3b8', marginBottom: 8, fontWeight: 600, fontSize: 12 }}>{label}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {Object.entries(EVENT_COLORS).map(([key, color]) => {
          const val = data[key as keyof TrendDay];
          if (val === undefined) return null;
          return (
            <div key={key} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
                <span style={{ color: '#cbd5e1', fontSize: 10 }}>{key}</span>
              </div>
              <span style={{ fontWeight: 600, color: Number(val) > 0 ? '#fff' : '#475569' }}>{val}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function IncidentTrendsPanel({
  dateRange,
  customFrom,
  customTo,
  activeFilter = 'All',
  siteScope = null,
}: {
  dateRange: PageDateRange;
  customFrom: string;
  customTo: string;
  activeFilter?: EventFilterKey;
  siteScope?: string[] | null;
}) {
  const url = trendsUrl(dateRange, customFrom, customTo, activeFilter, siteScope);
  const [buckets, setBuckets] = useState<TrendBucket[]>(() => cachePeek<TrendsPayload>(url)?.buckets ?? []);
  const [loading, setLoading] = useState(() => !cachePeek(url));
  const [showTotal, setShowTotal] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const nextUrl = trendsUrl(dateRange, customFrom, customTo, activeFilter, siteScope);
    const cached = cachePeek<TrendsPayload>(nextUrl);
    if (cached?.buckets) {
      setBuckets(cached.buckets);
      setLoading(false);
    } else {
      setBuckets([]);
      setLoading(true);
    }
    authCachedJson<TrendsPayload>(nextUrl, authFetch, {
      ttlMs: CACHE_TTL.safetySummary,
    })
      .then(data => {
        if (cancelled || !data) return;
        setBuckets(data.buckets ?? []);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [dateRange, customFrom, customTo, activeFilter, siteScope]);

  const trendData = useMemo(
    () => bucketsToTrendDays(buckets, dateRange, customFrom, customTo),
    [buckets, dateRange, customFrom, customTo],
  );

  const summaryStats = useMemo(() => {
    if (trendData.length === 0) return null;
    const total = trendData.reduce((sum, d) => sum + d.Total, 0);
    const avg = Math.round(total / trendData.length);
    const peak = trendData.reduce((max, d) => d.Total > max.Total ? d : max, trendData[0]);
    const lowest = trendData.reduce((min, d) => d.Total < min.Total ? d : min, trendData[0]);
    return { total, avg, peak, lowest };
  }, [trendData]);

  const activeLines = useMemo(() => {
    if (showTotal) return ['Total'];
    if (activeFilter === 'All') return [...TREND_EVENT_LABELS];
    if (TREND_EVENT_LABELS.includes(activeFilter)) return [activeFilter];
    return [...TREND_EVENT_LABELS];
  }, [activeFilter, showTotal]);

  if (loading && buckets.length === 0) {
    return <SkelChart height={380} />;
  }

  if (trendData.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--cd-text-muted)', fontSize: 13 }}>
        No data for selected period
      </div>
    );
  }

  return (
    <div>
      {summaryStats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 16 }}>
          {[
            { label: 'Total', value: summaryStats.total },
            { label: 'Daily avg', value: summaryStats.avg },
            { label: 'Peak day', value: summaryStats.peak.Total, sub: summaryStats.peak.date },
            { label: 'Quietest', value: summaryStats.lowest.Total, sub: summaryStats.lowest.date },
          ].map(s => (
            <div key={s.label} style={{
              padding: '10px 12px', borderRadius: 8, background: 'var(--cd-surface-2)',
              border: '1px solid var(--cd-border)',
            }}>
              <div style={{ fontSize: 10, color: 'var(--cd-text-muted)', marginBottom: 4 }}>{s.label}</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{s.value}</div>
              {s.sub && <div style={{ fontSize: 10, color: 'var(--cd-text-muted)', marginTop: 2 }}>{s.sub}</div>}
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => setShowTotal(v => !v)}
          style={{
            padding: '4px 12px', borderRadius: 9999, fontSize: 11, cursor: 'pointer',
            border: showTotal ? 'none' : '1px solid var(--cd-border)',
            background: showTotal ? '#0f172a' : 'var(--cd-surface-2)',
            color: showTotal ? '#fff' : 'var(--cd-text-muted)',
            fontWeight: 600,
          }}
        >
          Total
        </button>
        <span style={{ fontSize: 11, color: 'var(--cd-text-muted)' }}>
          Daily event counts
          {!showTotal && activeFilter !== 'All' && (
            <span style={{ color: EVENT_COLORS[activeFilter] || '#854F0B', marginLeft: 6 }}>— {activeFilter} only</span>
          )}
        </span>
      </div>

      <ResponsiveContainer width="100%" height={380}>
        <LineChart data={trendData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--cd-border)" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--cd-text-muted)' }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 10, fill: 'var(--cd-text-muted)' }} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip content={<CustomTooltip />} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {activeLines.map(key => (
            <Line
              key={key}
              type="monotone"
              dataKey={key}
              stroke={EVENT_COLORS[key] || '#64748b'}
              strokeWidth={key === 'Total' ? 2.5 : 1.75}
              dot={false}
              activeDot={{ r: 4 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
