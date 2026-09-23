import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { authFetch, useFleet } from '../context/FleetContext';
import CustomDateTimeRange, { ensureCustomRangeDefaults } from '../components/CustomDateTimeRange';
import InfoTip from '../components/InfoTip';
import TablePaginationBar from '../components/TablePaginationBar';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useClientPagination } from '../hooks/useClientPagination';
import { useTableSort } from '../hooks/useTableSort';
import { buildUtilUrl, type KpiAssetRow, type KpiData, type KpiPeriodMode } from '../lib/operationalKpi';
import { cachedFetchJson, cachePeek, CACHE_KEYS, CACHE_TTL } from '../lib/apiCache';
import { SkelTable, SkelValue } from '../components/data/DataBusy';
import { KPI_DEFINITIONS } from '../lib/metricDefinitions';

type PeriodMode = KpiPeriodMode;

function fmt(n: number | null | undefined, digits = 1) {
  if (n == null || Number.isNaN(n)) return '—';
  return n.toFixed(digits);
}

function utilBar(pct: number, color: string) {
  const w = Math.max(0, Math.min(100, pct));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 100 }}>
      <div style={{ flex: 1, height: 6, borderRadius: 999, background: 'var(--cd-border)', overflow: 'hidden' }}>
        <div style={{ width: `${w}%`, height: '100%', background: color, borderRadius: 999 }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 600, minWidth: 36 }}>{fmt(pct, 0)}%</span>
    </div>
  );
}

export default function UtilizationPage() {
  const { selectedSites } = useFleet();
  const siteScopeKey = selectedSites.join(',');
  const siteScope = siteScopeKey ? selectedSites : undefined;
  const [period, setPeriod] = useState<PeriodMode>('week');
  const [customRange, setCustomRange] = useState(() => {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - 7);
    return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
  });
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 250);

  const url = buildUtilUrl(period, 'all', customRange.from, customRange.to, { siteScope });
  const [data, setData] = useState<KpiData | null>(() => cachePeek<KpiData>(CACHE_KEYS.kpi(url)));
  const [loading, setLoading] = useState(() => !cachePeek(CACHE_KEYS.kpi(url)));

  const fetchData = useCallback(async () => {
    const scope = siteScopeKey ? siteScopeKey.split(',') : undefined;
    const nextUrl = buildUtilUrl(period, 'all', customRange.from, customRange.to, { siteScope: scope });
    const key = CACHE_KEYS.kpi(nextUrl);
    const cached = cachePeek<KpiData>(key);
    if (cached) {
      setData(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }
    try {
      const next = await cachedFetchJson<KpiData>(key, CACHE_TTL.kpi, async () => {
        const res = await authFetch(nextUrl);
        if (!res.ok) return null;
        return res.json();
      }, { force: false });
      if (next) setData(next);
    } catch { /* keep prior */ }
    finally { setLoading(false); }
  }, [period, customRange.from, customRange.to, siteScopeKey]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  const tableAssets = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    let rows = data?.assets ?? [];
    if (q) {
      rows = rows.filter(a =>
        (a.regNo || '').toLowerCase().includes(q)
        || (a.assetName || '').toLowerCase().includes(q)
        || (a.zone || '').toLowerCase().includes(q));
    }
    return rows;
  }, [data?.assets, debouncedSearch]);

  type SortKey = 'regNo' | 'zone' | 'utilizationPct' | 'availabilityPct' | 'distanceKm' | 'engineHours';
  const getSortValue = (row: KpiAssetRow, key: SortKey) => row[key];
  const { sorted, toggle, ariaSort, indicator } = useTableSort(tableAssets, getSortValue);
  const {
    pageRows, page, pageCount, from: pageFrom, to: pageTo, total: pageTotal, hasPrev, hasNext, prev, next,
  } = useClientPagination(sorted, 50, `${period}|${customRange.from}|${customRange.to}|${debouncedSearch}|${(siteScope || []).join(',')}`);

  const summary = data?.summary ?? null;
  // Activity % comes from utilization summary — do not wait on FleetContext /api/data vehicles.
  const withTrips = summary?.assetsWithTrips
    ?? (data?.assets ?? []).filter(a => (a.tripCount ?? 0) > 0).length;
  const available = summary?.fleetAssetCount
    ?? summary?.assetCount
    ?? 0;
  const activityPct = available > 0 ? Math.round((withTrips / available) * 100) : null;
  const showKpiSkeleton = loading && !data;

  return (
    <div>
      <div className="bpl-page-header">
        <h1 className="bpl-page-title">Utilization</h1>
        <p className="bpl-page-subtitle">
          Engine / drive intensity and distance across {siteScope ? 'selected transporters' : 'the fleet'}
        </p>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 20, alignItems: 'center' }}>
        <div className="bpl-trips-tabs" role="tablist" aria-label="Period">
          {([
            { id: 'day' as const, label: 'Today' },
            { id: 'week' as const, label: '7 days' },
            { id: 'month' as const, label: '30 days' },
            { id: 'custom' as const, label: 'Custom' },
          ]).map(p => (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={period === p.id}
              className={`bpl-trips-tab${period === p.id ? ' active' : ''}`}
              onClick={() => {
                if (p.id === 'custom') {
                  ensureCustomRangeDefaults(
                    customRange.from,
                    customRange.to,
                    from => setCustomRange(r => ({ ...r, from })),
                    to => setCustomRange(r => ({ ...r, to })),
                  );
                }
                setPeriod(p.id);
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
        {period === 'custom' && (
          <CustomDateTimeRange
            from={customRange.from}
            to={customRange.to}
            onFromChange={from => setCustomRange(r => ({ ...r, from }))}
            onToChange={to => setCustomRange(r => ({ ...r, to }))}
          />
        )}
        <div className="bpl-fatigue-search" style={{ marginLeft: 'auto', minWidth: 220 }}>
          <Search size={15} />
          <input
            type="search"
            placeholder="Search plate, asset, site…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--cd-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
          Trip activity · {showKpiSkeleton ? '…' : `${withTrips}/${available}`} assets with trips
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12 }}>
          {[
            {
              label: 'Fleet activity %',
              value: activityPct != null ? `${activityPct}%` : '—',
              tip: 'Share of fleet with at least one trip.',
              color: '#0f172a',
            },
            {
              label: 'Total distance',
              value: summary ? `${Math.round(summary.totalDistanceKm).toLocaleString()} km` : '—',
              tip: 'Total km from trips in period.',
              color: '#2563eb',
            },
            {
              label: 'Avg utilization',
              value: summary?.avgUtilizationPct != null ? `${fmt(summary.avgUtilizationPct, 0)}%` : '—',
              tip: KPI_DEFINITIONS.utilization,
              color: '#0d9488',
            },
            {
              label: 'Engine hours',
              value: summary ? `${fmt(summary.totalEngineHours, 0)} h` : '—',
              tip: KPI_DEFINITIONS.engineRuntime,
              color: '#7c3aed',
            },
          ].map(k => (
            <div key={k.label} style={{ padding: '14px 16px', borderRadius: 10, background: 'var(--cd-surface)', border: '1px solid var(--cd-border)', borderTop: `3px solid ${k.color}` }}>
              <div style={{ fontSize: 11, color: 'var(--cd-text-muted)', marginBottom: 4, display: 'flex', alignItems: 'center' }}>
                {k.label}
                <InfoTip text={k.tip} label={k.label} />
              </div>
              <div style={{ fontSize: 20, fontWeight: 700, color: k.color }}>
                {showKpiSkeleton ? <SkelValue /> : k.value}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bpl-card bpl-table-scroll" style={{ padding: 0 }}>
        <table className="bpl-dispatch-table bpl-fatigue-table">
          <thead>
            <tr>
              {([
                { key: 'regNo' as const, label: 'Asset', tip: null as string | null },
                { key: 'zone' as const, label: 'Zone', tip: null as string | null },
                { key: 'utilizationPct' as const, label: 'Util %', tip: KPI_DEFINITIONS.utilization },
                { key: 'availabilityPct' as const, label: 'Avail %', tip: KPI_DEFINITIONS.availability },
                { key: 'distanceKm' as const, label: 'Distance', tip: 'Total trip distance for the selected period.' },
                { key: 'engineHours' as const, label: 'Engine h', tip: KPI_DEFINITIONS.engineRuntime },
              ]).map(col => (
                <th
                  key={col.key}
                  aria-sort={ariaSort(col.key)}
                  onClick={() => toggle(col.key)}
                  style={{ cursor: 'pointer', userSelect: 'none' }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap' }}>
                    {col.label}{indicator(col.key)}
                    {col.tip && (
                      <InfoTip text={col.tip} label={col.label} style={{ marginLeft: 4 }} />
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {showKpiSkeleton && pageRows.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: 12 }}><SkelTable rows={8} /></td></tr>
            ) : pageRows.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: 'var(--cd-text-muted)' }}>No assets</td></tr>
            ) : pageRows.map(a => (
              <tr key={a.assetId || a.regNo}>
                <td style={{ fontWeight: 600 }}>{a.regNo || a.assetName}</td>
                <td>{a.zone || '—'}</td>
                <td>{a.utilizationPct != null ? utilBar(a.utilizationPct, '#0d9488') : '—'}</td>
                <td>{a.availabilityPct != null ? utilBar(a.availabilityPct, '#2563eb') : '—'}</td>
                <td>{a.distanceKm != null ? `${Math.round(a.distanceKm).toLocaleString()} km` : '—'}</td>
                <td>{a.engineHours != null ? `${a.engineHours.toFixed(1)} h` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <TablePaginationBar
          from={pageFrom}
          to={pageTo}
          total={pageTotal}
          page={page}
          pageCount={pageCount}
          hasPrev={hasPrev}
          hasNext={hasNext}
          prev={prev}
          next={next}
          minTotal={0}
        />
      </div>
    </div>
  );
}
