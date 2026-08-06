import { useMemo } from 'react';
import {
  Shield, Truck, Gauge, OctagonAlert, Navigation, AlertTriangle,
  TrendingUp, TrendingDown, Minus, Info,
} from 'lucide-react';
import { useFleet } from '../context/FleetContext';
import { displayDriverName } from '../lib/driverUtils';
import { scoreFromEvents, scoreBandColor, scoreBandLabel } from '../lib/fleetSafetyScore';
import { KpiCard } from '../components/KpiCard';
import {
  segmentVehicles, segmentTripAssets, segmentEvents, overspeedCount,
  tankerCorridor, utilizationPct, STATUS_COLOR,
} from '../lib/segmentMetrics';

export default function Tankers() {
  const { vehicles, events, driverDistance, scoreConfig } = useFleet();
  const fleet = useMemo(() => segmentVehicles(vehicles, 'tankers'), [vehicles]);
  const segEvents = useMemo(() => segmentEvents(fleet, events), [fleet, events]);
  const assets = useMemo(() => segmentTripAssets(fleet, driverDistance?.assets ?? []), [fleet, driverDistance]);

  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const sixtyDaysAgo = Date.now() - 60 * 24 * 60 * 60 * 1000;
  const recent = segEvents.filter(e => new Date(e.eventTime || e.timestamp).getTime() >= thirtyDaysAgo);
  const prev = segEvents.filter(e => {
    const t = new Date(e.eventTime || e.timestamp).getTime();
    return t >= sixtyDaysAgo && t < thirtyDaysAgo;
  });
  const score = scoreFromEvents(recent, fleet.length, scoreConfig);
  const delta = score - scoreFromEvents(prev, fleet.length, scoreConfig);
  const scoreColor = scoreBandColor(score, scoreConfig);
  const scoreLabel = scoreBandLabel(score, scoreConfig);

  const util = utilizationPct(fleet);
  const distanceKm = Math.round(assets.reduce((s, a) => s + a.totalDistanceKm, 0));
  const overspeeds = overspeedCount(segEvents, 30);
  const harshBrakes = recent.filter(e => e.label === 'Harsh Braking').length;

  const corridors = useMemo(() => {
    const east: typeof fleet = [];
    const west: typeof fleet = [];
    const other: typeof fleet = [];
    for (const v of fleet) {
      const c = tankerCorridor(v.zone);
      if (c === 'East') east.push(v);
      else if (c === 'West') west.push(v);
      else other.push(v);
    }
    return { east, west, other };
  }, [fleet]);

  const longHaul = useMemo(() =>
    [...assets].sort((a, b) => b.totalDistanceKm - a.totalDistanceKm).slice(0, 10).map(a => ({
      ...a,
      vehicle: fleet.find(f => f.id?.toString() === a.assetId?.toString()),
    })),
  [assets, fleet]);

  const recentIncidents = segEvents.filter(e => e.type !== 'panic').slice(0, 8);

  return (
    <div>
      <div className="bpl-page-header">
        <h1 className="bpl-page-title">Bulk Tankers</h1>
        <p className="bpl-page-subtitle">
          East & West pneumatic bulk cement — long-haul safety, utilization, and corridor performance.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 14, marginBottom: 20 }}>
        <div className="bpl-card" style={{ padding: '22px 24px' }} title="Same Fleet Safety Score engine as Home/Safety, scoped to bulk-tanker assets only. Uses MiX incidents for those vehicles (30d vs prior 30d) and Settings score weights. Not based on trip counts.">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--cd-text-muted)' }}>
              Tanker HSE Score
            </div>
            <span
              title="Same Fleet Safety Score engine as Home/Safety, scoped to bulk-tanker assets only. Uses MiX incidents for those vehicles (30d vs prior 30d) and Settings score weights. Not based on trip counts."
              aria-label="Score explanation"
              style={{
                display: 'inline-flex', width: 14, height: 14, borderRadius: '50%',
                border: '1px solid var(--cd-border)', color: 'var(--cd-text-muted)',
                alignItems: 'center', justifyContent: 'center', cursor: 'help',
              }}
            >
              <Info size={9} strokeWidth={2.5} />
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ position: 'relative', width: 80, height: 80, flexShrink: 0 }}>
              <svg width="80" height="80" viewBox="0 0 80 80" style={{ transform: 'rotate(-90deg)' }}>
                <circle cx="40" cy="40" r="34" fill="none" stroke="var(--cd-border)" strokeWidth="6" />
                <circle cx="40" cy="40" r="34" fill="none" stroke={scoreColor} strokeWidth="6"
                  strokeDasharray={`${2 * Math.PI * 34}`}
                  strokeDashoffset={`${2 * Math.PI * 34 * (1 - score / 100)}`}
                  strokeLinecap="round" />
              </svg>
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontSize: 22, fontWeight: 700, color: scoreColor, fontFamily: 'var(--cd-font-display)', lineHeight: 1 }}>{score}</span>
                <span style={{ fontSize: 9, color: 'var(--cd-text-muted)' }}>/100</span>
              </div>
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: scoreColor, fontFamily: 'var(--cd-font-display)' }}>{scoreLabel}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, marginTop: 4 }}>
                {delta > 0
                  ? <><TrendingUp size={12} color="#16a34a" /><span style={{ color: '#16a34a', fontWeight: 600 }}>+{delta} vs last month</span></>
                  : delta < 0
                  ? <><TrendingDown size={12} color="#CC0000" /><span style={{ color: '#CC0000', fontWeight: 600 }}>{delta} vs last month</span></>
                  : <><Minus size={12} color="var(--cd-text-muted)" /><span style={{ color: 'var(--cd-text-muted)' }}>No change</span></>}
              </div>
              <div style={{ fontSize: 11, color: 'var(--cd-text-muted)', marginTop: 8 }}>
                {recent.length} incidents / 30d · {overspeeds} overspeed
              </div>
            </div>
          </div>
        </div>

        <div className="bpl-kpi-grid" style={{ marginBottom: 0 }}>
          <KpiCard
            label="Utilization"
            value={`${util}%`}
            sub={`${fleet.filter(v => v.status === 'Moving').length} tankers moving`}
            color="#0078D4"
            icon={Truck}
            tip="Share of bulk-tanker vehicles currently Moving. Formula: Moving ÷ tanker fleet size × 100."
          />
          <KpiCard
            label="Fleet Size"
            value={fleet.length}
            sub="East & West bulk tankers"
            color="#0284c7"
            icon={Truck}
            tip="Count of MiX assets whose zone matches Bulk Tankers (East/West pneumatic bulk)."
          />
          <KpiCard
            label="Distance Today"
            value={`${distanceKm.toLocaleString()} km`}
            sub="Long-haul total"
            color="#0369a1"
            icon={Navigation}
            tip="Sum of MiX trip distance today for bulk-tanker assets only."
          />
          <KpiCard
            label="Overspeed (30d)"
            value={overspeeds}
            sub={`${harshBrakes} harsh braking events`}
            color={overspeeds > 5 ? '#CC0000' : '#d97706'}
            icon={Gauge}
            tip="Count of overspeed events on tanker assets in the last 30 days (MiX events filtered to this segment). Sub-line = harsh braking in the same window."
          />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 20 }}>
        {([
          { label: 'East Corridor', list: corridors.east, color: '#0078D4' },
          { label: 'West Corridor', list: corridors.west, color: '#0284c7' },
        ] as const).map(({ label, list, color }) => {
          const corridorAssets = segmentTripAssets(list, driverDistance?.assets ?? []);
          const km = Math.round(corridorAssets.reduce((s, a) => s + a.totalDistanceKm, 0));
          const moving = list.filter(v => v.status === 'Moving').length;
          return (
            <div key={label} className="bpl-card" style={{ padding: 20, borderTop: `3px solid ${color}` }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--cd-text)', marginBottom: 12, fontFamily: 'var(--cd-font-display)' }}>{label}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, textAlign: 'center' }}>
                <div><div style={{ fontSize: 22, fontWeight: 700, color }}>{list.length}</div><div style={{ fontSize: 10, color: 'var(--cd-text-muted)' }}>Tankers</div></div>
                <div><div style={{ fontSize: 22, fontWeight: 700, color: '#16a34a' }}>{moving}</div><div style={{ fontSize: 10, color: 'var(--cd-text-muted)' }}>Moving</div></div>
                <div><div style={{ fontSize: 22, fontWeight: 700, color }}>{km.toLocaleString()}</div><div style={{ fontSize: 10, color: 'var(--cd-text-muted)' }}>km today</div></div>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.2fr) minmax(280px, 0.8fr)', gap: 14 }}>
        <div className="bpl-card" style={{ overflow: 'hidden' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--cd-border)' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--cd-text)', fontFamily: 'var(--cd-font-display)' }}>Long-Haul Leaderboard</div>
            <div style={{ fontSize: 11, color: 'var(--cd-text-muted)', marginTop: 2 }}>Highest distance today — monitor fatigue & overspeed risk</div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: 'var(--cd-surface-2)' }}>
                  {['Reg No', 'Corridor', 'Distance', 'Avg Speed', 'Status'].map(h => (
                    <th key={h} style={{ padding: '9px 14px', textAlign: 'left', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--cd-text-muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {longHaul.length === 0 ? (
                  <tr><td colSpan={5} style={{ padding: 28, textAlign: 'center', color: 'var(--cd-text-muted)' }}>No distance data today</td></tr>
                ) : longHaul.map((row, i) => {
                  const color = STATUS_COLOR[row.vehicle?.status ?? ''] ?? '#6B7A8D';
                  return (
                    <tr key={row.assetId} style={{ borderTop: '1px solid var(--cd-border)', background: i % 2 ? 'var(--cd-surface-2)' : undefined }}>
                      <td style={{ padding: '9px 14px', fontWeight: 700, fontFamily: 'var(--cd-font-display)' }}>{row.regNo}</td>
                      <td style={{ padding: '9px 14px' }}>{tankerCorridor(row.vehicle?.zone)}</td>
                      <td style={{ padding: '9px 14px', fontWeight: 700, color: '#0078D4' }}>{row.totalDistanceKm.toFixed(0)} km</td>
                      <td style={{ padding: '9px 14px' }}>{row.avgSpeedKph != null ? `${Math.round(row.avgSpeedKph)} km/h` : '—'}</td>
                      <td style={{ padding: '9px 14px' }}>
                        <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 99, background: `${color}18`, color }}>
                          {row.vehicle?.status ?? '—'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bpl-card">
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--cd-border)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Shield size={16} color="#CC0000" />
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--cd-text)', fontFamily: 'var(--cd-font-display)' }}>Recent HSE Events</div>
              <div style={{ fontSize: 11, color: 'var(--cd-text-muted)' }}>Bulk tanker incidents — long haul focus</div>
            </div>
          </div>
          {recentIncidents.length === 0 ? (
            <div style={{ padding: 28, textAlign: 'center', color: 'var(--cd-text-muted)', fontSize: 13 }}>No recent incidents</div>
          ) : recentIncidents.map((e, i) => (
            <div key={i} style={{
              padding: '11px 18px', borderBottom: i < recentIncidents.length - 1 ? '1px solid var(--cd-border)' : 'none',
              display: 'flex', gap: 10, alignItems: 'flex-start',
            }}>
              {e.label === 'Harsh Braking' || e.label?.includes('Overspeed')
                ? <OctagonAlert size={14} color="#CC0000" style={{ flexShrink: 0, marginTop: 2 }} />
                : <AlertTriangle size={14} color="#d97706" style={{ flexShrink: 0, marginTop: 2 }} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--cd-text)' }}>
                  {e.label}{displayDriverName(e.driverName) !== '—' ? ` — ${displayDriverName(e.driverName)}` : ''}
                </div>
                <div style={{ fontSize: 11, color: 'var(--cd-text-muted)' }}>{e.regNo} · {e.address || '—'}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
