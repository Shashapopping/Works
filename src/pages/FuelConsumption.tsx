import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Fuel, MapPin, ChevronDown, ChevronRight, AlertTriangle, Route, Search, Clock, Gauge, Zap, Truck } from 'lucide-react';
import {
  QUARRY_SITE_KEYS,
  QUARRY_SITE_LABELS,
  fuelZoneColor,
  type QuarrySiteKey,
} from '../components/FuelChart';
import {
  type PeriodMode,
  type AssetRow,
  type TripRow,
  type RefuelRow,
  type ConsumptionData,
  type SummaryMetrics,
  buildConsumptionUrl,
  aggregateMetrics,
  defaultCustomRange,
} from '../lib/fuelConsumption';
import { displayDriverName } from '../lib/driverUtils';
import { fetchFuelConsumptionCached, peekFuelConsumption } from '../hooks/useFuelConsumption';

const COL_COUNT = 10;

const ASSET_COLUMN_DOTS: Record<string, string> = {
  Trips: '#16a34a',
  'Fuel (est.)': '#0078D4',
  Distance: '#0d9488',
  Duration: '#7c3aed',
  'L/km': '#ea580c',
  'L/h': '#d97706',
  Refuels: '#dc2626',
};

function fmt(n: number | null | undefined, digits = 1) {
  if (n == null || Number.isNaN(n)) return '—';
  return n.toFixed(digits);
}

function fmtRatio(n: number | null | undefined) {
  return fmt(n, 2);
}

function fmtDriveHours(hours: number | null | undefined, digits = 1) {
  if (hours == null || Number.isNaN(hours) || hours <= 0) return '—';
  return `${hours.toFixed(digits)} h`;
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtDuration(minutes: number | undefined) {
  if (minutes == null || minutes < 0) return '—';
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function fmtAddress(addr: string | null, max = 42) {
  if (!addr) return '—';
  return addr.length > max ? `${addr.slice(0, max)}…` : addr;
}

function KpiStrip({ summary, initialLoading, scopeLabel }: { summary: SummaryMetrics; initialLoading: boolean; scopeLabel: string }) {
  const cards = [
    { label: 'Trip fuel (est.)', value: `${fmt(summary.fuel, 0)} L`, color: '#0078D4', icon: Fuel },
    { label: 'Distance', value: `${fmt(summary.distance, 0)} km`, color: '#0d9488', icon: Route },
    { label: 'Duration', value: fmtDriveHours(summary.drivingHours, 1), color: '#7c3aed', icon: Clock },
    { label: 'L/km', value: fmtRatio(summary.litersPerKm), color: '#ea580c', icon: Gauge },
    { label: 'L/h', value: fmt(summary.litersPerHour), color: '#d97706', icon: Zap },
    { label: 'Trips', value: String(summary.trips), color: '#16a34a', icon: Truck },
    { label: 'Refuel flags', value: String(summary.refuels), color: '#dc2626', icon: AlertTriangle },
  ];

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--cd-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
        {scopeLabel}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12 }}>
        {cards.map(k => (
          <div key={k.label} style={{
            padding: '14px 16px', borderRadius: 10,
            background: `linear-gradient(180deg, ${k.color}0d, var(--cd-surface) 55%)`,
            border: '1px solid var(--cd-border)', borderTop: `3px solid ${k.color}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ fontSize: 11, color: 'var(--cd-text-muted)', marginBottom: 4 }}>{k.label}</div>
              <k.icon size={14} style={{ color: k.color, opacity: 0.75, flexShrink: 0, marginTop: 1 }} />
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, color: k.color }}>{initialLoading ? '…' : k.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AssetDetailPanel({
  trips,
  refuels,
}: {
  trips: TripRow[];
  refuels: RefuelRow[];
}) {
  return (
    <div style={{
      padding: '12px 16px 16px 40px',
      background: 'var(--cd-surface-2)',
      borderTop: '1px solid var(--cd-border)',
    }}>
      {refuels.length > 0 && (
        <div style={{ marginBottom: refuels.length > 0 && trips.length > 0 ? 16 : 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--cd-text)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <AlertTriangle size={13} color="#d97706" />
            Refuel events ({refuels.length})
          </div>
          <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid var(--cd-border)', background: 'var(--cd-surface)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr>
                  {['Start', 'End', 'Duration', 'Before', 'After', '+L'].map(h => (
                    <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600, color: 'var(--cd-text-muted)', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {refuels.map((r, i) => {
                  const end = r.endTime || r.timestamp;
                  const start = r.startTime || r.timestamp;
                  return (
                  <tr key={i} style={{ borderTop: '1px solid var(--cd-border)' }}>
                    <td style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>{fmtDate(start)}</td>
                    <td style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>{fmtDate(end)}</td>
                    <td style={{ padding: '6px 10px' }}>{fmtDuration(r.durationMinutes)}</td>
                    <td style={{ padding: '6px 10px' }}>{fmt(r.beforeLevel, 0)} L</td>
                    <td style={{ padding: '6px 10px' }}>{fmt(r.afterLevel, 0)} L</td>
                    <td style={{ padding: '6px 10px', color: '#16a34a', fontWeight: 600 }}>+{fmt(r.deltaLiters, 0)}</td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--cd-text)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Route size={13} />
          Recent trips ({trips.length})
        </div>
        {trips.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--cd-text-muted)', padding: '8px 0' }}>No trips in this period</div>
        ) : (
          <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid var(--cd-border)', background: 'var(--cd-surface)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr>
                  {['Driver', 'Start', 'End', 'From', 'To', 'km', 'Duration', 'Fuel (est.)', 'L/km', 'L/h'].map(h => (
                    <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600, color: 'var(--cd-text-muted)', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {trips.map(t => (
                  <tr key={t.tripId} style={{ borderTop: '1px solid var(--cd-border)' }}>
                    <td style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>{displayDriverName(t.driverName)}</td>
                    <td style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>{fmtDate(t.tripStart)}</td>
                    <td style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>{fmtDate(t.tripEnd)}</td>
                    <td style={{ padding: '6px 10px', maxWidth: 180 }} title={t.startAddress || undefined}>{fmtAddress(t.startAddress)}</td>
                    <td style={{ padding: '6px 10px', maxWidth: 180 }} title={t.endAddress || undefined}>{fmtAddress(t.endAddress)}</td>
                    <td style={{ padding: '6px 10px' }}>{fmt(t.distanceKm, 1)}</td>
                    <td style={{ padding: '6px 10px' }}>{fmtDriveHours(t.drivingHours, 2)}</td>
                    <td style={{ padding: '6px 10px' }}>{fmt(t.fuelUsedLiters, 1)}</td>
                    <td style={{ padding: '6px 10px' }}>{fmtRatio(t.litersPerKm)}</td>
                    <td style={{ padding: '6px 10px' }}>{fmt(t.litersPerHour)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default function FuelConsumption() {
  const [searchParams] = useSearchParams();
  const linkedAssetId = searchParams.get('asset');
  const linkedSite = searchParams.get('site');
  const linkedPeriod = searchParams.get('period');
  const initialSite = QUARRY_SITE_KEYS.includes(linkedSite as QuarrySiteKey)
    ? linkedSite as QuarrySiteKey
    : 'ALL';
  const initialPeriod: PeriodMode = linkedPeriod === 'day' || linkedPeriod === 'week' || linkedPeriod === 'month'
    ? linkedPeriod
    : 'week';
  const [selectedSite, setSelectedSite] = useState<QuarrySiteKey | 'ALL'>(initialSite);
  const [siteMenuOpen, setSiteMenuOpen] = useState(false);
  const [period, setPeriod] = useState<PeriodMode>(initialPeriod);
  const [customRange, setCustomRange] = useState(defaultCustomRange);
  const initialUrl = buildConsumptionUrl(initialPeriod, initialSite, defaultCustomRange().from, defaultCustomRange().to);
  const [data, setData] = useState<ConsumptionData | null>(() => peekFuelConsumption(initialUrl));
  const [loading, setLoading] = useState(() => !peekFuelConsumption(initialUrl));
  const [expandedAssetId, setExpandedAssetId] = useState<string | null>(linkedAssetId);
  const [search, setSearch] = useState(linkedAssetId ?? '');
  const linkedRowRef = useRef<HTMLTableRowElement | null>(null);

  const fetchData = useCallback(async (silent = false) => {
    const url = buildConsumptionUrl(period, selectedSite, customRange.from, customRange.to);
    if (!silent) {
      const cached = peekFuelConsumption(url);
      if (cached) {
        setData(cached);
        setLoading(false);
      } else {
        setLoading(true);
      }
    }
    try {
      const next = await fetchFuelConsumptionCached(url, { force: silent });
      if (next) setData(next);
    } catch { /* ignore */ }
    finally {
      if (!silent) setLoading(false);
    }
  }, [period, selectedSite, customRange.from, customRange.to]);

  useEffect(() => {
    void fetchData(false);
  }, [fetchData]);

  useEffect(() => {
    const id = setInterval(() => void fetchData(true), 60_000);
    return () => clearInterval(id);
  }, [fetchData]);

  const initialLoading = loading && data === null;

  const allAssets = data?.assets ?? [];

  const siteCounts = useMemo(() => {
    const counts: Record<string, number> = { ALL: allAssets.length };
    QUARRY_SITE_KEYS.forEach(z => { counts[z] = 0; });
    allAssets.forEach(a => {
      if (a.zone in counts) counts[a.zone]++;
    });
    return counts;
  }, [allAssets]);

  const assets = useMemo(() => {
    const bySite = selectedSite === 'ALL' ? allAssets : allAssets.filter(a => a.zone === selectedSite);
    const q = search.trim().toLowerCase();
    if (!q) return bySite;
    const qCompact = q.replace(/\s+/g, '');
    return bySite.filter(a => {
      const reg = (a.regNo || '').toLowerCase();
      const regCompact = reg.replace(/\s+/g, '');
      const name = (a.assetName || '').toLowerCase();
      const id = (a.assetId || '').toLowerCase();
      return reg.includes(q) || regCompact.includes(qCompact) || name.includes(q) || id.includes(q);
    });
  }, [allAssets, selectedSite, search]);

  useEffect(() => {
    const q = search.trim();
    if (!q) return;
    if (assets.length === 1) setExpandedAssetId(assets[0].assetId);
  }, [search, assets]);

  useEffect(() => {
    if (!linkedAssetId || loading || expandedAssetId !== linkedAssetId) return;
    const id = window.setTimeout(() => {
      linkedRowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
    return () => window.clearTimeout(id);
  }, [linkedAssetId, loading, expandedAssetId]);

  const tripsByAsset = useMemo(() => {
    const map = new Map<string, TripRow[]>();
    (data?.trips ?? []).forEach(t => {
      if (!t.assetId) return;
      if (!map.has(t.assetId)) map.set(t.assetId, []);
      map.get(t.assetId)!.push(t);
    });
    return map;
  }, [data?.trips]);

  const refuelsByAsset = useMemo(() => {
    const map = new Map<string, RefuelRow[]>();
    (data?.refuels ?? []).forEach(r => {
      if (!map.has(r.assetId)) map.set(r.assetId, []);
      map.get(r.assetId)!.push(r);
    });
    return map;
  }, [data?.refuels]);

  const siteSummary = useMemo(() => aggregateMetrics(assets), [assets]);

  const siteLabel = selectedSite === 'ALL' ? 'All sites' : QUARRY_SITE_LABELS[selectedSite];
  const vehicleCount = assets.length;
  const siteColor = selectedSite === 'ALL' ? '#0078D4' : fuelZoneColor(selectedSite);

  const kpiScopeLabel = search.trim()
    ? `${siteLabel} · ${vehicleCount} match${vehicleCount === 1 ? '' : 'es'} for "${search.trim()}"`
    : `${siteLabel} · ${vehicleCount} vehicle${vehicleCount === 1 ? '' : 's'} — period summary`;

  return (
    <div>
      <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--cd-text)', fontFamily: 'var(--cd-font-display)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Fuel size={18} color="#0078D4" />
        Fuel Consumption
      </div>
      <p style={{ fontSize: 13, color: 'var(--cd-text-muted)', marginBottom: 20 }}>
        Trip fuel is estimated from probe readings at trip start/end. Duration is MiX driving hours (used for L/h).
      </p>

      {/* Controls */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 20, alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: '1 1 200px', minWidth: 200, maxWidth: 320 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--cd-text-muted)' }} />
          <input
            type="text"
            placeholder="Search reg no, asset name…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              width: '100%', paddingLeft: 34, paddingRight: 12, paddingTop: 8, paddingBottom: 8,
              border: '1px solid var(--cd-border)', borderRadius: 8, fontSize: 13,
              background: 'var(--cd-surface-2)', color: 'var(--cd-text)', outline: 'none',
            }}
          />
        </div>

        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setSiteMenuOpen(o => !o)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 14px', borderRadius: 8,
              border: `1px solid ${siteColor}40`,
              background: `${siteColor}12`,
              color: 'var(--cd-text)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}
          >
            <MapPin size={14} color={siteColor} />
            <span>{siteLabel}</span>
            <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--cd-text-muted)' }}>
              · {vehicleCount} vehicle{vehicleCount === 1 ? '' : 's'}
            </span>
            <ChevronDown size={14} />
          </button>
          {siteMenuOpen && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 50,
              background: 'var(--cd-surface)', border: '1px solid var(--cd-border)',
              borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', minWidth: 220,
            }}>
              {(['ALL', ...QUARRY_SITE_KEYS] as const).map(key => (
                <button
                  key={key}
                  onClick={() => { setSelectedSite(key); setSiteMenuOpen(false); setExpandedAssetId(null); }}
                  style={{
                    display: 'flex', justifyContent: 'space-between', width: '100%',
                    padding: '8px 14px', border: 'none', background: 'transparent',
                    fontSize: 13, cursor: 'pointer', color: 'var(--cd-text)',
                  }}
                >
                  <span>{key === 'ALL' ? 'All sites' : QUARRY_SITE_LABELS[key]}</span>
                  <span style={{ color: 'var(--cd-text-muted)', fontSize: 12 }}>{siteCounts[key] ?? 0}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 4 }}>
          {(['day', 'week', 'month'] as const).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              style={{
                padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                border: period === p ? '1px solid #0078D4' : '1px solid var(--cd-border)',
                background: period === p ? 'rgba(0,120,212,0.12)' : 'transparent',
                color: period === p ? '#0078D4' : 'var(--cd-text-muted)',
              }}
            >
              {p === 'day' ? 'Today' : p === 'week' ? '7 Days' : '30 Days'}
            </button>
          ))}
          <button
            onClick={() => setPeriod('custom')}
            style={{
              padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              border: period === 'custom' ? '1px solid #0078D4' : '1px solid var(--cd-border)',
              background: period === 'custom' ? 'rgba(0,120,212,0.12)' : 'transparent',
              color: period === 'custom' ? '#0078D4' : 'var(--cd-text-muted)',
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

      <KpiStrip summary={siteSummary} initialLoading={initialLoading} scopeLabel={kpiScopeLabel} />

      {/* Asset table with expandable detail */}
      <div>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10, color: 'var(--cd-text)', display: 'flex', alignItems: 'center', gap: 7 }}>
          <Truck size={15} color="#0078D4" />
          By asset
          <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--cd-text-muted)', marginLeft: 4 }}>
            Click a row to expand trips and refuels
          </span>
        </div>
        <div style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid var(--cd-border)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'linear-gradient(180deg, rgba(0,120,212,0.07), var(--cd-surface-2))', textAlign: 'left' }}>
                <th style={{ padding: '10px 8px', width: 28 }} />
                {['Reg', 'Site', 'Trips', 'Fuel (est.)', 'Distance', 'Duration', 'L/km', 'L/h', 'Refuels'].map(h => {
                  const dot = ASSET_COLUMN_DOTS[h];
                  return (
                    <th key={h} style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--cd-text-muted)', whiteSpace: 'nowrap' }}>
                      {dot ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                          <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: dot, marginRight: 6, flexShrink: 0 }} />
                          {h}
                        </span>
                      ) : h}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {initialLoading ? (
                <tr><td colSpan={COL_COUNT} style={{ padding: 20, textAlign: 'center', color: 'var(--cd-text-muted)' }}>Loading…</td></tr>
              ) : assets.length === 0 ? (
                <tr><td colSpan={COL_COUNT} style={{ padding: 20, textAlign: 'center', color: 'var(--cd-text-muted)' }}>
                  {search.trim() ? `No assets match "${search.trim()}"` : 'No data — run fuel + trips backfill first'}
                </td></tr>
              ) : assets.map(a => {
                const isExpanded = expandedAssetId === a.assetId;
                const assetTrips = (tripsByAsset.get(a.assetId) ?? []).slice(0, 25);
                const assetRefuels = refuelsByAsset.get(a.assetId) ?? [];
                const isLinked = linkedAssetId === a.assetId;
                return (
                  <Fragment key={a.assetId}>
                    <tr
                      ref={isLinked ? linkedRowRef : undefined}
                      onClick={() => setExpandedAssetId(isExpanded ? null : a.assetId)}
                      style={{
                        cursor: 'pointer',
                        background: isLinked
                          ? 'rgba(0,120,212,0.16)'
                          : isExpanded ? 'rgba(0,120,212,0.08)' : 'transparent',
                        borderTop: '1px solid var(--cd-border)',
                        boxShadow: isLinked ? 'inset 3px 0 0 #0078D4' : 'none',
                      }}
                    >
                      <td style={{ padding: '8px 8px', color: 'var(--cd-text-muted)' }}>
                        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </td>
                      <td style={{ padding: '8px 12px', fontWeight: 600 }}>{a.regNo}</td>
                      <td style={{ padding: '8px 12px', color: fuelZoneColor(a.zone) }}>
                        {QUARRY_SITE_LABELS[a.zone as QuarrySiteKey] || a.zone}
                      </td>
                      <td style={{ padding: '8px 12px', color: '#16a34a', fontWeight: 600 }}>{a.tripCount}</td>
                      <td style={{ padding: '8px 12px', color: '#0078D4', fontWeight: 600 }}>{fmt(a.totalFuelLiters, 0)}</td>
                      <td style={{ padding: '8px 12px', color: '#0d9488' }}>{fmt(a.totalDistanceKm, 0)}</td>
                      <td style={{ padding: '8px 12px', color: '#7c3aed' }}>{fmtDriveHours(a.totalDrivingHours, 1)}</td>
                      <td style={{ padding: '8px 12px', color: '#ea580c' }}>{fmtRatio(a.litersPerKm)}</td>
                      <td style={{ padding: '8px 12px', color: '#d97706' }}>{fmt(a.litersPerHour)}</td>
                      <td style={{ padding: '8px 12px' }}>
                        {a.refuelCount > 0 ? (
                          <span style={{ color: '#d97706', display: 'flex', alignItems: 'center', gap: 4 }}>
                            <AlertTriangle size={12} /> {a.refuelCount}
                          </span>
                        ) : '0'}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={COL_COUNT} style={{ padding: 0 }}>
                          <AssetDetailPanel trips={assetTrips} refuels={assetRefuels} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
