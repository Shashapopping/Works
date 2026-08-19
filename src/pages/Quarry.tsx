import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Mountain, Gauge, AlertTriangle, Truck, Navigation, Fuel,
  Droplets, ArrowUpRight, Activity,
} from 'lucide-react';
import { useFleet, type Vehicle } from '../context/FleetContext';
import { KpiCard } from '../components/KpiCard';
import SegmentPeriodBar from '../components/SegmentPeriodBar';
import {
  QUARRY_SITE_KEYS, QUARRY_SITE_LABELS, fuelZoneColor, type QuarrySiteKey,
} from '../components/FuelChart';
import { useFuelConsumption } from '../hooks/useFuelConsumption';
import { useSegmentPeriod } from '../hooks/useDriverDistancePeriod';
import { aggregateMetrics } from '../lib/fuelConsumption';
import { segmentPeriodToFuel } from '../lib/segmentPeriod';
import {
  segmentVehicles, segmentTripAssets, quarrySiteLabel,
  countByStatus, STATUS_COLOR, utilizationPct,
} from '../lib/segmentMetrics';
import { SkelValue, SkelTable } from '../components/data/DataBusy';

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
  const { vehicles } = useFleet();
  const {
    period, setPeriod, customRange, setCustomRange,
    assets: periodAssets, loading: historyLoading, label: periodLabel,
  } = useSegmentPeriod('today');
  const fuelReq = useMemo(() => segmentPeriodToFuel(period, customRange), [period, customRange]);
  const { data: fuelData, loading: fuelLoading } = useFuelConsumption(fuelReq.mode, fuelReq.custom);

  const fleet = useMemo(() => segmentVehicles(vehicles, 'quarry') as QuarryVehicle[], [vehicles]);
  const haulAssets = useMemo(() => segmentTripAssets(fleet, periodAssets), [fleet, periodAssets]);
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
    const out: Record<QuarrySiteKey, { liters: number; distance: number; refuels: number; refillL: number }> = {
      'QUARRY EWEKORO': { liters: 0, distance: 0, refuels: 0, refillL: 0 },
      'QUARRY MFAMOSING': { liters: 0, distance: 0, refuels: 0, refillL: 0 },
    };
    for (const a of quarryFuelRows) {
      const z = (a.zone || '').toUpperCase() as QuarrySiteKey;
      if (!out[z]) continue;
      out[z].liters += a.totalFuelLiters;
      out[z].distance += a.totalDistanceKm;
      out[z].refuels += a.refuelCount;
      out[z].refillL += a.refuelLiters;
    }
    return out;
  }, [quarryFuelRows]);
  const refueledAssets = useMemo(
    () => quarryFuelRows
      .filter(a => a.refuelCount > 0)
      .sort((a, b) => b.refuelLiters - a.refuelLiters || b.refuelCount - a.refuelCount),
    [quarryFuelRows],
  );
  const totalRefillL = refueledAssets.reduce((s, a) => s + a.refuelLiters, 0);
  const fuelPeriodParam = period === 'week' ? 'week' : 'day';

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
      <div className="bpl-page-header bpl-page-header-row">
        <div>
          <h1 className="bpl-page-title">Quarry Haulage</h1>
          <p className="bpl-page-subtitle">
            Ewekoro & Mfamosing — live status plus haul and fuel for the selected period.
          </p>
        </div>
        <SegmentPeriodBar
          period={period}
          customRange={customRange}
          onPeriod={setPeriod}
          onCustomRange={setCustomRange}
        />
      </div>

      <div className="bpl-kpi-grid">
        <KpiCard
          label="Active Haulers"
          value={historyLoading ? <SkelValue /> : activeHaulers}
          sub={`${fleet.length} quarry assets tracked`}
          color="#0d9488"
          icon={Truck}
          tip={`Quarry assets with distance ${periodLabel}. Live fleet size in the sub-line.`}
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
          value={historyLoading ? <SkelValue wide /> : `${distanceKm.toLocaleString()} km`}
          sub={periodLabel}
          color="#059669"
          icon={Mountain}
          tip={`Sum of MiX trip distance ${periodLabel} for quarry assets.`}
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
                {historyLoading ? <SkelValue wide /> : siteKm.toLocaleString()}
                {!historyLoading && (
                  <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--cd-text-muted)', marginLeft: 6 }}>km</span>
                )}
              </div>
              <div style={{ height: 6, background: 'var(--cd-border)', borderRadius: 99, overflow: 'hidden', marginTop: 12 }}>
                <div style={{ height: '100%', width: `${siteUtil}%`, background: color, borderRadius: 99 }} />
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 18px', marginTop: 14, fontSize: 12, color: 'var(--cd-text-muted)' }}>
                <span><strong style={{ color: 'var(--cd-text)' }}>{list.length}</strong> assets</span>
                <span><strong style={{ color: '#16a34a' }}>{siteMoving}</strong> hauling</span>
                <span><strong style={{ color }}>{fuelLoading ? <SkelValue /> : Math.round(fuel.liters).toLocaleString()}</strong> L used on trips</span>
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
              Top assets by km {periodLabel}
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
                {historyLoading ? (
                  <tr><td colSpan={5} style={{ padding: 12 }}><SkelTable rows={6} /></td></tr>
                ) : leaderboard.length === 0 ? (
                  <tr><td colSpan={5} style={{ padding: 28, textAlign: 'center', color: 'var(--cd-text-muted)' }}>
                    No haul distance {periodLabel}
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
                  Fuel {periodLabel}
                </div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--cd-text-muted)', marginTop: 3 }}>
                Trip burn vs tank fills — Ewekoro & Mfamosing
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
              Fuel used on trips
            </div>
            <div style={{ fontSize: 32, fontWeight: 700, color: '#0d9488', fontFamily: 'var(--cd-font-display)', lineHeight: 1.1, marginTop: 4 }}>
              {fuelLoading && fuelSummary.fuel <= 0 ? <SkelValue wide /> : fmtL(fuelSummary.fuel)}
            </div>
            <div style={{ fontSize: 12, color: 'var(--cd-text-muted)', marginTop: 6, lineHeight: 1.45 }}>
              Estimated from probe level at trip start vs end — not tank fill, not live level.
              {fuelSummary.distance > 0
                ? ` ${Math.round(fuelSummary.distance).toLocaleString()} km hauled · ${fmtRatio(fuelSummary.litersPerKm)} L/km.`
                : ` No trip-fuel rows ${periodLabel}.`}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8, marginTop: 16 }}>
              <div
                style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--cd-surface-2)', border: '1px solid var(--cd-border)' }}
                title="Total trip fuel ÷ driving hours across quarry assets this period."
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <Activity size={12} color="#0891b2" />
                  <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--cd-text-muted)' }}>L / hour</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 18, fontWeight: 700, color: '#0891b2', fontFamily: 'var(--cd-font-display)' }}>
                    {fmtRatio(fuelSummary.litersPerHour)}
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--cd-text-muted)' }}>avg L/h</span>
                </div>
                <div style={{ fontSize: 10, color: 'var(--cd-text-muted)', marginTop: 3 }}>While driving</div>
              </div>
              <div
                style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--cd-surface-2)', border: '1px solid var(--cd-border)' }}
                title="Probe-confirmed tank fills this period."
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <Droplets size={12} color="#d97706" />
                  <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--cd-text-muted)' }}>Refuels</span>
                </div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#d97706', fontFamily: 'var(--cd-font-display)' }}>
                  {fuelSummary.refuels}
                </div>
                <div style={{ fontSize: 10, color: 'var(--cd-text-muted)', marginTop: 3 }}>
                  {refueledAssets.length === 0
                    ? 'No fills yet'
                    : `${refueledAssets.length} asset${refueledAssets.length === 1 ? '' : 's'} · ${fmtL(totalRefillL)} in`}
                </div>
              </div>
              <div
                style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--cd-surface-2)', border: '1px solid var(--cd-border)' }}
                title="Assets currently reporting a fuel-probe reading."
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <Gauge size={12} color="#0d9488" />
                  <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--cd-text-muted)' }}>Probes live</span>
                </div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#0d9488', fontFamily: 'var(--cd-font-display)' }}>
                  {probeLive.length}
                </div>
                <div style={{ fontSize: 10, color: 'var(--cd-text-muted)', marginTop: 3 }}>Tanks reporting now</div>
              </div>
            </div>

            <div style={{ marginTop: 18 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--cd-text-muted)' }}>
                Fuel used by quarry
              </div>
              <div style={{ fontSize: 11, color: 'var(--cd-text-muted)', margin: '4px 0 10px', lineHeight: 1.4 }}>
                Same figure as the {fmtL(fuelSummary.fuel)} total above, split by site. Bar length is relative share — not how full the tanks are.
              </div>
              {QUARRY_SITE_KEYS.map(zone => {
                const row = fuelByZone[zone];
                const color = fuelZoneColor(zone);
                const sharePct = fuelSummary.fuel > 0 ? Math.round((row.liters / fuelSummary.fuel) * 100) : 0;
                const barPct = Math.round((row.liters / maxZoneFuel) * 100);
                return (
                  <div key={zone} style={{ marginBottom: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, fontSize: 12, marginBottom: 5 }}>
                      <span style={{ fontWeight: 600, color: 'var(--cd-text)' }}>{QUARRY_SITE_LABELS[zone]}</span>
                      <span style={{ color: 'var(--cd-text-muted)', textAlign: 'right' }}>
                        {fuelLoading && row.liters <= 0 ? <SkelValue /> : (
                          <>
                            <strong style={{ color: 'var(--cd-text)' }}>{Math.round(row.liters).toLocaleString()} L used</strong>
                            {fuelSummary.fuel > 0 && (
                              <span style={{ marginLeft: 6 }}>{sharePct}% of total</span>
                            )}
                          </>
                        )}
                      </span>
                    </div>
                    <div style={{ height: 7, background: 'var(--cd-border)', borderRadius: 99, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${barPct}%`, background: color, borderRadius: 99 }} />
                    </div>
                    {(row.refuels > 0 || row.distance > 0) && (
                      <div style={{ fontSize: 10, color: 'var(--cd-text-muted)', marginTop: 4 }}>
                        {row.distance > 0 ? `${Math.round(row.distance).toLocaleString()} km` : 'No haul km'}
                        {row.refuels > 0 ? ` · ${row.refuels} refill${row.refuels === 1 ? '' : 's'} (${fmtL(row.refillL)} put in)` : ''}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div style={{ marginTop: 8, paddingTop: 14, borderTop: '1px solid var(--cd-border)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--cd-text-muted)', marginBottom: 4 }}>
                Refueled in quarry
              </div>
              <div style={{ fontSize: 11, color: 'var(--cd-text-muted)', marginBottom: 8, lineHeight: 1.4 }}>
                Assets with a probe-confirmed tank fill {periodLabel}. Litres are fuel put in, not fuel used.
              </div>
              {fuelLoading && refueledAssets.length === 0 ? (
                <SkelTable rows={3} />
              ) : refueledAssets.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--cd-text-muted)' }}>No quarry assets refueled in this period.</div>
              ) : (
                refueledAssets.map(a => (
                  <Link
                    key={a.assetId}
                    to={`/fuel/consumption?period=${fuelPeriodParam}&asset=${encodeURIComponent(a.assetId)}&site=${encodeURIComponent(a.zone)}`}
                    style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8,
                      fontSize: 12, marginBottom: 7, textDecoration: 'none', color: 'inherit',
                    }}
                    title="Open fuel consumption for this asset"
                  >
                    <span style={{ minWidth: 0 }}>
                      <span style={{ fontWeight: 700, color: 'var(--cd-text)' }}>{a.regNo}</span>
                      <span style={{ color: 'var(--cd-text-muted)', marginLeft: 6 }}>
                        {QUARRY_SITE_LABELS[a.zone as QuarrySiteKey] || a.zone}
                      </span>
                    </span>
                    <span style={{ color: '#d97706', fontWeight: 700, whiteSpace: 'nowrap' }}>
                      +{Math.round(a.refuelLiters).toLocaleString()} L
                      <span style={{ fontWeight: 500, color: 'var(--cd-text-muted)', marginLeft: 6 }}>
                        {a.refuelCount} fill{a.refuelCount === 1 ? '' : 's'}
                      </span>
                    </span>
                  </Link>
                ))
              )}
            </div>

            {lowFuel.length > 0 && (
              <div style={{ marginTop: 8, paddingTop: 14, borderTop: '1px solid var(--cd-border)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#CC0000', marginBottom: 4 }}>
                  Low fuel in tank now
                </div>
                <div style={{ fontSize: 11, color: 'var(--cd-text-muted)', marginBottom: 8 }}>
                  Live probe reading — not trip burn, not a refill.
                </div>
                {lowFuel.map(p => (
                  <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
                    <span style={{ fontWeight: 600, color: 'var(--cd-text)' }}>{p.regNo}</span>
                    <span style={{ color: '#CC0000', fontWeight: 700 }}>{Math.round(p.level)} L in tank</span>
                  </div>
                ))}
              </div>
            )}

            <Link
              to={`/fuel/consumption?period=${period === 'week' ? 'week' : 'day'}`}
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
