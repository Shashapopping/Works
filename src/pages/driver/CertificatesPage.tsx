import { useState, useMemo, useDeferredValue } from 'react';
import { BadgeCheck, Plus, Search, Trash2, Pencil } from 'lucide-react';
import {
  getCertificates,
  upsertCertificate,
  deleteCertificate,
  certificateStatus,
  type DriverCertificate,
} from '../../lib/driverInterventions';
import { displayDriverName } from '../../lib/driverUtils';
import MockNamesBadge from '../../components/MockNamesBadge';
import { useClientPagination } from '../../hooks/useClientPagination';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import PageControls from '../../components/PageControls';

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 12px', border: '1px solid var(--cd-border)', borderRadius: 8,
  fontSize: 13, background: 'var(--cd-surface-2, #f8fafc)', color: 'var(--cd-text)',
  outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
};
const labelStyle: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em',
  color: 'var(--cd-text-muted)', marginBottom: 6, display: 'block',
};

function CertificateModal({ cert, onClose, onSaved }: {
  cert: DriverCertificate | null; onClose: () => void; onSaved: () => void;
}) {
  const [driverName, setDriverName] = useState(cert?.driverName || '');
  const [certType, setCertType] = useState(cert?.certType || '');
  const [certNumber, setCertNumber] = useState(cert?.certNumber || '');
  const [issueDate, setIssueDate] = useState(cert?.issueDate || '');
  const [expiryDate, setExpiryDate] = useState(cert?.expiryDate || '');
  const [notes, setNotes] = useState(cert?.notes || '');

  const save = () => {
    if (!driverName.trim() || !certType.trim()) return;
    upsertCertificate({
      id: cert?.id,
      driverKey: cert?.driverKey || driverName.trim(),
      driverName: driverName.trim(),
      certType: certType.trim(),
      certNumber: certNumber.trim(),
      issueDate,
      expiryDate,
      notes: notes.trim(),
    });
    onSaved();
    onClose();
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ background: 'var(--cd-surface)', borderRadius: 20, border: '1px solid var(--cd-border)', width: '100%', maxWidth: 480, boxShadow: '0 24px 64px rgba(0,0,0,0.2)' }}>
        <div style={{ padding: '22px 26px', borderBottom: '1px solid var(--cd-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--cd-text)' }}>{cert ? 'Edit Certificate' : 'Add Certificate'}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--cd-text-muted)', fontSize: 18, lineHeight: 1 }}>✕</button>
        </div>
        <div style={{ padding: '22px 26px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div><label style={labelStyle}>Driver Name</label><input style={inputStyle} value={driverName} onChange={e => setDriverName(e.target.value)} placeholder="Driver name" /></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div><label style={labelStyle}>Certificate Type</label><input style={inputStyle} value={certType} onChange={e => setCertType(e.target.value)} placeholder="e.g. Defensive Driving" /></div>
            <div><label style={labelStyle}>Certificate No.</label><input style={inputStyle} value={certNumber} onChange={e => setCertNumber(e.target.value)} placeholder="Optional" /></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div><label style={labelStyle}>Issue Date</label><input type="date" style={inputStyle} value={issueDate} onChange={e => setIssueDate(e.target.value)} /></div>
            <div><label style={labelStyle}>Expiry Date</label><input type="date" style={inputStyle} value={expiryDate} onChange={e => setExpiryDate(e.target.value)} /></div>
          </div>
          <div><label style={labelStyle}>Notes</label><textarea rows={2} style={{ ...inputStyle, resize: 'vertical' }} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional notes…" /></div>
          <div style={{ display: 'flex', gap: 10, paddingTop: 4 }}>
            <button onClick={onClose} className="bpl-btn-secondary" style={{ flex: 1, padding: '10px', borderRadius: 10, fontSize: 13 }}>Cancel</button>
            <button
              onClick={save}
              disabled={!driverName.trim() || !certType.trim()}
              style={{
                flex: 2, background: 'linear-gradient(135deg, #0078D4, #005fa3)', color: '#fff', border: 'none',
                borderRadius: 10, padding: '10px', fontSize: 13, fontWeight: 600,
                cursor: driverName.trim() && certType.trim() ? 'pointer' : 'not-allowed',
                opacity: driverName.trim() && certType.trim() ? 1 : 0.6,
                boxShadow: '0 4px 14px rgba(0,120,212,0.35)',
              }}
            >
              Save Certificate
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CertificatesPage() {
  const [certs, setCerts] = useState<DriverCertificate[]>(() => getCertificates());
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 200);
  const deferredSearch = useDeferredValue(debouncedSearch);
  const [modalCert, setModalCert] = useState<DriverCertificate | 'new' | null>(null);

  const refresh = () => setCerts(getCertificates());

  const filtered = useMemo(() => {
    if (!deferredSearch) return certs;
    const s = deferredSearch.toLowerCase();
    return certs.filter(c => c.driverName.toLowerCase().includes(s) || c.certType.toLowerCase().includes(s));
  }, [certs, deferredSearch]);

  const pagination = useClientPagination(filtered, 25);

  const expiredCt = certs.filter(c => certificateStatus(c.expiryDate).status === 'Expired').length;
  const expiringCt = certs.filter(c => certificateStatus(c.expiryDate).status === 'Expiring Soon').length;
  const validCt = certs.filter(c => certificateStatus(c.expiryDate).status === 'Valid').length;

  return (
      <div>
        <div className="bpl-page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h1 className="bpl-page-title">Driver Management — Certificates <MockNamesBadge /></h1>
            <p className="bpl-page-subtitle">Driver training and licence certificate records, tracked manually</p>
          </div>
          <button
            className="bpl-btn-secondary"
            onClick={() => setModalCert('new')}
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}
          >
            <Plus size={13} /> Add Certificate
          </button>
        </div>

        <div className="bpl-kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 20 }}>
          <div className="bpl-kpi-card">
            <div className="bpl-kpi-label">Total Records</div>
            <div className="bpl-kpi-value">{certs.length}</div>
          </div>
          <div className="bpl-kpi-card" style={{ borderTop: '3px solid #16a34a' }}>
            <div className="bpl-kpi-label">Valid</div>
            <div className="bpl-kpi-value" style={{ color: '#16a34a' }}>{validCt}</div>
          </div>
          <div className="bpl-kpi-card" style={{ borderTop: '3px solid #d97706' }}>
            <div className="bpl-kpi-label">Expiring Soon</div>
            <div className="bpl-kpi-value" style={{ color: '#d97706' }}>{expiringCt}</div>
          </div>
          <div className="bpl-kpi-card" style={{ borderTop: '3px solid #CC0000' }}>
            <div className="bpl-kpi-label">Expired</div>
            <div className="bpl-kpi-value" style={{ color: '#CC0000' }}>{expiredCt}</div>
          </div>
        </div>

        <div style={{ position: 'relative', marginBottom: 16, maxWidth: 320 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--cd-text-muted)' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search driver or certificate type..."
            style={{
              width: '100%', paddingLeft: 34, paddingRight: 12, paddingTop: 8, paddingBottom: 8,
              border: '1px solid var(--cd-border)', borderRadius: 8, fontSize: 13,
              background: 'var(--cd-surface-2)', color: 'var(--cd-text)', outline: 'none',
            }}
          />
        </div>

        <div className="bpl-card" style={{ overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--cd-border)' }}>
                  {['Driver', 'Certificate', 'Number', 'Issued', 'Expires', 'Status', ''].map(h => (
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
                {pagination.pageRows.map(c => {
                  const status = certificateStatus(c.expiryDate);
                  return (
                    <tr key={c.id} style={{ borderBottom: '1px solid var(--cd-border)' }}>
                      <td style={{ padding: '11px 16px', fontWeight: 600, color: 'var(--cd-text)' }}>{displayDriverName(c.driverName)}</td>
                      <td style={{ padding: '11px 16px', color: 'var(--cd-text-muted)' }}>{c.certType}</td>
                      <td style={{ padding: '11px 16px', color: 'var(--cd-text-muted)' }}>{c.certNumber || '—'}</td>
                      <td style={{ padding: '11px 16px', color: 'var(--cd-text-muted)', whiteSpace: 'nowrap' }}>{c.issueDate || '—'}</td>
                      <td style={{ padding: '11px 16px', color: 'var(--cd-text-muted)', whiteSpace: 'nowrap' }}>{c.expiryDate || '—'}</td>
                      <td style={{ padding: '11px 16px', whiteSpace: 'nowrap' }}>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 5,
                          fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 9999,
                          background: `${status.color}15`, color: status.color, border: `1px solid ${status.color}30`,
                        }}>
                          {status.status}
                        </span>
                      </td>
                      <td style={{ padding: '11px 16px', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            onClick={() => setModalCert(c)}
                            style={{ background: 'none', border: '1px solid var(--cd-border)', borderRadius: 6, padding: 6, cursor: 'pointer', color: 'var(--cd-text-muted)' }}
                            title="Edit"
                          >
                            <Pencil size={12} />
                          </button>
                          <button
                            onClick={() => { deleteCertificate(c.id); refresh(); }}
                            style={{ background: 'none', border: '1px solid var(--cd-border)', borderRadius: 6, padding: 6, cursor: 'pointer', color: '#CC0000' }}
                            title="Delete"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filtered.length === 0 && (
              <div style={{ padding: '40px', textAlign: 'center', color: 'var(--cd-text-muted)', fontSize: 13 }}>
                <BadgeCheck size={28} style={{ opacity: 0.4, marginBottom: 8 }} />
                <div>No certificate records yet — add one to get started</div>
              </div>
            )}
            <PageControls
              page={pagination.page} pageCount={pagination.pageCount}
              from={pagination.from} to={pagination.to} total={pagination.total}
              hasPrev={pagination.hasPrev} hasNext={pagination.hasNext}
              onPrev={pagination.prev} onNext={pagination.next}
              itemLabel="records"
            />
          </div>
        </div>

        {modalCert && (
          <CertificateModal
            cert={modalCert === 'new' ? null : modalCert}
            onClose={() => setModalCert(null)}
            onSaved={refresh}
          />
        )}
      </div>
  );
}
