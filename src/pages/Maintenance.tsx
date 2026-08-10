import { useState, useDeferredValue } from 'react';
import { Wrench, Clock, AlertTriangle, Plus, Calendar, Search, ChevronRight, CheckCircle } from 'lucide-react';
import { useFleet } from '../context/FleetContext';
import FeatureGate from '../components/FeatureGate';
import { useClientPagination } from '../hooks/useClientPagination';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import PageControls from '../components/PageControls';

const DEMO_SERVICE: Record<string, { lastService: string; intervalDays: number; tech?: string; inProgress?: boolean; progress?: number }> = {
  'AAB428XC': { lastService: '2025-12-10', intervalDays: 90 },
  'AJG510XA': { lastService: '2026-03-15', intervalDays: 90, inProgress: true, tech: 'Ibrahim O.', progress: 65 },
  'FKY272YF': { lastService: '2026-03-28', intervalDays: 90 },
  'AAB440XC': { lastService: '2026-04-01', intervalDays: 90, inProgress: true, tech: 'Chukwu E.', progress: 30 },
  'KJA881CA': { lastService: '2026-04-20', intervalDays: 90 },
  'MNL334BC': { lastService: '2026-05-01', intervalDays: 90 },
  'ERT102ZZ': { lastService: '2026-05-10', intervalDays: 90 },
  'PLT991QA': { lastService: '2026-05-18', intervalDays: 90 },
};

function daysUntil(lastService: string, intervalDays: number) {
  const next = new Date(lastService);
  next.setDate(next.getDate() + intervalDays);
  return Math.round((next.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function nextDueDate(lastService: string, intervalDays: number) {
  const next = new Date(lastService);
  next.setDate(next.getDate() + intervalDays);
  return next.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function getServiceStatus(reg: string) {
  const record = DEMO_SERVICE[reg];
  if (!record) return { label: 'No Record', color: '#94a3b8', days: null };
  const days = daysUntil(record.lastService, record.intervalDays);
  if (record.inProgress) return { label: 'In Progress', color: '#0078D4', days };
  if (days < 0) return { label: 'Overdue', color: '#e53e3e', days };
  if (days <= 30) return { label: 'Due Soon', color: '#d97706', days };
  return { label: 'On Track', color: '#38a169', days };
}

function opStatusColor(status: string) {
  if (status === 'Moving') return '#38a169';
  if (status === 'Idle' || status === 'Excessive Idle') return '#d97706';
  if (status === 'Parked') return '#7C3AED';
  if (status === 'Offline' || status === 'Inactive') return '#94a3b8';
  return '#94a3b8';
}

type ServiceFilter = 'all' | 'overdue' | 'due-soon' | 'in-progress' | 'on-track' | 'no-record';

export default function Maintenance() {
  const { vehicles } = useFleet();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 200);
  const deferredSearch = useDeferredValue(debouncedSearch);
  const [serviceFilter, setServiceFilter] = useState<ServiceFilter>('all');
  const [scheduleVehicle, setScheduleVehicle] = useState<any>(null);

  const overdueCt = vehicles.filter(v => getServiceStatus(v.regNo).label === 'Overdue').length;
  const dueSoonCt = vehicles.filter(v => getServiceStatus(v.regNo).label === 'Due Soon').length;
  const inProgressCt = vehicles.filter(v => getServiceStatus(v.regNo).label === 'In Progress').length;
  const onTrackCt = vehicles.filter(v => getServiceStatus(v.regNo).label === 'On Track').length;

  const filtered = vehicles.filter(v => {
    const svc = getServiceStatus(v.regNo);
    if (serviceFilter === 'overdue' && svc.label !== 'Overdue') return false;
    if (serviceFilter === 'due-soon' && svc.label !== 'Due Soon') return false;
    if (serviceFilter === 'in-progress' && svc.label !== 'In Progress') return false;
    if (serviceFilter === 'on-track' && svc.label !== 'On Track') return false;
    if (serviceFilter === 'no-record' && svc.label !== 'No Record') return false;
    if (deferredSearch) {
      const s = deferredSearch.toLowerCase();
      return (
        v.regNo?.toLowerCase().includes(s) ||
        v.assetName?.toLowerCase().includes(s) ||
        v.make?.toLowerCase().includes(s) ||
        v.model?.toLowerCase().includes(s) ||
        v.transporter?.toLowerCase().includes(s)
      );
    }
    return true;
  });

  const pagination = useClientPagination(filtered, 50);

  return (
    <FeatureGate featureId="maintenance">
    <div>
      <div className="bpl-page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="bpl-page-title">Maintenance</h1>
          <p className="bpl-page-subtitle">Fleet service status, scheduling, and recommended intervals</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, letterSpacing: '0.08em', background: 'rgba(0,120,212,0.08)', color: '#0078D4', border: '1px solid rgba(0,120,212,0.2)' }}>
            DEMO VIEW
          </span>
          <button className="bpl-btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            <Plus size={13} /> Add Record
          </button>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
        {[
          { label: 'Overdue', value: overdueCt, icon: AlertTriangle, color: '#e53e3e', gradient: 'linear-gradient(135deg, #fff5f5 0%, #fed7d7 100%)', filter: 'overdue' as ServiceFilter },
          { label: 'Due This Month', value: dueSoonCt, icon: Clock, color: '#d97706', gradient: 'linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)', filter: 'due-soon' as ServiceFilter },
          { label: 'In Progress', value: inProgressCt, icon: Wrench, color: '#0078D4', gradient: 'linear-gradient(135deg, #ebf8ff 0%, #bee3f8 100%)', filter: 'in-progress' as ServiceFilter },
          { label: 'On Track', value: onTrackCt, icon: CheckCircle, color: '#38a169', gradient: 'linear-gradient(135deg, #f0fff4 0%, #c6f6d5 100%)', filter: 'on-track' as ServiceFilter },
        ].map(s => {
          const Icon = s.icon;
          const active = serviceFilter === s.filter;
          return (
            <div
              key={s.label}
              onClick={() => setServiceFilter(active ? 'all' : s.filter)}
              style={{
                padding: '20px 22px', borderRadius: 14, cursor: 'pointer',
                background: s.gradient,
                border: `1px solid ${active ? s.color : s.color + '22'}`,
                boxShadow: active ? `0 4px 20px ${s.color}25` : `0 4px 20px ${s.color}10`,
                transition: 'all 0.15s ease',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
                <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: s.color }}>{s.label}</span>
                <div style={{ width: 30, height: 30, borderRadius: 8, background: `${s.color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon size={14} style={{ color: s.color }} />
                </div>
              </div>
              <div style={{ fontSize: 34, fontWeight: 800, color: s.color, fontFamily: 'var(--cd-font-display)', lineHeight: 1 }}>{s.value}</div>
            </div>
          );
        })}
      </div>

      {/* Search + filter bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ fontSize: 13, color: 'var(--cd-text-muted)' }}>
          {filtered.length.toLocaleString()} of {vehicles.length.toLocaleString()} assets
        </div>
        <div style={{ position: 'relative' }}>
          <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--cd-text-muted)', pointerEvents: 'none' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search reg, name, make, transporter…"
            style={{
              paddingLeft: 32, paddingRight: 14, paddingTop: 8, paddingBottom: 8,
              border: '1px solid var(--cd-border)', borderRadius: 10, fontSize: 13,
              background: 'var(--cd-surface)', color: 'var(--cd-text)', outline: 'none', width: 280,
            }}
          />
        </div>
      </div>

      {/* Table */}
      <div className="bpl-card" style={{ overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--cd-border)' }}>
                {['Reg No', 'Asset Name', 'Make / Model', 'Transporter', 'Op. Status', 'Service Status', 'Next Service', ''].map(h => (
                  <th key={h} style={{
                    padding: '11px 16px', textAlign: 'left', fontWeight: 700,
                    fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.07em',
                    color: 'var(--cd-text-muted)', whiteSpace: 'nowrap',
                    background: 'var(--cd-surface-2, rgba(0,0,0,0.02))',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pagination.pageRows.map((v, i) => {
                const svc = getServiceStatus(v.regNo);
                const record = DEMO_SERVICE[v.regNo];
                return (
                  <tr
                    key={v.id}
                    style={{ borderBottom: '1px solid var(--cd-border)', transition: 'background 0.1s' }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--cd-surface-2, rgba(0,0,0,0.02))'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                  >
                    <td style={{ padding: '11px 16px', fontWeight: 700, color: 'var(--cd-text)', whiteSpace: 'nowrap' }}>{v.regNo || '—'}</td>
                    <td style={{ padding: '11px 16px', color: 'var(--cd-text-muted)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.assetName || '—'}</td>
                    <td style={{ padding: '11px 16px', color: 'var(--cd-text-muted)', whiteSpace: 'nowrap' }}>
                      {v.make && v.model ? `${v.make} · ${v.model}` : v.make || v.model || '—'}
                    </td>
                    <td style={{ padding: '11px 16px', color: 'var(--cd-text-muted)', whiteSpace: 'nowrap' }}>{v.transporter || '—'}</td>
                    <td style={{ padding: '11px 16px', whiteSpace: 'nowrap' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: opStatusColor(v.status), flexShrink: 0 }} />
                        <span style={{ color: opStatusColor(v.status), fontWeight: 600 }}>{v.status}</span>
                      </span>
                    </td>
                    <td style={{ padding: '11px 16px', whiteSpace: 'nowrap' }}>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 9999,
                        background: `${svc.color}15`, color: svc.color, border: `1px solid ${svc.color}30`,
                      }}>
                        {svc.label}
                      </span>
                    </td>
                    <td style={{ padding: '11px 16px', color: 'var(--cd-text-muted)', whiteSpace: 'nowrap' }}>
                      {record ? nextDueDate(record.lastService, record.intervalDays) : '—'}
                    </td>
                    <td style={{ padding: '11px 16px', whiteSpace: 'nowrap' }}>
                      {record && (
                        <button
                          onClick={() => setScheduleVehicle(v)}
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: 5,
                            padding: '5px 10px', borderRadius: 7, fontSize: 11, fontWeight: 600,
                            border: `1px solid ${svc.color}40`, background: `${svc.color}10`,
                            color: svc.color, cursor: 'pointer',
                          }}
                        >
                          <Calendar size={11} /> Schedule
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--cd-text-muted)', fontSize: 13 }}>
              No assets match your search
            </div>
          )}
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
        </div>
      </div>

      {scheduleVehicle && (
        <ScheduleModal vehicle={scheduleVehicle} onClose={() => setScheduleVehicle(null)} />
      )}
    </div>
    </FeatureGate>
  );
}

function ScheduleModal({ vehicle: v, onClose }: { vehicle: any; onClose: () => void }) {
  const record = DEMO_SERVICE[v.regNo];
  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '10px 14px', border: '1px solid var(--cd-border)', borderRadius: 10,
    fontSize: 13, background: 'var(--cd-surface-2, #f8fafc)', color: 'var(--cd-text)',
    outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em',
    color: 'var(--cd-text-muted)', marginBottom: 6, display: 'block',
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ background: 'var(--cd-surface)', borderRadius: 20, border: '1px solid var(--cd-border)', width: '100%', maxWidth: 460, boxShadow: '0 24px 64px rgba(0,0,0,0.2)' }}>
        <div style={{ padding: '22px 26px', borderBottom: '1px solid var(--cd-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--cd-text)' }}>Schedule Service</div>
            <div style={{ fontSize: 11, color: 'var(--cd-text-muted)', marginTop: 2 }}>{v.regNo} · {v.make} {v.model}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--cd-text-muted)', fontSize: 18, lineHeight: 1 }}>✕</button>
        </div>

        <div style={{ padding: '22px 26px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {record && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, padding: '14px 16px', borderRadius: 12, background: 'var(--cd-surface-2, #f8fafc)', border: '1px solid var(--cd-border)' }}>
              {[
                { label: 'Last Service', value: record.lastService },
                { label: 'Recommended', value: nextDueDate(record.lastService, record.intervalDays) },
              ].map(f => (
                <div key={f.label}>
                  <div style={labelStyle}>{f.label}</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--cd-text)' }}>{f.value}</div>
                </div>
              ))}
            </div>
          )}

          <div><label style={labelStyle}>Scheduled Date</label><input type="date" style={inputStyle} /></div>
          <div><label style={labelStyle}>Assign Technician</label><input placeholder="Technician name" style={inputStyle} /></div>
          <div><label style={labelStyle}>Notes</label><textarea rows={3} placeholder="Service notes…" style={{ ...inputStyle, resize: 'vertical' }} /></div>

          <div style={{ display: 'flex', gap: 10, paddingTop: 4 }}>
            <button onClick={onClose} className="bpl-btn-secondary" style={{ flex: 1, padding: '10px', borderRadius: 10, fontSize: 13 }}>Cancel</button>
            <button onClick={onClose} style={{ flex: 2, background: 'linear-gradient(135deg, #0078D4, #005fa3)', color: '#fff', border: 'none', borderRadius: 10, padding: '10px', fontSize: 13, fontWeight: 600, cursor: 'pointer', boxShadow: '0 4px 14px rgba(0,120,212,0.35)' }}>
              Confirm Schedule
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
