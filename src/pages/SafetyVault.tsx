import { useState } from 'react';
import { Plus, Download, Shield, Clock, CheckCircle, AlertCircle, Search, ShieldAlert, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { useFleet } from '../context/FleetContext';
import type { VaultRecord } from '../context/FleetContext';
import SafetyIncidentModal from '../components/SafetyIncidentModal';
import type { SafetyNotification } from '../hooks/useSafeIQ';
import { formatEnvironmentLine } from '../components/EnvironmentBadge';
import { isKnownDriver, displayDriverName } from '../lib/driverUtils';
import { brandLabel } from '../lib/branding';
import MockNamesBadge from '../components/MockNamesBadge';

type StatusFilter = 'all' | 'open' | 'in_review' | 'resolved';
type SeverityFilter = 'all' | 'RED' | 'YELLOW' | 'GREEN';

const STATUS_LABELS: Record<VaultRecord['status'], string> = {
  open: 'Open',
  in_review: 'In Review',
  resolved: 'Resolved',
};

const STATUS_COLORS: Record<VaultRecord['status'], string> = {
  open: '#CC0000',
  in_review: '#d97706',
  resolved: '#16a34a',
};

function NewRecordModal({ onClose, onSave }: { onClose: () => void; onSave: (r: VaultRecord) => void }) {
  const [form, setForm] = useState({
    type: 'Harsh Braking',
    driverName: '',
    vehicleId: '',
    location: '',
    severity: 'YELLOW' as VaultRecord['severity'],
    description: '',
    supervisorResponse: '',
  });

  const handle = (k: string, v: string) => setForm(prev => ({ ...prev, [k]: v }));

  const save = () => {
    const record: VaultRecord = {
      id: `vault-${Date.now()}`,
      incidentId: `inc-${Date.now()}`,
      type: form.type,
      driverName: form.driverName,
      vehicleId: form.vehicleId,
      location: form.location,
      timestamp: new Date().toISOString(),
      severity: form.severity,
      status: 'open',
      description: form.description,
      actions: [],
      supervisorResponse: form.supervisorResponse,
      resolution: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    onSave(record);
    onClose();
  };

  const fieldStyle: React.CSSProperties = {
    width: '100%', padding: '8px 12px',
    border: '1px solid var(--cd-border)', borderRadius: 8, fontSize: 13,
    background: 'var(--cd-surface-2)', color: 'var(--cd-text)', outline: 'none',
    fontFamily: 'var(--cd-font-body)',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, color: 'var(--cd-text-muted)',
    textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4,
    display: 'block',
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{
        background: 'var(--cd-surface)', borderRadius: 16, border: '1px solid var(--cd-border)',
        width: '100%', maxWidth: 560, maxHeight: '90vh', overflow: 'auto',
        boxShadow: 'var(--cd-card-shadow)',
      }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--cd-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--cd-text)', fontFamily: 'var(--cd-font-display)' }}>
            Log Incident to Safety Vault
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--cd-text-muted)' }}>✕</button>
        </div>

        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div>
              <label style={labelStyle}>Incident Type</label>
              <select style={fieldStyle} value={form.type} onChange={e => handle('type', e.target.value)}>
                <option>Harsh Braking</option>
                <option>Harsh Acceleration</option>
                <option>Overspeeding</option>
                <option>Harsh Cornering</option>
                <option>Near Miss</option>
                <option>Collision</option>
                <option>Vehicle Defect</option>
                <option>Driver Fatigue</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Severity</label>
              <select style={fieldStyle} value={form.severity} onChange={e => handle('severity', e.target.value as VaultRecord['severity'])}>
                <option value="RED">RED — Critical</option>
                <option value="YELLOW">YELLOW — Caution</option>
                <option value="GREEN">GREEN — Minor</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div>
              <label style={labelStyle}>Driver Name</label>
              <input style={fieldStyle} type="text" placeholder="Full name" value={form.driverName} onChange={e => handle('driverName', e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Vehicle / Reg No.</label>
              <input style={fieldStyle} type="text" placeholder="e.g. LND 123 XY" value={form.vehicleId} onChange={e => handle('vehicleId', e.target.value)} />
            </div>
          </div>

          <div>
            <label style={labelStyle}>Location</label>
            <input style={fieldStyle} type="text" placeholder="Incident location" value={form.location} onChange={e => handle('location', e.target.value)} />
          </div>

          <div>
            <label style={labelStyle}>Description</label>
            <textarea
              style={{ ...fieldStyle, minHeight: 80, resize: 'vertical' }}
              placeholder="Describe what happened..."
              value={form.description}
              onChange={e => handle('description', e.target.value)}
            />
          </div>

          <div>
            <label style={labelStyle}>Supervisor Initial Response</label>
            <textarea
              style={{ ...fieldStyle, minHeight: 60, resize: 'vertical' }}
              placeholder="Immediate action taken..."
              value={form.supervisorResponse}
              onChange={e => handle('supervisorResponse', e.target.value)}
            />
          </div>
        </div>

        <div style={{ padding: '16px 24px', borderTop: '1px solid var(--cd-border)', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="bpl-btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="bpl-btn-primary"
            onClick={save}
            disabled={!form.driverName || !form.vehicleId}
          >
            <Shield size={14} /> Log to Vault
          </button>
        </div>
      </div>
    </div>
  );
}

function RecordRow({ record, onUpdate }: { record: VaultRecord; onUpdate: (id: string, u: Partial<VaultRecord>) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [action, setAction] = useState('');
  const statusColor = STATUS_COLORS[record.status];

  const addAction = () => {
    if (!action.trim()) return;
    onUpdate(record.id, { actions: [...record.actions, action.trim()] });
    setAction('');
  };

  return (
    <div style={{ borderBottom: '1px solid var(--cd-border)' }}>
      <div
        onClick={() => setExpanded(e => !e)}
        style={{
          padding: '14px 20px', cursor: 'pointer',
          display: 'grid', gridTemplateColumns: 'auto 1fr auto auto auto',
          gap: 16, alignItems: 'center',
          transition: 'background 0.12s',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = 'var(--cd-surface-2)')}
        onMouseLeave={e => (e.currentTarget.style.background = '')}
      >
        {/* Severity dot */}
        <div style={{
          width: 10, height: 10, borderRadius: '50%',
          background: record.severity === 'RED' ? '#CC0000' : record.severity === 'YELLOW' ? '#d97706' : '#16a34a',
          flexShrink: 0,
        }} />

        {/* Main info */}
        <div>
          <div style={{ fontWeight: 600, color: 'var(--cd-text)', fontSize: 13 }}>
            {record.type} — {displayDriverName(record.driverName)}
            {record.vehicleId && <span style={{ fontWeight: 400, color: 'var(--cd-text-muted)', marginLeft: 6 }}>({record.vehicleId})</span>}
          </div>
          <div style={{ fontSize: 11, color: 'var(--cd-text-muted)', marginTop: 2 }}>
            {record.location && <span>{brandLabel(record.location)} · </span>}
            {new Date(record.timestamp).toLocaleString('en-GB', { timeZone: 'Africa/Lagos', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>

        {/* Actions count */}
        <span style={{ fontSize: 11, color: 'var(--cd-text-muted)' }}>
          {record.actions.length} action{record.actions.length !== 1 ? 's' : ''}
        </span>

        {/* Severity badge */}
        <span style={{
          padding: '2px 8px', borderRadius: 9999, fontSize: 10, fontWeight: 700,
          background: record.severity === 'RED' ? '#CC000015' : record.severity === 'YELLOW' ? '#d9770615' : '#16a34a15',
          color: record.severity === 'RED' ? '#CC0000' : record.severity === 'YELLOW' ? '#d97706' : '#16a34a',
        }}>
          {record.severity}
        </span>

        {/* Status */}
        <select
          value={record.status}
          onChange={e => { e.stopPropagation(); onUpdate(record.id, { status: e.target.value as VaultRecord['status'] }); }}
          onClick={e => e.stopPropagation()}
          style={{
            padding: '4px 8px', border: `1px solid ${statusColor}40`,
            borderRadius: 6, fontSize: 11, fontWeight: 600,
            background: `${statusColor}10`, color: statusColor,
            cursor: 'pointer', outline: 'none',
          }}
        >
          <option value="open">Open</option>
          <option value="in_review">In Review</option>
          <option value="resolved">Resolved</option>
        </select>
      </div>

      {expanded && (
        <div style={{ padding: '0 20px 16px 46px', background: 'var(--cd-surface-2)' }}>
          {record.description && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--cd-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Description</div>
              <div style={{ fontSize: 13, color: 'var(--cd-text)', lineHeight: 1.5 }}>{record.description}</div>
            </div>
          )}
          {record.supervisorResponse && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--cd-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Supervisor Response</div>
              <div style={{ fontSize: 13, color: 'var(--cd-text)', lineHeight: 1.5 }}>{record.supervisorResponse}</div>
            </div>
          )}
          {record.actions.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--cd-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Corrective Actions</div>
              {record.actions.map((a, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 4, fontSize: 12, color: 'var(--cd-text)' }}>
                  <CheckCircle size={13} color="#16a34a" style={{ flexShrink: 0, marginTop: 1 }} />
                  {a}
                </div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              placeholder="Add corrective action..."
              value={action}
              onChange={e => setAction(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addAction()}
              style={{
                flex: 1, padding: '6px 10px', border: '1px solid var(--cd-border)',
                borderRadius: 6, fontSize: 12, background: 'var(--cd-surface)',
                color: 'var(--cd-text)', outline: 'none',
              }}
            />
            <button className="bpl-btn-primary" style={{ padding: '6px 12px', fontSize: 12 }} onClick={addAction}>
              Add
            </button>
          </div>
          <div style={{ marginTop: 8, fontSize: 10, color: 'var(--cd-text-muted)' }}>
            Record ID: {record.id} · Created: {new Date(record.createdAt).toLocaleString('en-GB', { timeZone: 'Africa/Lagos' })}
          </div>
        </div>
      )}
    </div>
  );
}

function exportISO(records: VaultRecord[]) {
  const lines = [
    'BPL FLEET INTELLIGENCE PLATFORM — SAFETY VAULT EXPORT',
    `ISO 39001 / ISO 45001 Compliance Report`,
    `Generated: ${new Date().toLocaleString('en-GB', { timeZone: 'Africa/Lagos' })} WAT`,
    `Total Records: ${records.length}`,
    `Open: ${records.filter(r => r.status === 'open').length}`,
    `In Review: ${records.filter(r => r.status === 'in_review').length}`,
    `Resolved: ${records.filter(r => r.status === 'resolved').length}`,
    '',
    '─'.repeat(80),
    '',
    ...records.map(r => [
      `RECORD: ${r.id}`,
      `Date: ${new Date(r.timestamp).toLocaleString('en-GB', { timeZone: 'Africa/Lagos' })} WAT`,
      `Type: ${r.type}`,
      `Severity: ${r.severity}`,
      `Driver: ${r.driverName}`,
      `Vehicle: ${r.vehicleId}`,
      `Location: ${r.location}`,
      `Status: ${r.status.toUpperCase()}`,
      `Description: ${r.description}`,
      `Supervisor Response: ${r.supervisorResponse}`,
      `Corrective Actions: ${r.actions.join('; ')}`,
      `Created: ${new Date(r.createdAt).toLocaleString('en-GB', { timeZone: 'Africa/Lagos' })} WAT`,
      `Updated: ${new Date(r.updatedAt).toLocaleString('en-GB', { timeZone: 'Africa/Lagos' })} WAT`,
      '',
      '─'.repeat(80),
      '',
    ].join('\n')),
  ].join('\n');

  const blob = new Blob([lines], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `bpl-safety-vault-iso-export-${new Date().toISOString().slice(0, 10)}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

type VaultTab = 'records' | 'investigations' | 'actions' | 'acknowledgements' | 'audit' | 'safeiq';

export default function SafetyVault({ tab = 'records' }: { tab?: VaultTab }) {
  const [showNewModal, setShowNewModal] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all');
  const [search, setSearch] = useState('');
  const [selectedNotif, setSelectedNotif] = useState<any | null>(null);
  const { vaultRecords, addVaultRecord, updateVaultRecord, events, notifications, dismissNotification, openNotification, closeNotification, selectedNotification } = useFleet();

  const filtered = vaultRecords.filter(r => {
    if (statusFilter !== 'all' && r.status !== statusFilter) return false;
    if (severityFilter !== 'all' && r.severity !== severityFilter) return false;
    if (search) {
      const s = search.toLowerCase();
      return r.driverName.toLowerCase().includes(s) || r.vehicleId.toLowerCase().includes(s) || r.type.toLowerCase().includes(s);
    }
    return true;
  });

  return (
    <div>
      <div className="bpl-page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="bpl-page-title">Safety Vault</h1>
          <p className="bpl-page-subtitle">Permanent incident records, investigations, and ISO 39001/45001 audit trail</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="bpl-btn-secondary" onClick={() => exportISO(vaultRecords)}>
            <Download size={14} /> ISO Export
          </button>
          <button className="bpl-btn-primary" onClick={() => setShowNewModal(true)}>
            <Plus size={14} /> Log Incident
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="bpl-kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 20 }}>
        <div className="bpl-kpi-card"><div className="bpl-kpi-label">Total Records</div><div className="bpl-kpi-value">{vaultRecords.length}</div></div>
        <div className="bpl-kpi-card" style={{ borderTop: '3px solid #CC0000' }}>
          <div className="bpl-kpi-label">Open</div>
          <div className="bpl-kpi-value" style={{ color: '#CC0000' }}>{vaultRecords.filter(r => r.status === 'open').length}</div>
        </div>
        <div className="bpl-kpi-card" style={{ borderTop: '3px solid #d97706' }}>
          <div className="bpl-kpi-label">In Review</div>
          <div className="bpl-kpi-value" style={{ color: '#d97706' }}>{vaultRecords.filter(r => r.status === 'in_review').length}</div>
        </div>
        <div className="bpl-kpi-card" style={{ borderTop: '3px solid #16a34a' }}>
          <div className="bpl-kpi-label">Resolved</div>
          <div className="bpl-kpi-value" style={{ color: '#16a34a' }}>{vaultRecords.filter(r => r.status === 'resolved').length}</div>
        </div>
      </div>

      {/* ISO compliance note */}
      <div style={{
        padding: '12px 20px', marginBottom: 20, borderRadius: 10,
        background: 'var(--bpl-blue-soft)', border: '1px solid rgba(0,120,212,0.2)',
        display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--cd-text)',
      }}>
        <Shield size={16} color="var(--bpl-blue)" />
        <span>
          <strong style={{ color: 'var(--bpl-blue)' }}>ISO 39001 / ISO 45001 Audit Trail</strong> — Every record is timestamped, immutable, and exportable. Use "ISO Export" to generate a compliance document for certification auditors.
        </span>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--cd-text-muted)' }} />
          <input
            type="text" placeholder="Search records..."
            value={search} onChange={e => setSearch(e.target.value)}
            style={{
              width: '100%', paddingLeft: 34, paddingRight: 12, paddingTop: 8, paddingBottom: 8,
              border: '1px solid var(--cd-border)', borderRadius: 8, fontSize: 13,
              background: 'var(--cd-surface-2)', color: 'var(--cd-text)', outline: 'none',
            }}
          />
        </div>
        {(['all', 'open', 'in_review', 'resolved'] as StatusFilter[]).map(s => (
          <button key={s}
            onClick={() => setStatusFilter(s)}
            style={{
              padding: '7px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
              border: '1px solid',
              borderColor: statusFilter === s ? 'var(--bpl-blue)' : 'var(--cd-border)',
              background: statusFilter === s ? 'var(--bpl-blue-soft)' : 'var(--cd-surface)',
              color: statusFilter === s ? 'var(--bpl-blue)' : 'var(--cd-text-muted)',
            }}
          >
            {s === 'all' ? 'All Status' : s === 'in_review' ? 'In Review' : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
        {(['all', 'RED', 'YELLOW', 'GREEN'] as SeverityFilter[]).map(s => (
          <button key={s}
            onClick={() => setSeverityFilter(s)}
            style={{
              padding: '7px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
              border: '1px solid',
              borderColor: severityFilter === s
                ? (s === 'RED' ? '#CC0000' : s === 'YELLOW' ? '#d97706' : s === 'GREEN' ? '#16a34a' : 'var(--bpl-blue)')
                : 'var(--cd-border)',
              background: severityFilter === s ? (s === 'RED' ? '#CC000015' : s === 'YELLOW' ? '#d9770615' : s === 'GREEN' ? '#16a34a15' : 'var(--bpl-blue-soft)') : 'var(--cd-surface)',
              color: severityFilter === s
                ? (s === 'RED' ? '#CC0000' : s === 'YELLOW' ? '#d97706' : s === 'GREEN' ? '#16a34a' : 'var(--bpl-blue)')
                : 'var(--cd-text-muted)',
            }}
          >
            {s === 'all' ? 'All Severity' : s}
          </button>
        ))}
      </div>

      <div className="bpl-card" style={{ overflow: 'hidden' }}>
        {filtered.length === 0 ? (
          <div style={{ padding: '48px', textAlign: 'center' }}>
            <Shield size={40} color="var(--cd-border)" style={{ margin: '0 auto 16px' }} />
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--cd-text)', marginBottom: 8 }}>
              {vaultRecords.length === 0 ? 'Safety Vault is empty' : 'No records match your filters'}
            </div>
            <div style={{ fontSize: 13, color: 'var(--cd-text-muted)', marginBottom: 20 }}>
              {vaultRecords.length === 0
                ? 'Log your first incident to start building your ISO 39001 compliance audit trail.'
                : 'Try adjusting your filters.'}
            </div>
            {vaultRecords.length === 0 && (
              <button className="bpl-btn-primary" onClick={() => setShowNewModal(true)}>
                <Plus size={14} /> Log First Incident
              </button>
            )}
          </div>
        ) : filtered.map(r => (
          <RecordRow key={r.id} record={r} onUpdate={updateVaultRecord} />
        ))}
      </div>

      {showNewModal && (
        <NewRecordModal onClose={() => setShowNewModal(false)} onSave={addVaultRecord} />
      )}

      {/* SafeIQ tab */}
      {tab === 'safeiq' && (
        <SafeIQTab notifications={notifications} onOpen={openNotification} onDismiss={dismissNotification} />
      )}

      {/* Non-records tabs */}
      {tab !== 'records' && tab !== 'safeiq' && (
        <div className="bpl-card" style={{ padding: '40px', textAlign: 'center', marginTop: 20 }}>
          <Shield size={36} color="var(--cd-border)" style={{ margin: '0 auto 14px' }} />
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--cd-text)', marginBottom: 8, fontFamily: 'var(--cd-font-display)' }}>
            {tab === 'investigations' ? 'Investigations'
              : tab === 'actions' ? 'Corrective Actions'
              : tab === 'acknowledgements' ? 'Driver Acknowledgements'
              : 'Audit Trail'}
          </div>
          <div style={{ fontSize: 13, color: 'var(--cd-text-muted)', marginBottom: 12, maxWidth: 400, margin: '0 auto 12px' }}>
            {tab === 'investigations'
              ? 'Formal investigation records linked to vault incidents, with assigned investigators and finding summaries.'
              : tab === 'actions'
              ? 'Corrective actions raised from incident records, with owner, due date, and completion tracking.'
              : tab === 'acknowledgements'
              ? 'Driver sign-off on safety communications, coaching records, and incident notifications.'
              : 'Complete immutable audit trail of every record creation, update, and status change with timestamps.'}
          </div>
          <span className="bpl-badge-coming-soon" style={{ fontSize: 11, padding: '4px 12px' }}>Coming Soon</span>
        </div>
      )}

      {selectedNotification && (
        <SafetyIncidentModal notification={selectedNotification} onClose={closeNotification} />
      )}
    </div>
  );
}

function severityColor(s: string) {
  if (s === 'RED') return '#CC0000';
  if (s === 'YELLOW') return '#d97706';
  return '#16a34a';
}

function timeAgo(ts: string) {
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function SafeIQTab({ notifications, onOpen, onDismiss }: {
  notifications: SafetyNotification[];
  onOpen: (n: SafetyNotification) => void;
  onDismiss: (id: string) => void;
}) {
  const visible = notifications.filter(n => isKnownDriver(n.driver.name));

  if (visible.length === 0) {
    return (
      <div className="bpl-card" style={{ padding: '40px', textAlign: 'center', marginTop: 20 }}>
        <ShieldAlert size={36} color="var(--cd-border)" style={{ margin: '0 auto 14px' }} />
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--cd-text)', marginBottom: 8 }}>No SafeIQ analyses yet</div>
        <div style={{ fontSize: 13, color: 'var(--cd-text-muted)' }}>Analyses appear here when drivers cross incident thresholds</div>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {visible.map(n => {
        const severity = n.analysis?.severity ?? 'GREEN';
        const accent = severityColor(severity);
        const trend = n.driver.improvement_trend;
        return (
          <div
            key={n.id}
            className="bpl-card"
            style={{ padding: '20px 24px', borderLeft: `4px solid ${accent}`, cursor: 'pointer' }}
            onClick={() => onOpen(n)}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <ShieldAlert size={16} style={{ color: accent }} />
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--cd-text)' }}>{displayDriverName(n.driver.name)}</div>
                  <div style={{ fontSize: 11, color: 'var(--cd-text-muted)', marginTop: 2 }}>
                    {n.vehicle.id}{n.vehicle.make ? ` · ${n.vehicle.make}` : ''} · {timeAgo(n.timestamp)}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {severity !== 'GREEN' && (
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 9999,
                    background: severity === 'RED' ? 'var(--cd-danger-bg)' : 'var(--cd-status-idle-bg)',
                    color: accent, border: `1px solid ${accent}40`,
                  }}>{severity}</span>
                )}
                <button onClick={e => { e.stopPropagation(); onDismiss(n.id); }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--cd-text-muted)', padding: 4 }}>
                  ✕
                </button>
              </div>
            </div>

            {n.environment.weather !== 'Loading…' && (
              <div style={{ fontSize: 12, color: 'var(--cd-text-muted)', marginBottom: 12 }}>
                {formatEnvironmentLine(n.environment)}
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: n.analysis ? 14 : 0 }}>
              <div>
                <div style={{ fontSize: 10, color: 'var(--cd-text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>Event</div>
                {n.type === 'speeding' && /\d+\s*km\/h/.test(n.magnitude) ? (
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#d97706' }}>{n.magnitude}</div>
                ) : (
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--cd-text)' }}>{n.magnitude}</div>
                )}
              </div>
              <div>
                <div style={{ fontSize: 10, color: 'var(--cd-text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>Incidents / 30d</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: accent }}>{n.eventCount}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: 'var(--cd-text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>Safety Score</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: severityColor(n.driver.safety_score_baseline >= 80 ? 'GREEN' : n.driver.safety_score_baseline >= 60 ? 'YELLOW' : 'RED') }}>
                  {n.driver.safety_score_baseline}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: 'var(--cd-text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>Trend</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600,
                  color: trend === 'improving' ? '#16a34a' : trend === 'declining' ? '#CC0000' : '#d97706' }}>
                  {trend === 'improving' ? <TrendingUp size={12} /> : trend === 'declining' ? <TrendingDown size={12} /> : <Minus size={12} />}
                  {trend}
                </div>
              </div>
            </div>

            {n.analysis && (
              <div style={{ borderTop: '1px solid var(--cd-border)', paddingTop: 12 }}>
                <div style={{ fontSize: 12, color: 'var(--cd-text)', lineHeight: 1.6, marginBottom: 6 }}>
                  <span style={{ fontWeight: 700, color: 'var(--cd-text-muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', marginRight: 6 }}>Severity</span>
                  {n.analysis.severity_reason}
                </div>
                <div style={{ fontSize: 12, color: 'var(--cd-text-muted)', lineHeight: 1.6 }}>
                  <span style={{ fontWeight: 700, color: 'var(--cd-text-muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', marginRight: 6 }}>Coaching</span>
                  {n.analysis.coaching_recommendation}
                </div>
                {n.analysis.ops_flag && (
                  <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--cd-danger-bg)', border: '1px solid var(--cd-danger-border)', borderRadius: 8, fontSize: 12, color: 'var(--cd-text)' }}>
                    <strong style={{ color: 'var(--cd-danger)' }}>Ops Flag:</strong> {n.analysis.ops_flag_reason}
                  </div>
                )}
              </div>
            )}

            <div style={{ marginTop: 10, fontSize: 11, color: 'var(--cd-accent)', fontWeight: 600 }}>
              Click for full analysis →
            </div>
          </div>
        );
      })}
    </div>
  );
}
