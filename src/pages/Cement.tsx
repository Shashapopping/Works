import { useMemo, useState, type CSSProperties } from 'react';
import {
  Truck, MapPin, TrendingUp, Navigation, Info,
} from 'lucide-react';
import { useFleet } from '../context/FleetContext';
import { KpiCard } from '../components/KpiCard';
import SegmentPeriodBar from '../components/SegmentPeriodBar';
import PageControls from '../components/PageControls';
import { useSegmentPeriod } from '../hooks/useDriverDistancePeriod';
import { useClientPagination } from '../hooks/useClientPagination';
import {
  segmentVehicles, segmentTripAssets, utilizationPct, cementCorridor,
  groupByZone, locationLabel, STATUS_COLOR,
} from '../lib/segmentMetrics';
import { SkelValue, SkelTable } from '../components/data/DataBusy';

const PAGE_SIZE = 20;

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
  const { vehicles, scopedAssetIds, siteFilterActive } = useFleet();
  const {
    period, setPeriod, customRange, setCustomRange,
    assets: periodAssets, loading: distanceLoading, label: periodLabel,
  } = useSegmentPeriod('today', {
    assetIds: siteFilterActive ? scopedAssetIds : [],
    enabled: !siteFilterActive || scopedAssetIds.length > 0,
  });
  const fleet = useMemo(() => segmentVehicles(vehicles, 'cement'), [vehicles]);
  const assets = useMemo(() => segmentTripAssets(fleet, periodAssets), [fleet, periodAssets]);
  const [selectedZone, setSelectedZone] = useState<string | null>(null);

  const util = utilizationPct(fleet);
  const distanceKm = Math.round(assets.reduce((s, a) => s + a.totalDistanceKm, 0));

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

  const kmByAsset = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of assets) map.set(String(a.assetId), a.totalDistanceKm);
    return map;
  }, [assets]);

  const zones = useMemo(() => groupByZone(fleet), [fleet]);

  const leaderRows = useMemo(() => {
    const rows = fleet.map(v => ({
      assetId: String(v.id),
      regNo: v.regNo || '—',
      zone: (v.zone || 'Unknown').trim(),
      distanceKm: kmByAsset.get(String(v.id)) ?? 0,
      transporter: v.transporter || v.site || '—',
      status: v.status,
      location: locationLabel(v),
    })).sort((a, b) => b.distanceKm - a.distanceKm);
    if (!selectedZone) return rows;
    return rows.filter(r => r.zone === selectedZone);
  }, [fleet, kmByAsset, selectedZone]);

  const pagination = useClientPagination(leaderRows, PAGE_SIZE, selectedZone ?? 'all');

  return (
    <div>
      <div className="bpl-page-header bpl-page-header-row">
        <div>
          <h1 className="bpl-page-title">Cement Distribution</h1>
          <p className="bpl-page-subtitle">
            North, East & West corridors — fleet utilization, turnaround, and distance by zone.
          </p>
        </div>
        <SegmentPeriodBar
          period={period}
          customRange={customRange}
          onPeriod={setPeriod}
          onCustomRange={setCustomRange}
        />
      </div>

      <div className="bpl-kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
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

      <div className="bpl-card" style={{ padding: 20, marginBottom: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--cd-text)', marginBottom: 4, fontFamily: 'var(--cd-font-display)' }}>
          Corridor Breakdown
        </div>
        <div style={{ fontSize: 11, color: 'var(--cd-text-muted)', marginBottom: 16 }}>Assets and distance by distribution corridor</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '4px 28px' }}>
          {corridors.map(([name, data]) => (
            <div key={name} style={{ marginBottom: 10 }}>
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
      </div>

      <div className="bpl-card" style={{ overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px 10px', borderBottom: '1px solid var(--cd-border)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--cd-text)', fontFamily: 'var(--cd-font-display)' }}>Distance Leaders</div>
              <div style={{ fontSize: 11, color: 'var(--cd-text-muted)', marginTop: 2 }}>
                {selectedZone ? selectedZone : 'All zones'} · highest MiX trip distance {periodLabel} · {PAGE_SIZE} per page
              </div>
            </div>
            <span style={{ fontSize: 11, color: 'var(--cd-text-muted)', whiteSpace: 'nowrap' }}>
              {distanceLoading ? <SkelValue /> : `${leaderRows.length.toLocaleString()} assets`}
            </span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 76, overflowY: 'auto' }}>
            <button
              type="button"
              aria-pressed={!selectedZone}
              onClick={() => setSelectedZone(null)}
              style={zoneChipStyle(!selectedZone)}
            >
              All <strong style={{ color: 'var(--cd-text)' }}>{fleet.length}</strong>
            </button>
            {zones.map(([zone, list]) => {
              const on = selectedZone === zone;
              return (
                <button
                  key={zone}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setSelectedZone(on ? null : zone)}
                  title={zone}
                  style={zoneChipStyle(on)}
                >
                  <span style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{zone}</span>
                  {' '}
                  <strong style={{ color: 'var(--cd-text)' }}>{list.length}</strong>
                </button>
              );
            })}
          </div>
        </div>
        <div className="bpl-table-scroll">
          <table className="bpl-table" style={{ fontSize: 12 }}>
            <thead>
              <tr>
                {['Reg No', 'Zone', 'Distance', 'Transporter', 'Status', 'Location'].map(h => (
                  <th key={h} style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {distanceLoading ? (
                <tr><td colSpan={6} style={{ padding: 12 }}><SkelTable rows={6} /></td></tr>
              ) : pagination.pageRows.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: 24, textAlign: 'center', color: 'var(--cd-text-muted)' }}>
                    {selectedZone ? `No assets in ${selectedZone}` : `No assets ${periodLabel}`}
                  </td>
                </tr>
              ) : pagination.pageRows.map((row, i) => {
                const color = STATUS_COLOR[row.status ?? ''] ?? '#6B7A8D';
                return (
                  <tr key={row.assetId} style={{ background: i % 2 ? 'var(--cd-surface-2)' : undefined }}>
                    <td style={{ padding: '7px 12px', fontWeight: 700, fontFamily: 'var(--cd-font-display)', whiteSpace: 'nowrap' }}>{row.regNo}</td>
                    <td style={{ padding: '7px 12px', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.zone}>
                      {row.zone}
                    </td>
                    <td style={{ padding: '7px 12px', whiteSpace: 'nowrap' }}>
                      {row.distanceKm > 0 ? `${Math.round(row.distanceKm).toLocaleString()} km` : '—'}
                    </td>
                    <td style={{ padding: '7px 12px', color: 'var(--cd-text-muted)', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.transporter}>
                      {row.transporter}
                    </td>
                    <td style={{ padding: '7px 12px' }}>
                      <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 99, background: `${color}18`, color }}>
                        {row.status || '—'}
                      </span>
                    </td>
                    <td style={{ padding: '7px 12px', color: 'var(--cd-text-muted)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.location}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <MapPin size={11} /> {row.location || '—'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {leaderRows.length > 0 && (
          <PageControls
            page={pagination.page}
            pageCount={pagination.pageCount}
            from={pagination.from}
            to={pagination.to}
            total={pagination.total}
            hasPrev={pagination.hasPrev}
            hasNext={pagination.hasNext}
            onPrev={pagination.prev}
            onNext={pagination.next}
            itemLabel="assets"
          />
        )}
      </div>
    </div>
  );
}

function zoneChipStyle(on: boolean): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    fontSize: 11,
    padding: '4px 10px',
    borderRadius: 99,
    cursor: 'pointer',
    background: on ? 'rgba(194,65,12,0.12)' : 'var(--cd-surface-2)',
    border: `1px solid ${on ? 'rgba(194,65,12,0.45)' : 'var(--cd-border)'}`,
    color: on ? 'var(--cd-text)' : 'var(--cd-text-muted)',
    fontWeight: on ? 700 : 500,
  };
}
