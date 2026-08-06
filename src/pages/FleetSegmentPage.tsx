import { useState, useMemo } from 'react';
import {
  Truck, Navigation, Clock, MapPin, Activity,
  TrendingUp, TrendingDown, Minus, Route, LayoutGrid, Table,
  Gauge, OctagonAlert, Zap, CornerDownRight,
} from 'lucide-react';
import { useFleet } from '../context/FleetContext';
import type { Vehicle, LogEntry } from '../context/FleetContext';
import { displayDriverName } from '../lib/driverUtils';
import { scoreFromEvents, scoreBandColor, scoreBandLabel } from '../lib/fleetSafetyScore';
import {
  FLEET_SEGMENTS,
  filterVehiclesBySegment,
  type FleetSegmentId,
} from '../lib/fleetSegments';

type StatusFilter = 'All' | 'Moving' | 'Idle' | 'Stationary' | 'Parked' | 'Inactive';

interface Props {
  segment: FleetSegmentId;
}

// ── KPI Card ────────────────────────────────────────────────────────────────

function StatCard({
  label, value, sub, color, icon: Icon, active, onClick, tooltip,
}: {
  label: string; value: string | number; sub?: string; color: string;
  icon: React.ElementType; active?: boolean; onClick?: () => void; tooltip?: string;
}) {
  return (
    <button
      title={tooltip}
      onClick={onClick}
      className="bpl-card"
      style={{
        padding: '12px 14px', cursor: onClick ? 'pointer' : 'default', textAlign: 'left',
        borderTopColor: color, borderTopWidth: 3,
        background: active ? `${color}10` : undefined,
        outline: active ? `1.5px solid ${color}40` : 'none',
        transition: 'all 0.15s ease',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
        <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--cd-text-muted)' }}>
          {label}
        </span>
        <Icon size={13} style={{ color, opacity: 0.6 }} />
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, color, lineHeight: 1, fontFamily: 'var(--cd-font-display)' }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 10, color: 'var(--cd-text-muted)', marginTop: 5 }}>{sub}</div>}
    </button>
  );
}

// ── Safety Score ─────────────────────────────────────────────────────────────

function SegmentSafetyScore({
  events, vehicleCount, title,
}: {
  events: LogEntry[]; vehicleCount: number; title: string;
}) {
  const { scoreConfig } = useFleet();
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const sixtyDaysAgo = Date.now() - 60 * 24 * 60 * 60 * 1000;

  const recent = events.filter(e => new Date(e.eventTime || e.timestamp).getTime() >= thirtyDaysAgo);
  const prev   = events.filter(e => { const t = new Date(e.eventTime || e.timestamp).getTime(); return t >= sixtyDaysAgo && t < thirtyDaysAgo; });
  const score  = scoreFromEvents(recent, vehicleCount, scoreConfig);
  const delta  = score - scoreFromEvents(prev, vehicleCount, scoreConfig);

  const color = scoreBandColor(score, scoreConfig);
  const label = scoreBandLabel(score, scoreConfig);

  return (
    <div className="bpl-card" style={{ padding: '20px 22px' }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--cd-text-muted)', marginBottom: 14 }}>
        {title} Safety Score
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
        <div style={{ position: 'relative', width: 72, height: 72, flexShrink: 0 }}>
          <svg width="72" height="72" viewBox="0 0 72 72" style={{ transform: 'rotate(-90deg)' }}>
            <circle cx="36" cy="36" r="30" fill="none" stroke="var(--cd-border)" strokeWidth="6" />
            <circle cx="36" cy="36" r="30" fill="none" stroke={color} strokeWidth="6"
              strokeDasharray={`${2 * Math.PI * 30}`}
              strokeDashoffset={`${2 * Math.PI * 30 * (1 - score / 100)}`}
              strokeLinecap="round" style={{ transition: 'stroke-dashoffset 0.6s ease' }} />
          </svg>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 18, fontWeight: 700, color, fontFamily: 'var(--cd-font-display)', lineHeight: 1 }}>{score}</span>
            <span style={{ fontSize: 9, color: 'var(--cd-text-muted)', fontWeight: 600 }}>/100</span>
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color, fontFamily: 'var(--cd-font-display)', marginBottom: 3 }}>{label}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, marginBottom: 8 }}>
            {delta > 0
              ? <><TrendingUp size={12} color="#16a34a" /><span style={{ color: '#16a34a', fontWeight: 600 }}>+{delta} pts vs last month</span></>
              : delta < 0
              ? <><TrendingDown size={12} color="#CC0000" /><span style={{ color: '#CC0000', fontWeight: 600 }}>{delta} pts vs last month</span></>
              : <><Minus size={12} color="var(--cd-text-muted)" /><span style={{ color: 'var(--cd-text-muted)' }}>No change vs last month</span></>}
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--cd-text)', fontFamily: 'var(--cd-font-display)', lineHeight: 1 }}>{recent.length}</div>
              <div style={{ fontSize: 10, color: 'var(--cd-text-muted)', marginTop: 2 }}>incidents / 30d</div>
            </div>
            <div style={{ width: 1, background: 'var(--cd-border)' }} />
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--cd-text)', fontFamily: 'var(--cd-font-display)', lineHeight: 1 }}>
                {vehicleCount > 0 ? ((recent.length / vehicleCount) * 100).toFixed(1) : '0.0'}
              </div>
              <div style={{ fontSize: 10, color: 'var(--cd-text-muted)', marginTop: 2 }}>per 100 vehicles</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Zone Breakdown ────────────────────────────────────────────────────────────

function ZoneBreakdown({ vehicles }: { vehicles: Vehicle[] }) {
  const zones: Record<string, Vehicle[]> = {};
  vehicles.forEach(v => {
    const z = v.zone || 'Unknown';
    if (!zones[z]) zones[z] = [];
    zones[z].push(v);
  });

  const colors = ['#0078D4', '#7C3AED', '#0d9488', '#c2410c'];
  const total = Math.max(vehicles.length, 1);

  return (
    <div className="bpl-card" style={{ padding: '18px 20px' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--cd-text)', fontFamily: 'var(--cd-font-display)', marginBottom: 14 }}>
        By Zone
      </div>
      {Object.entries(zones).length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--cd-text-muted)' }}>No assets in this segment yet</div>
      ) : Object.entries(zones).map(([zone, list], i) => {
        const moving = list.filter(v => v.status === 'Moving').length;
        const pct = Math.round((list.length / total) * 100);
        const color = colors[i % colors.length];
        return (
          <div key={zone} style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, fontSize: 12 }}>
              <span style={{ fontWeight: 600, color: 'var(--cd-text)' }}>{zone}</span>
              <span style={{ color: 'var(--cd-text-muted)' }}>{list.length} assets · <span style={{ color: '#16a34a', fontWeight: 600 }}>{moving} moving</span></span>
            </div>
            <div style={{ height: 6, background: 'var(--cd-border)', borderRadius: 99, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 99, transition: 'width 0.4s ease' }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Recent Incidents ──────────────────────────────────────────────────────────

function SegmentIncidents({ events }: { events: LogEntry[] }) {
  const visible = events.filter(e => e.type !== 'panic').slice(0, 8);
  return (
    <div className="bpl-card">
      <div className="bpl-card-header">
        <span className="bpl-card-title">Recent Incidents</span>
        <span style={{ fontSize: 11, color: 'var(--cd-text-muted)' }}>{events.length} total</span>
      </div>
      {visible.length === 0 ? (
        <div style={{ padding: '20px', textAlign: 'center', color: 'var(--cd-text-muted)', fontSize: 13 }}>No incidents recorded</div>
      ) : visible.map((e, i) => (
        <div key={i} style={{
          padding: '11px 20px',
          borderBottom: i < visible.length - 1 ? '1px solid var(--cd-border)' : 'none',
          display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 10, alignItems: 'center',
        }}>
          <div style={{
            width: 7, height: 7, borderRadius: '50%',
            background: e.label === 'Harsh Braking' ? '#CC0000' : '#d97706',
          }} />
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--cd-text)' }}>{e.label || 'Unknown'}{displayDriverName(e.driverName) !== '—' ? ` — ${displayDriverName(e.driverName)}` : ''}</div>
            <div style={{ fontSize: 11, color: 'var(--cd-text-muted)' }}>{e.regNo || e.assetId} · {e.address || 'Location unknown'}</div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--cd-text-muted)', flexShrink: 0 }}>
            {e.eventTime ? new Date(e.eventTime).toLocaleTimeString('en-GB', { timeZone: 'Africa/Lagos', hour: '2-digit', minute: '2-digit' }) : '—'}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Incident Breakdown ────────────────────────────────────────────────────────

const BREAKDOWN_TYPES = [
  { key: 'overspeed', label: 'Overspeeding', short: 'Speed', color: '#d97706', icon: Gauge, match: (e: LogEntry) => !!e.label?.includes('Overspeed') },
  { key: 'brake', label: 'Harsh Braking', short: 'Brake', color: '#CC0000', icon: OctagonAlert, match: (e: LogEntry) => e.label === 'Harsh Braking' },
  { key: 'accel', label: 'Harsh Accel.', short: 'Accel', color: '#c27803', icon: Zap, match: (e: LogEntry) => e.label === 'Harsh Acceleration' },
  { key: 'corner', label: 'Harsh Cornering', short: 'Corner', color: '#0d9488', icon: CornerDownRight, match: (e: LogEntry) => e.type !== 'panic' && e.label === 'Harsh Cornering' },
] as const;

function SegmentIncidentBreakdown({ events, emptyLabel }: { events: LogEntry[]; emptyLabel: string }) {
  const { rows, total } = useMemo(() => {
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const recent = events.filter(e => new Date(e.eventTime || e.timestamp).getTime() >= thirtyDaysAgo);
    const counted = BREAKDOWN_TYPES.map(t => ({
      ...t,
      n: recent.filter(t.match).length,
    })).sort((a, b) => b.n - a.n);
    return { rows: counted, total: counted.reduce((s, r) => s + r.n, 0) };
  }, [events]);

  const max = Math.max(...rows.map(r => r.n), 1);
  const lead = rows[0];

  return (
    <div className="bpl-card" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 100 }}>
      <div style={{
        padding: '16px 18px 14px',
        borderBottom: '1px solid var(--cd-border)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12,
      }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--cd-text-muted)', marginBottom: 4 }}>
            Incident Breakdown
          </div>
          <div style={{ fontSize: 11, color: 'var(--cd-text-muted)' }}>Last 30 days</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1, color: 'var(--cd-text)', fontFamily: 'var(--cd-font-display)' }}>
            {total}
          </div>
          <div style={{ fontSize: 10, color: 'var(--cd-text-muted)', marginTop: 3, fontWeight: 600 }}>events</div>
        </div>
      </div>

      {total === 0 ? (
        <div style={{ padding: '28px 18px', textAlign: 'center', color: 'var(--cd-text-muted)', fontSize: 13 }}>
          No {emptyLabel} incidents in this window
        </div>
      ) : (
        <div style={{ padding: '14px 18px 16px', display: 'flex', flexDirection: 'column', gap: 14, flex: 1 }}>
          {/* Mix strip */}
          <div>
            <div style={{ display: 'flex', height: 10, borderRadius: 6, overflow: 'hidden', background: 'var(--cd-border)' }}>
              {rows.filter(r => r.n > 0).map(r => (
                <div
                  key={r.key}
                  title={`${r.label}: ${r.n}`}
                  style={{
                    width: `${(r.n / total) * 100}%`,
                    background: r.color,
                    minWidth: r.n > 0 ? 4 : 0,
                  }}
                />
              ))}
            </div>
            {lead && lead.n > 0 && (
              <div style={{ marginTop: 8, fontSize: 11, color: 'var(--cd-text-muted)' }}>
                Leading type{' '}
                <span style={{ color: lead.color, fontWeight: 700 }}>{lead.label}</span>
                {' · '}
                {Math.round((lead.n / total) * 100)}% of segment incidents
              </div>
            )}
          </div>

          {/* Ranked rows */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {rows.map(r => {
              const Icon = r.icon;
              const pct = total > 0 ? Math.round((r.n / total) * 100) : 0;
              return (
                <div key={r.key} style={{ display: 'grid', gridTemplateColumns: '28px 1fr auto', gap: 10, alignItems: 'center' }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: 8,
                    background: `${r.color}14`, color: r.color,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Icon size={14} strokeWidth={2.25} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 5 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--cd-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {r.label}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--cd-text-muted)', fontWeight: 600, flexShrink: 0 }}>
                        {pct}%
                      </span>
                    </div>
                    <div style={{ height: 4, background: 'var(--cd-border)', borderRadius: 99, overflow: 'hidden' }}>
                      <div style={{
                        height: '100%',
                        width: `${(r.n / max) * 100}%`,
                        background: r.color,
                        borderRadius: 99,
                        transition: 'width 0.35s ease',
                        opacity: r.n === 0 ? 0.35 : 1,
                      }} />
                    </div>
                  </div>
                  <div style={{
                    minWidth: 36, textAlign: 'right',
                    fontSize: 18, fontWeight: 700, lineHeight: 1,
                    color: r.n > 0 ? r.color : 'var(--cd-text-muted)',
                    fontFamily: 'var(--cd-font-display)',
                  }}>
                    {r.n}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Vehicle Table ─────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  Moving: '#16a34a', Idle: '#d97706', 'Excessive Idle': '#CC0000',
  Stationary: '#0d9488', Parked: '#7C3AED', Offline: '#6B7A8D', Inactive: '#6878A0',
};

function SegmentTable({
  vehicles, statusFilter, fleetLabel,
}: {
  vehicles: Vehicle[]; statusFilter: StatusFilter; fleetLabel: string;
}) {
  const filtered = statusFilter === 'All' ? vehicles : vehicles.filter(v =>
    statusFilter === 'Inactive' ? (v.status === 'Inactive' || v.status === 'Offline') : v.status === statusFilter
  );

  return (
    <div className="bpl-card" style={{ overflow: 'hidden' }}>
      <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--cd-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--cd-text)', fontFamily: 'var(--cd-font-display)' }}>
          {fleetLabel} {statusFilter !== 'All' ? `— ${statusFilter}` : ''}
        </span>
        <span style={{ fontSize: 11, color: 'var(--cd-text-muted)' }}>{filtered.length} vehicles</span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--cd-surface-2)' }}>
              {['Reg No', 'Asset Name', 'Zone', 'Status', 'Speed', 'Location'].map(h => (
                <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--cd-text-muted)', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: 32, textAlign: 'center', color: 'var(--cd-text-muted)' }}>No vehicles match this filter</td></tr>
            ) : filtered.map((v, i) => {
              const color = STATUS_COLOR[v.status] ?? '#6B7A8D';
              return (
                <tr key={v.id} style={{ borderTop: '1px solid var(--cd-border)', background: i % 2 === 0 ? 'transparent' : 'var(--cd-surface-2)' }}>
                  <td style={{ padding: '10px 16px', fontWeight: 700, color: 'var(--cd-text)', fontFamily: 'var(--cd-font-display)', whiteSpace: 'nowrap' }}>{v.regNo}</td>
                  <td style={{ padding: '10px 16px', color: 'var(--cd-text-muted)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.assetName}</td>
                  <td style={{ padding: '10px 16px', color: 'var(--cd-text-muted)', whiteSpace: 'nowrap' }}>{v.zone}</td>
                  <td style={{ padding: '10px 16px' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 99, background: `${color}18`, color }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', display: 'inline-block' }} />
                      {v.status}
                    </span>
                  </td>
                  <td style={{ padding: '10px 16px', color: 'var(--cd-text-muted)', textAlign: 'right' }}>
                    {v.position?.speed != null && v.position.speed > 0 ? `${Math.round(v.position.speed)} km/h` : '—'}
                  </td>
                  <td style={{ padding: '10px 16px', color: 'var(--cd-text-muted)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {v.position?.address || '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function FleetSegmentPage({ segment }: Props) {
  const def = FLEET_SEGMENTS[segment];
  const { vehicles, events, driverDistance } = useFleet();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All');
  const [viewMode, setViewMode] = useState<'table' | 'grouped'>('table');

  const segmentVehicles = filterVehiclesBySegment(vehicles, segment);
  const ids = new Set(segmentVehicles.map(v => v.id));
  const regNos = new Set(segmentVehicles.map(v => v.regNo));

  const segmentEvents = events.filter(e => ids.has(e.assetId?.toString() || '') || regNos.has(e.regNo || ''));

  const distanceAssets = (driverDistance?.assets || []).filter(a => ids.has(a.assetId));
  const distanceKm = distanceAssets.reduce((sum, a) => sum + a.totalDistanceKm, 0);

  const total   = segmentVehicles.length;
  const moving  = segmentVehicles.filter(v => v.status === 'Moving').length;
  const idle    = segmentVehicles.filter(v => v.status === 'Idle' || v.status === 'Excessive Idle').length;
  const parked  = segmentVehicles.filter(v => v.status === 'Parked' || v.status === 'Stationary').length;
  const offline = segmentVehicles.filter(v => v.status === 'Inactive' || v.status === 'Offline').length;

  const stats = [
    { label: def.totalLabel, value: total,   color: def.color, icon: Truck,       filter: 'All' as StatusFilter,      tooltip: `All ${def.title} assets` },
    { label: 'Moving',         value: moving,  color: '#16a34a', icon: Navigation,  filter: 'Moving' as StatusFilter,   tooltip: 'Currently on road above 5 km/h' },
    { label: 'Idle',           value: idle,    color: '#d97706', icon: Clock,       filter: 'Idle' as StatusFilter,     tooltip: 'Engine on, not moving' },
    { label: 'Parked',         value: parked,  color: '#7C3AED', icon: MapPin,      filter: 'Parked' as StatusFilter,   tooltip: 'Stationary or parked' },
    { label: 'Temp Inactive',  value: offline, color: '#6B7A8D', icon: Activity,    filter: 'Inactive' as StatusFilter, tooltip: 'Offline or inactive 24h+' },
  ];

  return (
    <div>
      <div className="bpl-page-header">
        <h1 className="bpl-page-title">{def.title}</h1>
        <p className="bpl-page-subtitle">{def.subtitle} — {total} assets tracked</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 14, marginBottom: 20 }}>
        <SegmentSafetyScore events={segmentEvents} vehicleCount={total} title={def.title} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
            {stats.map(s => (
              <StatCard
                key={s.label} label={s.label} value={s.value}
                color={s.color} icon={s.icon} tooltip={s.tooltip}
                active={statusFilter === s.filter}
                onClick={() => setStatusFilter(s.filter)}
                sub={s.filter !== 'All' && total > 0 ? `${Math.round((s.value / total) * 100)}% of fleet` : 'total assets'}
              />
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
            <StatCard label="Distance Today" value={`${distanceKm.toFixed(0)} km`} color={def.color} icon={Route}
              sub="Segment fleet total" />
            <ZoneBreakdown vehicles={segmentVehicles} />
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(280px, 0.9fr)', gap: 14, marginBottom: 20, alignItems: 'stretch' }}>
        <SegmentIncidents events={segmentEvents} />
        <SegmentIncidentBreakdown events={segmentEvents} emptyLabel={def.title.toLowerCase()} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['All', 'Moving', 'Idle', 'Parked', 'Inactive'] as StatusFilter[]).map(f => (
            <button key={f} onClick={() => setStatusFilter(f)} className="bpl-btn-secondary"
              style={{
                padding: '5px 12px', fontSize: 12,
                background: statusFilter === f ? 'var(--bpl-blue-soft)' : undefined,
                borderColor: statusFilter === f ? 'var(--bpl-blue)' : undefined,
                color: statusFilter === f ? 'var(--bpl-blue)' : undefined,
              }}>
              {f}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['table', 'grouped'] as const).map(v => (
            <button key={v} onClick={() => setViewMode(v)} className="bpl-btn-secondary"
              style={{
                padding: '5px 12px', fontSize: 12,
                background: viewMode === v ? 'var(--bpl-blue-soft)' : undefined,
                borderColor: viewMode === v ? 'var(--bpl-blue)' : undefined,
                color: viewMode === v ? 'var(--bpl-blue)' : undefined,
              }}>
              {v === 'table' ? <><Table size={12} /> Table</> : <><LayoutGrid size={12} /> Grouped</>}
            </button>
          ))}
        </div>
      </div>

      {viewMode === 'table' ? (
        <SegmentTable vehicles={segmentVehicles} statusFilter={statusFilter} fleetLabel={`${def.title} Fleet`} />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
          {Object.entries(
            segmentVehicles.reduce((acc, v) => {
              const z = v.zone || 'Unknown'; if (!acc[z]) acc[z] = []; acc[z].push(v); return acc;
            }, {} as Record<string, Vehicle[]>)
          ).sort(([a], [b]) => a.localeCompare(b)).map(([zone, zvehicles]) => {
            const filtered = statusFilter === 'All' ? zvehicles : zvehicles.filter(v =>
              statusFilter === 'Inactive' ? (v.status === 'Inactive' || v.status === 'Offline') : v.status === statusFilter
            );
            return (
              <div key={zone} className="bpl-card" style={{ overflow: 'hidden' }}>
                <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--cd-border)', display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--cd-text)', fontFamily: 'var(--cd-font-display)' }}>{zone}</span>
                  <span style={{ fontSize: 12, color: 'var(--cd-text-muted)' }}>{filtered.length} / {zvehicles.length}</span>
                </div>
                {filtered.slice(0, 12).map((v, i) => {
                  const color = STATUS_COLOR[v.status] ?? '#6B7A8D';
                  return (
                    <div key={v.id} style={{ padding: '9px 18px', borderTop: i === 0 ? 'none' : '1px solid var(--cd-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--cd-text)', fontFamily: 'var(--cd-font-display)' }}>{v.regNo}</div>
                        <div style={{ fontSize: 11, color: 'var(--cd-text-muted)', marginTop: 1 }}>{v.assetName?.trim()}</div>
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 99, background: `${color}18`, color }}>{v.status}</span>
                    </div>
                  );
                })}
                {filtered.length > 12 && (
                  <div style={{ padding: '8px 18px', fontSize: 11, color: 'var(--cd-text-muted)', borderTop: '1px solid var(--cd-border)' }}>
                    +{filtered.length - 12} more
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
