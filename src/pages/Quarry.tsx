import { useMemo, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Mountain, Gauge, AlertTriangle, Truck, Navigation, Fuel,
  Droplets, ArrowUpRight, Activity,
} from 'lucide-react';
import { useFleet, authFetch, type Vehicle, type TripAsset } from '../context/FleetContext';
import { KpiCard } from '../components/KpiCard';
import {
  QUARRY_SITE_KEYS, QUARRY_SITE_LABELS, fuelZoneColor, type QuarrySiteKey,
} from '../components/FuelChart';
import { useFuelConsumption } from '../hooks/useFuelConsumption';
import { aggregateMetrics } from '../lib/fuelConsumption';
import {
  segmentVehicles, segmentTripAssets, quarrySiteLabel,
  countByStatus, STATUS_COLOR, utilizationPct,
} from '../lib/segmentMetrics';

/** HBM Availability CSV import window (source=excel in fleet.db). */
const HAUL_HISTORY = { from: '2026-01-01', to: '2026-07-01' };

type QuarryVehicle = Vehicle & { fuelLevel?: { level: number } | null };

function fmtL(n: number) {
  if (!Number.isFinite(n) || n <= 0) return '—';
  return `${Math.round(n).toLocaleString()} L`;
}

function fmtRatio(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toFixed(2);
}

export default function Quarry() {
  const { vehicles, driverDistance } = useFleet();
  const { data: fuelData, loading: fuelLoading } = useFuelConsumption('custom', HAUL_HISTORY);
  const [historyAssets, setHistoryAssets] = useState<TripAsset[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch(
          `/api/driver-distance?from=${encodeURIComponent(HAUL_HISTORY.from)}&to=${encodeURIComponent(HAUL_HISTORY.to)}`,
        );
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setHistoryAssets(data.assets || []);
      } catch { /* keep empty */ }
      finally {
        if (!cancelled) setHistoryLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const fleet = useMemo(() => segmentVehicles(vehicles, 'quarry') as QuarryVehicle[], [vehicles]);
  // Prefer Availability CSV window for haul KPIs; fall back to live distance strip
  const haulAssets = useMemo(() => {
    const base = historyAssets.length ? historyAssets : (driverDistance?.assets ?? []);
    return segmentTripAssets(fleet, base);
  }, [fleet, historyAssets, driverDistance]);
  const distanceKm = Math.round(haulAssets.reduce((s, a) => s + a.totalDistanceKm, 0));
  const activeHaulers = haulAssets.filter(a => a.totalDistanceKm > 0).length;

  const bySite = useMemo(() => {
    const map: Record<string, QuarryVehicle[]> = { Ewekoro: [], Mfamosing: [], Other: [] };
    for (const v of fleet) {
      const site = quarrySiteLabel(v.zone);
      if (site === 'Ewekoro') map.Ewekoro.push(v);
      else if (site === 'Mfamosing') map.Mfamosing.push(v);
      else map.Other.push(v);
    }
    return map;
  }, [fleet]);

  const status = useMemo(() => countByStatus(fleet), [fleet]);
  const idleQueue = (status.Idle ?? 0) + (status['Excessive Idle'] ?? 0) + (status.Stationary ?? 0);
  const moving = status.Moving ?? 0;
  const util = utilizationPct(fleet);

  const quarryFuelRows = useMemo(
    () => (fuelData?.assets ?? []).filter(a =>
      QUARRY_SITE_KEYS.includes((a.zone || '').toUpperCase() as QuarrySiteKey),
    ),
    [fuelData],
  );
  const fuelSummary = useMemo(() => aggregateMetrics(quarryFuelRows), [quarryFuelRows]);
  const fuelByZone = useMemo(() => {
    const out: Record<QuarrySiteKey, { liters: number; distance: number; refuels: number; drops: number }> = {
      'QUARRY EWEKORO': { liters: 0, distance: 0, refuels: 0, drops: 0 },
      'QUARRY MFAMOSING': { liters: 0, distance: 0, refuels: 0, drops: 0 },
    };
    for (const a of quarryFuelRows) {
      const z = (a.zone || '').toUpperCase() as QuarrySiteKey;
      if (!out[z]) continue;
      out[z].liters += a.totalFuelLiters;
      out[z].distance += a.totalDistanceKm;
      out[z].refuels += a.refuelCount;
      out[z].drops += a.suspectDropCount;
    }
    return out;
  }, [quarryFuelRows]);

  const probeLive = useMemo(() => {
    return fleet
      .filter(v => v.fuelLevel != null && Number.isFinite(v.fuelLevel.level))
      .map(v => ({
        id: v.id,
        regNo: v.regNo,
        zone: (v.zone || '').toUpperCase(),
        level: v.fuelLevel!.level,
        status: v.status,
      }))
      .sort((a, b) => a.level - b.level);
  }, [fleet]);
  const lowFuel = probeLive.filter(p => p.level > 0 && p.level < 150).slice(0, 4);
  const theftEvents = useMemo(() => {
    const byId = new Map(quarryFuelRows.map(a => [a.assetId, a]));
    return (fuelData?.suspectDrops ?? [])
      .filter(d => {
        if (!byId.has(d.assetId)) return false;
        if (d.likelyNoise) return false;
        // Guard stale cache: single-sample cliffs that rebound are not theft
        if (d.nextLevel != null && d.deltaLiters > 0 && (d.nextLevel - d.afterLevel) >= d.deltaLiters * 0.35) {
          return false;
        }
        if ((d.durationMinutes ?? 99) <= 1 && d.deltaLiters >= 100) return false;
        return true;
      })
      .map(d => ({
        ...d,
        regNo: byId.get(d.assetId)?.regNo ?? d.assetId,
        zone: byId.get(d.assetId)?.zone ?? '',
      }));
  }, [fuelData, quarryFuelRows]);
  const displayedTheftCount = theftEvents.length;
  const maxZoneFuel = Math.max(
    fuelByZone['QUARRY EWEKORO'].liters,
    fuelByZone['QUARRY MFAMOSING'].liters,
    1,
  );

  const leaderboard = useMemo(() =>
    [...haulAssets]
      .sort((a, b) => b.totalDistanceKm - a.totalDistanceKm)
      .slice(0, 15)
      .map(a => {
        const v = fleet.find(f => f.id?.toString() === a.assetId?.toString());
        return { ...a, vehicle: v };
      }),
  [haulAssets, fleet]);

  return (
    <div>
      <div className="bpl-page-header">
        <h1 className="bpl-page-title">Quarry Haulage</h1>
        <p className="bpl-page-subtitle">
          Ewekoro & Mfamosing — live status plus haul/fuel from HBM Availability (Jan–Jun 2026).
        </p>
      </div>

      <div className="bpl-kpi-grid">
        <KpiCard
          label="Active Haulers"
          value={historyLoading ? '…' : activeHaulers}
          sub={`${fleet.length} quarry assets tracked`}
          color="#0d9488"
          icon={Truck}
          tip="Quarry assets with distance in the Availability CSV window (Jan–Jun 2026). Live fleet size in the sub-line."
        />
        <KpiCard
          label="Moving Now"
          value={moving}
          sub={`${idleQueue} idle / waiting`}
          color="#0891b2"
          icon={Navigation}
          tip="Live status Moving count. Sub-line = Idle + Excessive Idle + Stationary (queue / wait proxy)."
        />
        <KpiCard
          label="Haul Distance"
          value={historyLoading ? '…' : `${distanceKm.toLocaleString()} km`}
          sub="Availability window (CSV)"
          color="#059669"
          icon={Mountain}
          tip="Sum of trip distance from HBM Availability import (excel source) for quarry assets, Jan–Jun 2026."
        />
        <KpiCard
          label="Utilization"
          value={`${util}%`}
          sub="Moving share of online quarry fleet"
          color="#d97706"
          icon={Gauge}
          tip="Moving ÷ (fleet minus Offline/Inactive) × 100. Live utilization — not engine-hours based."
        />
      </div>

      {idleQueue > moving && fleet.length > 0 && (
        <div className="bpl-card" style={{
          padding: '12px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10,
          background: 'rgba(217,119,6,0.08)', borderColor: 'rgba(217,119,6,0.35)',
        }}>
          <AlertTriangle size={18} color="#d97706" />
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#d97706' }}>Possible queue bottleneck</div>
            <div style={{ fontSize: 12, color: 'var(--cd-text-muted)' }}>
              {idleQueue} trucks idle or waiting vs {moving} actively hauling — check loader or crusher queue.
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 20 }}>
        {([
          { label: 'Ewekoro', key: 'Ewekoro' as const, zone: 'QUARRY EWEKORO' as QuarrySiteKey },
          { label: 'Mfamosing', key: 'Mfamosing' as const, zone: 'QUARRY MFAMOSING' as QuarrySiteKey },
        ]).map(({ label, key, zone }) => {
          const list = bySite[key];
          const siteMoving = list.filter(v => v.status === 'Moving').length;
          const siteAssets = segmentTripAssets(list, haulAssets);
          const siteKm = Math.round(siteAssets.reduce((s, a) => s + a.totalDistanceKm, 0));
          const siteUtil = list.length ? Math.round((siteMoving / list.length) * 100) : 0;
          const fuel = fuelByZone[zone];
          const color = fuelZoneColor(zone);
          const probes = list.filter(v => v.fuelLevel != null).length;
          return (
            <div key={key} className="bpl-card" style={{ padding: 20, borderTop: `3px solid ${color}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--cd-text-muted)' }}>
                  {label} Quarry
                </div>
                <div style={{ fontSize: 11, fontWeight: 600, color }}>{siteUtil}% util</div>
              </div>
              <div style={{ fontSize: 28, fontWeight: 700, color, fontFamily: 'var(--cd-font-display)', lineHeight: 1 }}>
                {historyLoading ? '…' : siteKm.toLocaleString()}
                <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--cd-text-muted)', marginLeft: 6 }}>km (CSV)</span>
              </div>
              <div style={{ height: 6, background: 'var(--cd-border)', borderRadius: 99, overflow: 'hidden', marginTop: 12 }}>
                <div style={{ height: '100%', width: `${siteUtil}%`, background: color, borderRadius: 99 }} />
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 18px', marginTop: 14, fontSize: 12, color: 'var(--cd-text-muted)' }}>
                <span><strong style={{ color: 'var(--cd-text)' }}>{list.length}</strong> assets</span>
                <span><strong style={{ color: '#16a34a' }}>{siteMoving}</strong> hauling</span>
                <span><strong style={{ color }}>{fuelLoading ? '…' : Math.round(fuel.liters).toLocaleString()}</strong> L fuel</span>
                <span><strong style={{ color: 'var(--cd-text)' }}>{probes}</strong> probes live</span>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.35fr) minmax(300px, 0.85fr)', gap: 14 }}>
        <div className="bpl-card" style={{ overflow: 'hidden' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--cd-border)' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--cd-text)', fontFamily: 'var(--cd-font-display)' }}>
              Haul Distance Leaderboard
            </div>
            <div style={{ fontSize: 11, color: 'var(--cd-text-muted)', marginTop: 2 }}>
              Top assets by km in Availability window (Jan–Jun 2026)
            </div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: 'var(--cd-surface-2)' }}>
                  {['Reg No', 'Zone', 'Distance', 'Status', 'Site'].map(h => (
                    <th key={h} style={{ padding: '9px 14px', textAlign: 'left', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--cd-text-muted)', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {leaderboard.length === 0 ? (
                  <tr><td colSpan={5} style={{ padding: 28, textAlign: 'center', color: 'var(--cd-text-muted)' }}>
                    {historyLoading ? 'Loading haul history…' : 'No haul distance in Availability window'}
                  </td></tr>
                ) : leaderboard.map((row, i) => {
                  const color = STATUS_COLOR[row.vehicle?.status ?? ''] ?? '#6B7A8D';
                  const site = (row.vehicle?.site || row.vehicle?.zone || '—').trim() || '—';
                  return (
                    <tr key={row.assetId} style={{ borderTop: '1px solid var(--cd-border)', background: i % 2 ? 'var(--cd-surface-2)' : undefined }}>
                      <td style={{ padding: '9px 14px', fontWeight: 700, fontFamily: 'var(--cd-font-display)' }}>{row.regNo}</td>
                      <td style={{ padding: '9px 14px', color: 'var(--cd-text-muted)' }}>{row.vehicle?.zone ?? '—'}</td>
                      <td style={{ padding: '9px 14px', fontWeight: 700, color: '#0d9488' }}>{row.totalDistanceKm.toFixed(1)} km</td>
                      <td style={{ padding: '9px 14px' }}>
                        <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 99, background: `${color}18`, color }}>
                          {row.vehicle?.status ?? '—'}
                        </span>
                      </td>
                      <td style={{ padding: '9px 14px', color: 'var(--cd-text-muted)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={site}>
                        {site}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bpl-card" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{
            padding: '14px 18px',
            borderBottom: '1px solid var(--cd-border)',
            background: 'linear-gradient(135deg, rgba(13,148,136,0.10), rgba(8,145,178,0.06))',
            display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10,
          }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Fuel size={16} color="#0d9488" />
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--cd-text)', fontFamily: 'var(--cd-font-display)' }}>
                  Fuel Today
                </div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--cd-text-muted)', marginTop: 3 }}>
                Same probe estimate as Fuel Monitoring
              </div>
            </div>
            <Link
              to="/fuel"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600,
                color: '#0d9488', textDecoration: 'none', whiteSpace: 'nowrap',
              }}
            >
              Open fuel <ArrowUpRight size={13} />
            </Link>
          </div>

          <div style={{ padding: 18, flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--cd-text-muted)' }}>
              Trip fuel (est.)
            </div>
            <div style={{ fontSize: 32, fontWeight: 700, color: '#0d9488', fontFamily: 'var(--cd-font-display)', lineHeight: 1.1, marginTop: 4 }}>
              {fuelLoading && fuelSummary.fuel <= 0 ? '…' : fmtL(fuelSummary.fuel)}
            </div>
            <div style={{ fontSize: 12, color: 'var(--cd-text-muted)', marginTop: 6 }}>
              {fuelSummary.distance > 0
                ? `${Math.round(fuelSummary.distance).toLocaleString()} km · ${fmtRatio(fuelSummary.litersPerKm)} L/km`
                : 'No trip-fuel rows in Availability window'}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 16 }}>
              {[
                { label: 'L / hour', value: fmtRatio(fuelSummary.litersPerHour), icon: Activity, color: '#0891b2' },
                { label: 'Refuels', value: String(fuelSummary.refuels), icon: Droplets, color: '#d97706' },
                { label: 'Theft', value: String(displayedTheftCount), icon: AlertTriangle, color: displayedTheftCount > 0 ? '#CC0000' : '#6B7A8D' },
                { label: 'Probes live', value: String(probeLive.length), icon: Gauge, color: '#0d9488' },
              ].map(m => (
                <div key={m.label} style={{
                  padding: '10px 12px', borderRadius: 10,
                  background: 'var(--cd-surface-2)', border: '1px solid var(--cd-border)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <m.icon size={12} color={m.color} />
                    <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--cd-text-muted)' }}>{m.label}</span>
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: m.color, fontFamily: 'var(--cd-font-display)' }}>{m.value}</div>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--cd-border)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--cd-text-muted)', marginBottom: 8 }}>
                Theft detail
              </div>
              {theftEvents.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--cd-text-muted)', padding: '8px 0' }}>
                  No suspected theft today
                </div>
              ) : (
                theftEvents.slice(0, 6).map((d, i) => {
                  const when = d.startTime || d.timestamp;
                  const timeLabel = when
                    ? new Date(when).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    : '—';
                  return (
                    <div
                      key={`${d.assetId}-${d.timestamp}-${i}`}
                      style={{
                        padding: '10px 12px', marginBottom: 8, borderRadius: 10,
                        border: '1px solid rgba(204,0,0,0.28)',
                        background: 'rgba(204,0,0,0.06)',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                        <span style={{ fontWeight: 700, fontSize: 12, color: 'var(--cd-text)' }}>{d.regNo}</span>
                        <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: '#CC0000' }}>
                          Suspected
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--cd-text)' }}>
                        <strong style={{ color: '#CC0000' }}>−{Math.round(d.deltaLiters)} L</strong>
                        {' '}{Math.round(d.beforeLevel)} → {Math.round(d.afterLevel)} L
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--cd-text-muted)', marginTop: 3 }}>
                        {timeLabel} · {d.durationMinutes ?? '—'} min · {QUARRY_SITE_LABELS[d.zone as QuarrySiteKey] || d.zone}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div style={{ marginTop: 18 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--cd-text-muted)', marginBottom: 10 }}>
                By quarry
              </div>
              {QUARRY_SITE_KEYS.map(zone => {
                const row = fuelByZone[zone];
                const color = fuelZoneColor(zone);
                const pct = Math.round((row.liters / maxZoneFuel) * 100);
                return (
                  <div key={zone} style={{ marginBottom: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 5 }}>
                      <span style={{ fontWeight: 600, color: 'var(--cd-text)' }}>{QUARRY_SITE_LABELS[zone]}</span>
                      <span style={{ color: 'var(--cd-text-muted)' }}>
                        {fuelLoading && row.liters <= 0 ? '…' : `${Math.round(row.liters).toLocaleString()} L`}
                      </span>
                    </div>
                    <div style={{ height: 7, background: 'var(--cd-border)', borderRadius: 99, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 99 }} />
                    </div>
                  </div>
                );
              })}
            </div>

            {lowFuel.length > 0 && (
              <div style={{ marginTop: 8, paddingTop: 14, borderTop: '1px solid var(--cd-border)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#CC0000', marginBottom: 8 }}>
                  Low probe level
                </div>
                {lowFuel.map(p => (
                  <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
                    <span style={{ fontWeight: 600, color: 'var(--cd-text)' }}>{p.regNo}</span>
                    <span style={{ color: '#CC0000', fontWeight: 700 }}>{Math.round(p.level)} L</span>
                  </div>
                ))}
              </div>
            )}

            <Link
              to="/fuel/consumption?period=day"
              style={{
                display: 'block', marginTop: 16, textAlign: 'center', padding: '9px 12px',
                borderRadius: 8, border: '1px solid rgba(13,148,136,0.35)',
                background: 'rgba(13,148,136,0.08)', color: '#0d9488',
                fontSize: 12, fontWeight: 600, textDecoration: 'none',
              }}
            >
              View full fuel consumption
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
