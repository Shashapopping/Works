import { useMemo } from 'react';
import {
  Truck, Users, MapPin, TrendingUp, Navigation, Info,
} from 'lucide-react';
import { useFleet } from '../context/FleetContext';
import { KpiCard } from '../components/KpiCard';
import SegmentPeriodBar from '../components/SegmentPeriodBar';
import { useSegmentPeriod } from '../hooks/useDriverDistancePeriod';
import {
  segmentVehicles, segmentTripAssets, utilizationPct, cementCorridor,
  isSpotHireVehicle, groupByZone, STATUS_COLOR,
} from '../lib/segmentMetrics';
import { SkelValue, SkelTable } from '../components/data/DataBusy';

function MiniStat({ label, value, color, tip, note }: {
  label: string; value: number; color: string; tip: string; note?: string;
}) {
  return (
    <div className="bpl-card" style={{ padding: 16, textAlign: 'center' }} title={tip}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, marginBottom: 6 }}>
        <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--cd-text-muted)' }}>{label}</div>
        <span title={tip} aria-label={tip} style={{
          display: 'inline-flex', width: 14, height: 14, borderRadius: '50%',
          border: '1px solid var(--cd-border)', color: 'var(--cd-text-muted)',
          alignItems: 'center', justifyContent: 'center', cursor: 'help',
        }}>
          <Info size={9} strokeWidth={2.5} />
        </span>
      </div>
      <div style={{ fontSize: 32, fontWeight: 700, color, fontFamily: 'var(--cd-font-display)' }}>{value}</div>
      {note && <div style={{ fontSize: 10, color: 'var(--cd-text-muted)', marginTop: 4 }}>{note}</div>}
    </div>
  );
}

export default function Cement() {
  const { vehicles } = useFleet();
  const {
    period, setPeriod, customRange, setCustomRange,
    assets: periodAssets, loading: distanceLoading, label: periodLabel,
  } = useSegmentPeriod('today');
  const fleet = useMemo(() => segmentVehicles(vehicles, 'cement'), [vehicles]);
  const assets = useMemo(() => segmentTripAssets(fleet, periodAssets), [fleet, periodAssets]);

  const util = utilizationPct(fleet);
  const distanceKm = Math.round(assets.reduce((s, a) => s + a.totalDistanceKm, 0));
  const spotHire = fleet.filter(isSpotHireVehicle);
  const owned = fleet.length - spotHire.length;
  const spotPct = fleet.length ? Math.round((spotHire.length / fleet.length) * 100) : 0;

  const moving = fleet.filter(v => v.status === 'Moving').length;
  const idle = fleet.filter(v => v.status === 'Idle' || v.status === 'Stationary' || v.status === 'Excessive Idle').length;
  const parked = fleet.filter(v => v.status === 'Parked').length;

  const corridors = useMemo(() => {
    const map: Record<string, { vehicles: typeof fleet; km: number; moving: number }> = {};
    for (const v of fleet) {
      const c = cementCorridor(v.zone);
      if (!map[c]) map[c] = { vehicles: [], km: 0, moving: 0 };
      map[c].vehicles.push(v);
      if (v.status === 'Moving') map[c].moving++;
    }
    for (const a of assets) {
      const v = fleet.find(f => f.id?.toString() === a.assetId?.toString());
      const c = cementCorridor(v?.zone);
      if (map[c]) {
        map[c].km += a.totalDistanceKm;
      }
    }
    return Object.entries(map).sort((a, b) => b[1].vehicles.length - a[1].vehicles.length);
  }, [fleet, assets]);

  const topDistance = useMemo(() =>
    [...assets]
      .sort((a, b) => b.totalDistanceKm - a.totalDistanceKm)
      .slice(0, 12)
      .map(a => ({
        ...a,
        vehicle: fleet.find(f => f.id?.toString() === a.assetId?.toString()),
      })),
  [assets, fleet]);

  const zones = useMemo(() => groupByZone(fleet), [fleet]);

  return (
    <div>
      <div className="bpl-page-header bpl-page-header-row">
        <div>
          <h1 className="bpl-page-title">Cement Distribution</h1>
          <p className="bpl-page-subtitle">
            North, East & West corridors — fleet utilization, turnaround, and owned vs spot-hire mix.
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
          label="Fleet Utilization"
          value={`${util}%`}
          sub={`${moving} of ${fleet.length - parked} deployable moving`}
          color={util > 40 ? '#16a34a' : '#c2410c'}
          icon={TrendingUp}
          tip="Share of cement-segment vehicles currently Moving. Deployable = segment fleet minus Parked. Formula: Moving ÷ (Total − Parked) × 100."
        />
        <KpiCard
          label="Fleet Size"
          value={fleet.length}
          sub={distanceLoading ? 'Loading distance…' : `${assets.length} with distance ${periodLabel}`}
          color="#c2410c"
          icon={Truck}
          tip={`Count of MiX assets in the Cement segment (zones matching cement corridors — excludes Bulk Tankers, Quarry, and Ready Mix). Sub-line = how many of those have distance recorded ${periodLabel}.`}
        />
        <KpiCard
          label={`Distance ${periodLabel}`}
          value={distanceLoading ? <SkelValue wide /> : `${distanceKm.toLocaleString()} km`}
          sub="Segment fleet total"
          color="#ea580c"
          icon={Navigation}
          tip={`Sum of MiX trip distance ${periodLabel} for cement-segment assets only.`}
        />
        <KpiCard
          label="Spot Hire"
          value={`${spotPct}%`}
          sub={`${spotHire.length} hire · ${owned} owned/contract`}
          color="#d97706"
          icon={Users}
          tip={`Counted as spot hire if MiX zone contains "SPOT HIRE", or site contains "SPOT" / "NON LH". Percent = hire ÷ cement fleet × 100 (rounded). Today: ${spotHire.length} hire ÷ ${fleet.length} cement assets = ${spotPct}%. Remaining ${owned} are treated as owned/contract.`}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
        <MiniStat
          label="On Road"
          value={moving}
          color="#16a34a"
          tip="Cement-segment vehicles with live status Moving (speed / engine state from MiX)."
        />
        <MiniStat
          label="Idle / Stationary"
          value={idle}
          color="#d97706"
          tip="Idle + Stationary + Excessive Idle from MiX status — not mapped to a specific plant or loading bay."
        />
        <MiniStat
          label="Parked"
          value={parked}
          color="#7C3AED"
          tip="Cement-segment vehicles with status Parked (excluded from deployable utilization)."
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.2fr) minmax(280px, 0.8fr)', gap: 14, marginBottom: 20 }}>
        <div className="bpl-card" style={{ padding: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--cd-text)', marginBottom: 4, fontFamily: 'var(--cd-font-display)' }}>
            Corridor Breakdown
          </div>
          <div style={{ fontSize: 11, color: 'var(--cd-text-muted)', marginBottom: 16 }}>Assets and distance by distribution corridor</div>
          {corridors.map(([name, data]) => (
            <div key={name} style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 5 }}>
                <span style={{ fontWeight: 700, color: 'var(--cd-text)' }}>{name}</span>
                <span style={{ color: 'var(--cd-text-muted)' }}>
                  {data.vehicles.length} trucks · {distanceLoading ? <SkelValue /> : `${Math.round(data.km).toLocaleString()} km`}
                </span>
              </div>
              <div style={{ height: 8, background: 'var(--cd-border)', borderRadius: 99, overflow: 'hidden', display: 'flex' }}>
                <div style={{ width: `${(data.moving / Math.max(data.vehicles.length, 1)) * 100}%`, background: '#16a34a' }} title="Moving" />
                <div style={{ flex: 1, background: 'rgba(194,65,12,0.35)' }} title="Not moving" />
              </div>
              <div style={{ fontSize: 10, color: 'var(--cd-text-muted)', marginTop: 3 }}>
                {data.moving} moving · {data.vehicles.length - data.moving} not moving
              </div>
            </div>
          ))}
        </div>

        <div className="bpl-card" style={{ padding: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--cd-text)', marginBottom: 14, fontFamily: 'var(--cd-font-display)' }}>
            Owned vs Spot Hire
          </div>
          <div style={{ display: 'flex', height: 12, borderRadius: 6, overflow: 'hidden', marginBottom: 12 }}>
            <div style={{ width: `${100 - spotPct}%`, background: '#c2410c' }} title="Owned/contract" />
            <div style={{ width: `${spotPct}%`, background: '#d97706' }} title="Spot hire" />
          </div>
          <div style={{ fontSize: 12, color: 'var(--cd-text-muted)', lineHeight: 1.55, marginBottom: 16 }}>
            Spot hire spikes cost and reduces visibility. High hire % often signals capacity shortfall on a corridor.
          </div>
          <div style={{ fontSize: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ color: 'var(--cd-text)' }}>Owned / contract fleet</span>
              <strong style={{ color: '#c2410c' }}>{owned}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--cd-text)' }}>Spot hire</span>
              <strong style={{ color: '#d97706' }}>{spotHire.length}</strong>
            </div>
          </div>
        </div>
      </div>

      <div className="bpl-card" style={{ overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--cd-border)' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--cd-text)', fontFamily: 'var(--cd-font-display)' }}>Distance Leaders</div>
          <div style={{ fontSize: 11, color: 'var(--cd-text-muted)', marginTop: 2 }}>
            Highest MiX trip distance {periodLabel} in the cement segment
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'var(--cd-surface-2)' }}>
                {['Reg No', 'Corridor', 'Distance', 'Transporter', 'Status', 'Location'].map(h => (
                  <th key={h} style={{ padding: '9px 14px', textAlign: 'left', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--cd-text-muted)', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {distanceLoading ? (
                <tr><td colSpan={6} style={{ padding: 12 }}><SkelTable rows={6} /></td></tr>
              ) : topDistance.length === 0 ? (
                <tr><td colSpan={6} style={{ padding: 28, textAlign: 'center', color: 'var(--cd-text-muted)' }}>No distance data {periodLabel}</td></tr>
              ) : topDistance.map((row, i) => {
                const color = STATUS_COLOR[row.vehicle?.status ?? ''] ?? '#6B7A8D';
                return (
                  <tr key={row.assetId} style={{
                    borderTop: '1px solid var(--cd-border)',
                    background: i % 2 ? 'var(--cd-surface-2)' : undefined,
                  }}>
                    <td style={{ padding: '9px 14px', fontWeight: 700, fontFamily: 'var(--cd-font-display)' }}>{row.regNo}</td>
                    <td style={{ padding: '9px 14px' }}>{cementCorridor(row.vehicle?.zone)}</td>
                    <td style={{ padding: '9px 14px' }}>{row.totalDistanceKm.toFixed(0)} km</td>
                    <td style={{ padding: '9px 14px', color: 'var(--cd-text-muted)', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {row.vehicle?.site ?? '—'}
                    </td>
                    <td style={{ padding: '9px 14px' }}>
                      <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 99, background: `${color}18`, color }}>
                        {row.vehicle?.status ?? '—'}
                      </span>
                    </td>
                    <td style={{ padding: '9px 14px', color: 'var(--cd-text-muted)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <MapPin size={11} /> {row.vehicle?.position?.address || '—'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bpl-card" style={{ marginTop: 14, padding: 18 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--cd-text)', marginBottom: 10, fontFamily: 'var(--cd-font-display)' }}>All Zones ({zones.length})</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {zones.map(([zone, list]) => (
            <span key={zone} style={{
              fontSize: 11, padding: '4px 10px', borderRadius: 99,
              background: 'var(--cd-surface-2)', border: '1px solid var(--cd-border)', color: 'var(--cd-text-muted)',
            }}>
              {zone} <strong style={{ color: 'var(--cd-text)' }}>{list.length}</strong>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
