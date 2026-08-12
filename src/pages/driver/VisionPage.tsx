import { useState, useEffect, useCallback, useMemo } from 'react';
import { Camera, Smartphone, Search, EyeOff } from 'lucide-react';
import { authFetch } from '../../context/FleetContext';
import { isActiveDriver, displayDriverName } from '../../lib/driverUtils';
import { DEMO_BRANDING, demoDriverLabel } from '../../config/demoBranding';
import MockNamesBadge from '../../components/MockNamesBadge';
import { type KpiPeriodMode, type FatigueDriverRow, buildKpiUrl, defaultKpiCustomRange } from '../../lib/operationalKpi';
import { cachedFetchJson, cachePeek, CACHE_KEYS, CACHE_TTL } from '../../lib/apiCache';
import { useClientPagination } from '../../hooks/useClientPagination';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useTableSort } from '../../hooks/useTableSort';
import PageControls from '../../components/PageControls';

type VisionRow = FatigueDriverRow & { visionTotal: number };
type SortKey = 'driverName' | 'distractionCount' | 'phoneDistractionCount' | 'visionTotal' | 'lastEventTime';

function scrubKpiDrivers(list: FatigueDriverRow[]): FatigueDriverRow[] {
  if (!DEMO_BRANDING) return list;
  return list.map(d => ({
    ...d,
    driverName: isActiveDriver(d.driverName, d.driverId) ? demoDriverLabel(d.driverName) : d.driverName,
  }));
}

function fmtTime(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function VisionPage() {
  const [period, setPeriod] = useState<KpiPeriodMode>('week');
  const [customRange, setCustomRange] = useState(defaultKpiCustomRange);
  const initialUrl = buildKpiUrl('week', 'all');
  const [drivers, setDrivers] = useState<FatigueDriverRow[]>(
    () => scrubKpiDrivers(cachePeek<{ fatigue: { drivers: FatigueDriverRow[] } }>(CACHE_KEYS.kpi(initialUrl))?.fatigue.drivers ?? []),
  );
  const [loading, setLoading] = useState(() => !cachePeek(CACHE_KEYS.kpi(initialUrl)));
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 200);

  const fetchData = useCallback(async () => {
    const url = buildKpiUrl(period, 'all', customRange.from, customRange.to);
    const cacheKey = CACHE_KEYS.kpi(url);
    const cached = cachePeek<{ fatigue: { drivers: FatigueDriverRow[] } }>(cacheKey);
    if (cached) { setDrivers(scrubKpiDrivers(cached.fatigue.drivers)); setLoading(false); }
    else setLoading(true);
    try {
      const next = await cachedFetchJson<{ fatigue: { drivers: FatigueDriverRow[] } }>(
        cacheKey, CACHE_TTL.kpi,
        async () => {
          const res = await authFetch(url);
          if (!res.ok) return null;
          return res.json();
        },
      );
      if (next) setDrivers(scrubKpiDrivers(next.fatigue.drivers));
    } catch { /* keep prior */ }
    finally { setLoading(false); }
  }, [period, customRange.from, customRange.to]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  const rows: VisionRow[] = useMemo(() => {
    return drivers
      .filter(d => isActiveDriver(d.driverName, d.driverId))
      .map(d => ({ ...d, visionTotal: d.distractionCount + d.phoneDistractionCount }))
      .filter(d => d.visionTotal > 0);
  }, [drivers]);

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(d =>
      d.driverName.toLowerCase().includes(q) || d.vehicles.some(v => v.toLowerCase().includes(q)));
  }, [rows, debouncedSearch]);

  const getSortValue = (row: VisionRow, key: SortKey) => {
    if (key === 'lastEventTime') return row.lastEventTime ? new Date(row.lastEventTime).getTime() : null;
    return row[key];
  };
  const { sorted, toggle, ariaSort, indicator } = useTableSort(filtered, getSortValue);
  const pagination = useClientPagination(sorted, 25);

  const totals = useMemo(() => ({
    distraction: rows.reduce((s, d) => s + d.distractionCount, 0),
    phone: rows.reduce((s, d) => s + d.phoneDistractionCount, 0),
    drivers: rows.length,
  }), [rows]);

  const kpiCards = [
    { label: 'Drivers flagged', value: totals.drivers, hint: 'With any vision event', color: '#0891b2', icon: Camera },
    { label: 'Distraction events', value: totals.distraction, hint: 'MiX Vision — eyes off road', color: '#2563eb', icon: EyeOff },
    { label: 'Phone distraction', value: totals.phone, hint: 'MiX Vision — mobile phone use', color: '#e11d48', icon: Smartphone },
  ];

  const columns: { key: SortKey; label: string; dot: string }[] = [
    { key: 'driverName', label: 'Driver', dot: '#0891b2' },
    { key: 'distractionCount', label: 'Distraction', dot: '#2563eb' },
    { key: 'phoneDistractionCount', label: 'Phone Use', dot: '#e11d48' },
    { key: 'visionTotal', label: 'Total', dot: '#0078D4' },
    { key: 'lastEventTime', label: 'Last Event', dot: '#0d9488' },
  ];

  return (
    <div>
      <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--cd-text)', fontFamily: 'var(--cd-font-display)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Camera size={18} color="#0891b2" />
        Driver Management — Vision <MockNamesBadge />
      </div>
      <p style={{ fontSize: 13, color: 'var(--cd-text-muted)', marginBottom: 20 }}>
        MiX Vision in-cab camera detections — distraction (eyes off the road) and mobile phone use, grouped by driver.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 20, alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: '1 1 200px', minWidth: 200, maxWidth: 320 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--cd-text-muted)' }} />
          <input
            type="text"
            placeholder="Search driver or vehicle…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              width: '100%', paddingLeft: 34, paddingRight: 12, paddingTop: 8, paddingBottom: 8,
              border: '1px solid var(--cd-border)', borderRadius: 8, fontSize: 13,
              background: 'var(--cd-surface-2)', color: 'var(--cd-text)', outline: 'none',
            }}
          />
        </div>

        <div style={{ display: 'flex', gap: 4 }}>
          {(['day', 'week', 'month'] as const).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              style={{
                padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                border: period === p ? '1px solid #0891b2' : '1px solid var(--cd-border)',
                background: period === p ? 'rgba(8,145,178,0.12)' : 'transparent',
                color: period === p ? '#0891b2' : 'var(--cd-text-muted)',
              }}
            >
              {p === 'day' ? 'Today' : p === 'week' ? '7 Days' : '30 Days'}
            </button>
          ))}
          <button
            onClick={() => setPeriod('custom')}
            style={{
              padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              border: period === 'custom' ? '1px solid #0891b2' : '1px solid var(--cd-border)',
              background: period === 'custom' ? 'rgba(8,145,178,0.12)' : 'transparent',
              color: period === 'custom' ? '#0891b2' : 'var(--cd-text-muted)',
            }}
          >
            Custom
          </button>
        </div>

        {period === 'custom' && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="date" value={customRange.from} onChange={e => setCustomRange(r => ({ ...r, from: e.target.value }))}
              style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid var(--cd-border)', fontSize: 12 }} />
            <span style={{ color: 'var(--cd-text-muted)', fontSize: 12 }}>to</span>
            <input type="date" value={customRange.to} onChange={e => setCustomRange(r => ({ ...r, to: e.target.value }))}
              style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid var(--cd-border)', fontSize: 12 }} />
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 20 }}>
        {kpiCards.map(k => (
          <div key={k.label} style={{
            padding: '14px 16px', borderRadius: 10,
            background: `linear-gradient(180deg, ${k.color}0d, var(--cd-surface) 55%)`,
            border: '1px solid var(--cd-border)', borderTop: `3px solid ${k.color}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ fontSize: 11, color: 'var(--cd-text-muted)' }}>{k.label}</div>
              <k.icon size={14} style={{ color: k.color, opacity: 0.75, flexShrink: 0, marginTop: 1 }} />
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, color: k.color }}>{loading ? '…' : k.value}</div>
            <div style={{ fontSize: 10, color: 'var(--cd-text-muted)', marginTop: 2 }}>{k.hint}</div>
          </div>
        ))}
      </div>

      <div style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid var(--cd-border)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: 'linear-gradient(180deg, rgba(8,145,178,0.07), var(--cd-surface-2))', textAlign: 'left' }}>
              {columns.map(c => (
                <th
                  key={c.key}
                  onClick={() => toggle(c.key)}
                  aria-sort={ariaSort(c.key)}
                  style={{ padding: '10px 12px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', userSelect: 'none' }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', color: 'var(--cd-text-muted)' }}>
                    <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: c.dot, marginRight: 6, flexShrink: 0 }} />
                    <span style={{ color: ariaSort(c.key) !== 'none' ? c.dot : 'var(--cd-text-muted)' }}>
                      {c.label}{indicator(c.key)}
                    </span>
                  </span>
                </th>
              ))}
              <th style={{ padding: '10px 12px' }}>Vehicles</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={columns.length + 1} style={{ padding: 20, textAlign: 'center', color: 'var(--cd-text-muted)' }}>Loading…</td></tr>
            ) : pagination.pageRows.length === 0 ? (
              <tr><td colSpan={columns.length + 1} style={{ padding: 20, textAlign: 'center', color: 'var(--cd-text-muted)' }}>
                {search.trim() ? `No drivers match "${search.trim()}"` : 'No vision events in this period'}
              </td></tr>
            ) : pagination.pageRows.map(d => (
              <tr key={d.driverId || d.driverName} style={{ borderTop: '1px solid var(--cd-border)' }}>
                <td style={{ padding: '8px 12px', fontWeight: 600, whiteSpace: 'nowrap' }}>{displayDriverName(d.driverName)}</td>
                <td style={{ padding: '8px 12px' }}>
                  {d.distractionCount > 0 ? <span style={{ color: '#2563eb', fontWeight: 600 }}>{d.distractionCount}</span> : '0'}
                </td>
                <td style={{ padding: '8px 12px' }}>
                  {d.phoneDistractionCount > 0 ? <span style={{ color: '#e11d48', fontWeight: 600 }}>{d.phoneDistractionCount}</span> : '0'}
                </td>
                <td style={{ padding: '8px 12px', fontWeight: 700, color: '#0078D4' }}>{d.visionTotal}</td>
                <td style={{ padding: '8px 12px', color: '#0d9488', whiteSpace: 'nowrap' }}>{fmtTime(d.lastEventTime)}</td>
                <td style={{ padding: '8px 12px', color: 'var(--cd-text-muted)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.vehicles.join(', ')}>
                  {d.vehicles.join(', ') || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pagination.total > 0 && (
        <div className="bpl-card" style={{ marginTop: 10, padding: 0 }}>
          <PageControls
            page={pagination.page} pageCount={pagination.pageCount}
            from={pagination.from} to={pagination.to} total={pagination.total}
            hasPrev={pagination.hasPrev} hasNext={pagination.hasNext}
            onPrev={pagination.prev} onNext={pagination.next}
            itemLabel="drivers"
          />
        </div>
      )}
    </div>
  );
}
