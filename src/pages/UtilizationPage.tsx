import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, Info } from 'lucide-react';
import { authFetch, useFleet } from '../context/FleetContext';
import CustomDateTimeRange, { ensureCustomRangeDefaults } from '../components/CustomDateTimeRange';
import TablePaginationBar from '../components/TablePaginationBar';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useClientPagination } from '../hooks/useClientPagination';
import { useTableSort } from '../hooks/useTableSort';
import { buildKpiUrl, type KpiAssetRow, type KpiData, type KpiPeriodMode } from '../lib/operationalKpi';
import { cachedFetchJson, cachePeek, CACHE_KEYS, CACHE_TTL } from '../lib/apiCache';
import { SkelTable, SkelValue } from '../components/data/DataBusy';
import { filterDistanceAssetsByVehicles } from '../lib/siteScope';

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

function summarizeScopedAssets(assets: KpiAssetRow[]) {
  const utilValues = assets
    .map(a => a.utilizationPct)
    .filter((v): v is number => v != null && Number.isFinite(v));
  return {
    assetCount: assets.length,
    totalEngineHours: assets.reduce((s, a) => s + (a.engineHours || 0), 0),
    totalDistanceKm: assets.reduce((s, a) => s + (a.distanceKm || 0), 0),
    avgUtilizationPct: utilValues.length
      ? utilValues.reduce((s, v) => s + v, 0) / utilValues.length
      : null,
  };
}

export default function UtilizationPage() {
  const { vehicles, selectedSites } = useFleet();
  const siteFiltered = selectedSites.length > 0;
  const [period, setPeriod] = useState<PeriodMode>('week');
  const [customRange, setCustomRange] = useState(() => {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - 7);
    return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
  });
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 250);

  const url = buildKpiUrl(period, 'all', customRange.from, customRange.to);
  const [data, setData] = useState<KpiData | null>(() => cachePeek<KpiData>(CACHE_KEYS.kpi(url)));
  const [loading, setLoading] = useState(() => !cachePeek(CACHE_KEYS.kpi(url)));

  const fetchData = useCallback(async () => {
    const nextUrl = buildKpiUrl(period, 'all', customRange.from, customRange.to);
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
  }, [period, customRange.from, customRange.to]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  const scopedAssets = useMemo(() => {
    const rows = data?.assets ?? [];
    return siteFiltered ? filterDistanceAssetsByVehicles(rows, vehicles) : rows;
  }, [data?.assets, siteFiltered, vehicles]);

  const assets = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    let rows = scopedAssets;
    if (q) {
      rows = rows.filter(a =>
        (a.regNo || '').toLowerCase().includes(q)
        || (a.assetName || '').toLowerCase().includes(q)
        || (a.zone || '').toLowerCase().includes(q));
    }
    return rows;
  }, [scopedAssets, debouncedSearch]);

  type SortKey = 'regNo' | 'zone' | 'utilizationPct' | 'availabilityPct' | 'distanceKm' | 'engineHours';
  const getSortValue = (row: KpiAssetRow, key: SortKey) => row[key];
  const { sorted, toggle, ariaSort, indicator } = useTableSort(assets, getSortValue);
  const {
    pageRows, page, pageCount, from: pageFrom, to: pageTo, total: pageTotal, hasPrev, hasNext, prev, next,
  } = useClientPagination(sorted, 50, `${period}|${customRange.from}|${customRange.to}|${debouncedSearch}|${selectedSites.join(',')}`);

  const summary = useMemo(() => {
    if (!siteFiltered) return data?.summary ?? null;
    return summarizeScopedAssets(scopedAssets);
  }, [siteFiltered, data?.summary, scopedAssets]);

  const withTrips = assets.filter(a => (a.tripCount ?? 0) > 0).length;
  const available = siteFiltered
    ? (vehicles.length || scopedAssets.length)
    : (vehicles.length || summary?.assetCount || 0);

  return (
    <div>
      <div className="bpl-page-header">
        <h1 className="bpl-page-title">Utilization</h1>
        <p className="bpl-page-subtitle">
          Engine / drive intensity and distance across {siteFiltered ? 'selected transporters' : 'the fleet'}
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
          Trip activity · {withTrips}/{available} assets with trips
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12 }}>
          {[
            { label: 'Fleet activity %', value: available > 0 ? `${Math.round((withTrips / available) * 100)}%` : '—', tip: 'Share of fleet with at least one trip.', color: '#0f172a' },
            { label: 'Total distance', value: summary ? `${Math.round(summary.totalDistanceKm).toLocaleString()} km` : '—', tip: 'Total km from trips in period.', color: '#2563eb' },
            { label: 'Avg utilization', value: summary?.avgUtilizationPct != null ? `${fmt(summary.avgUtilizationPct, 0)}%` : '—', tip: 'Average loaded utilization across assets.', color: '#0d9488' },
            { label: 'Engine hours', value: summary ? `${fmt(summary.totalEngineHours, 0)} h` : '—', tip: 'Total engine-on hours.', color: '#7c3aed' },
          ].map(k => (
            <div key={k.label} style={{ padding: '14px 16px', borderRadius: 10, background: 'var(--cd-surface)', border: '1px solid var(--cd-border)', borderTop: `3px solid ${k.color}` }}>
              <div style={{ fontSize: 11, color: 'var(--cd-text-muted)', marginBottom: 4 }}>
                {k.label}
              </div>
              <div style={{ fontSize: 20, fontWeight: 700, color: k.color }}>
                {loading && !data ? <SkelValue /> : k.value}
              </div>
              <div style={{
                fontSize: 10,
                color: 'var(--cd-text-muted)',
                marginTop: 6,
                display: 'inline-flex',
                alignItems: 'flex-start',
                gap: 5,
                lineHeight: 1.35,
              }}>
                <Info size={11} strokeWidth={2.25} style={{ flexShrink: 0, marginTop: 1, opacity: 0.75 }} aria-hidden />
                <span>{k.tip}</span>
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
                { key: 'regNo' as const, label: 'Asset', tip: null },
                { key: 'zone' as const, label: 'Zone', tip: null },
                { key: 'utilizationPct' as const, label: 'Util %', tip: 'Loaded utilization' },
                { key: 'availabilityPct' as const, label: 'Avail %', tip: 'Availability' },
                { key: 'distanceKm' as const, label: 'Distance', tip: 'Trip distance' },
                { key: 'engineHours' as const, label: 'Engine h', tip: 'Engine hours' },
              ] as const).map(col => (
                <th
                  key={col.key}
                  aria-sort={ariaSort(col.key)}
                  onClick={() => toggle(col.key)}
                  style={{ cursor: 'pointer', userSelect: 'none' }}
                >
                  <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap' }}>
                      {col.label}{indicator(col.key)}
                    </span>
                    {col.tip && (
                      <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        fontSize: 10,
                        fontWeight: 500,
                        color: 'var(--cd-text-muted)',
                        textTransform: 'none',
                        letterSpacing: 0,
                        whiteSpace: 'nowrap',
                      }}>
                        <Info size={10} strokeWidth={2.25} style={{ flexShrink: 0, opacity: 0.75 }} aria-hidden />
                        {col.tip}
                      </span>
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && pageRows.length === 0 ? (
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
