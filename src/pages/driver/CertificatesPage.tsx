import { useState, useMemo, useDeferredValue } from 'react';
import XLSX from 'xlsx-js-style';
import { BadgeCheck, Plus, Search, Trash2, Pencil, Upload } from 'lucide-react';
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

type ImportSummary = { imported: number; skipped: number; invalid: string[]; documentSetTitle?: string };

const HEADER_ALIASES: Record<string, string[]> = {
  driverName: ['driver name', 'driver', 'name'],
  certType: ['certificate type', 'certificate', 'cert type', 'certification', 'training'],
  certNumber: ['certificate no', 'certificate no.', 'certificate number', 'cert no', 'cert no.', 'number'],
  issueDate: ['issue date', 'issued', 'issued date', 'date issued'],
  expiryDate: ['expiry date', 'expires', 'expiration date', 'expiry', 'valid until'],
  notes: ['notes', 'note', 'comments', 'comment'],
};

function normalizeHeader(value: unknown) {
  return String(value || '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

function cellString(value: unknown) {
  if (value == null) return '';
  return String(value).trim();
}

function dateCell(value: unknown) {
  if (value == null || value === '') return '';
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
    }
  }
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : text;
}

function buildHeaderMap(headers: unknown[]) {
  const normalized = headers.map(normalizeHeader);
  const map: Record<string, number> = {};
  Object.entries(HEADER_ALIASES).forEach(([field, aliases]) => {
    const idx = normalized.findIndex(h => aliases.includes(h));
    if (idx >= 0) map[field] = idx;
  });
  return map;
}

function sourceValue(header: string, cert: DriverCertificate) {
  if (cert.sourceRow && Object.prototype.hasOwnProperty.call(cert.sourceRow, header)) return cert.sourceRow[header] || '—';
  const normalized = normalizeHeader(header);
  if (HEADER_ALIASES.driverName.includes(normalized)) return displayDriverName(cert.driverName);
  if (HEADER_ALIASES.certType.includes(normalized)) return cert.certType || '—';
  if (HEADER_ALIASES.certNumber.includes(normalized)) return cert.certNumber || '—';
  if (HEADER_ALIASES.issueDate.includes(normalized)) return cert.issueDate || '—';
  if (HEADER_ALIASES.expiryDate.includes(normalized)) return cert.expiryDate || '—';
  if (HEADER_ALIASES.notes.includes(normalized)) return cert.notes || '—';
  return '—';
}

async function parseCertificateFile(file: File, documentSetTitle: string): Promise<ImportSummary> {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '', raw: false });
  const [headers, ...body] = rows.filter(row => row.some(cell => cellString(cell)));
  if (!headers) return { imported: 0, skipped: 0, invalid: ['The uploaded file is empty.'] };

  const sourceHeaders = headers.map(header => cellString(header)).filter(Boolean);
  const headerMap = buildHeaderMap(headers);
  const missing = ['driverName', 'certType'].filter(field => headerMap[field] == null);
  if (missing.length) {
    return { imported: 0, skipped: body.length, invalid: ['Missing required columns: Driver Name and Certificate Type.'] };
  }

  let imported = 0;
  let skipped = 0;
  const invalid: string[] = [];

  body.forEach((row, idx) => {
    const driverName = cellString(row[headerMap.driverName]);
    const certType = cellString(row[headerMap.certType]);
    if (!driverName || !certType) {
      skipped += 1;
      if (invalid.length < 5) invalid.push(`Row ${idx + 2}: missing driver name or certificate type.`);
      return;
    }
    const sourceRow = sourceHeaders.reduce<Record<string, string>>((acc, header) => {
      const colIdx = headers.findIndex(h => cellString(h) === header);
      acc[header] = colIdx >= 0 ? (HEADER_ALIASES.issueDate.includes(normalizeHeader(header)) || HEADER_ALIASES.expiryDate.includes(normalizeHeader(header)) ? dateCell(row[colIdx]) : cellString(row[colIdx])) : '';
      return acc;
    }, {});

    upsertCertificate({
      driverKey: driverName,
      driverName,
      certType,
      certNumber: headerMap.certNumber != null ? cellString(row[headerMap.certNumber]) : '',
      issueDate: headerMap.issueDate != null ? dateCell(row[headerMap.issueDate]) : '',
      expiryDate: headerMap.expiryDate != null ? dateCell(row[headerMap.expiryDate]) : '',
      notes: headerMap.notes != null ? cellString(row[headerMap.notes]) : '',
      documentSetTitle,
      sourceHeaders,
      sourceRow,
    });
    imported += 1;
  });

  return { imported, skipped, invalid, documentSetTitle };
}

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
      documentSetTitle: cert?.documentSetTitle,
      sourceHeaders: cert?.sourceHeaders,
      sourceRow: cert?.sourceRow,
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
  const [importing, setImporting] = useState(false);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importTitle, setImportTitle] = useState('');
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const refresh = () => setCerts(getCertificates());

  const importCertificates = async (file: File | null, title: string) => {
    if (!file) return;
    const documentSetTitle = title.trim() || file.name.replace(/\.[^.]+$/, '') || 'Imported certificates';
    setImporting(true);
    setImportSummary(null);
    try {
      const summary = await parseCertificateFile(file, documentSetTitle);
      setImportSummary(summary);
      refresh();
      setImportOpen(false);
      setImportTitle('');
      setPendingFile(null);
    } catch (e) {
      setImportSummary({ imported: 0, skipped: 0, invalid: [(e as Error)?.message || 'Could not import this file.'] });
    } finally {
      setImporting(false);
    }
  };

  const filtered = useMemo(() => {
    if (!deferredSearch) return certs;
    const s = deferredSearch.toLowerCase();
    return certs.filter(c => (
      c.driverName.toLowerCase().includes(s)
      || c.certType.toLowerCase().includes(s)
      || (c.documentSetTitle || '').toLowerCase().includes(s)
      || Object.values(c.sourceRow || {}).some(value => value.toLowerCase().includes(s))
    ));
  }, [certs, deferredSearch]);

  const pagination = useClientPagination(filtered, 25, deferredSearch);
  const importedHeaders = useMemo(() => {
    const first = filtered.find(c => c.sourceHeaders?.length)?.sourceHeaders;
    if (!first?.length) return null;
    const signature = JSON.stringify(first);
    return filtered.some(c => c.sourceHeaders?.length && JSON.stringify(c.sourceHeaders) !== signature) ? null : first;
  }, [filtered]);
  const defaultHeaders = ['Document Set', 'Driver', 'Certificate', 'Number', 'Issued', 'Expires', 'Status', ''];
  const tableHeaders = importedHeaders ? [...importedHeaders, 'Status', ''] : defaultHeaders;

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
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button
              className="bpl-btn-secondary"
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: importing ? 'wait' : 'pointer' }}
              onClick={() => setImportOpen(true)}
              disabled={importing}
            >
              <Upload size={13} /> {importing ? 'Importing...' : 'Upload CSV/Excel'}
            </button>
            <button
              className="bpl-btn-secondary"
              onClick={() => setModalCert('new')}
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}
            >
              <Plus size={13} /> Add Certificate
            </button>
          </div>
        </div>

        {importSummary && (
          <div className="bpl-card" style={{ padding: '12px 16px', marginBottom: 16, borderLeft: `3px solid ${importSummary.imported ? '#16a34a' : '#d97706'}` }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--cd-text)' }}>
              Imported {importSummary.imported} certificate record{importSummary.imported === 1 ? '' : 's'}
              {importSummary.skipped ? ` · skipped ${importSummary.skipped}` : ''}
            </div>
            {importSummary.documentSetTitle && (
              <div style={{ fontSize: 11, color: 'var(--cd-text-muted)', marginTop: 3 }}>
                Document set: {importSummary.documentSetTitle}
              </div>
            )}
            {importSummary.invalid.length > 0 && (
              <div style={{ fontSize: 11, color: 'var(--cd-text-muted)', marginTop: 4, lineHeight: 1.5 }}>
                {importSummary.invalid.join(' ')}
              </div>
            )}
          </div>
        )}

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
                  {tableHeaders.map(h => (
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
                      {importedHeaders ? (
                        importedHeaders.map(header => (
                          <td key={header} style={{ padding: '11px 16px', color: 'var(--cd-text-muted)', whiteSpace: 'nowrap' }}>
                            {sourceValue(header, c)}
                          </td>
                        ))
                      ) : (
                        <>
                          <td style={{ padding: '11px 16px', color: 'var(--cd-text-muted)' }}>{c.documentSetTitle || 'Manual entry'}</td>
                          <td style={{ padding: '11px 16px', fontWeight: 600, color: 'var(--cd-text)' }}>{displayDriverName(c.driverName)}</td>
                          <td style={{ padding: '11px 16px', color: 'var(--cd-text-muted)' }}>{c.certType}</td>
                          <td style={{ padding: '11px 16px', color: 'var(--cd-text-muted)' }}>{c.certNumber || '—'}</td>
                          <td style={{ padding: '11px 16px', color: 'var(--cd-text-muted)', whiteSpace: 'nowrap' }}>{c.issueDate || '—'}</td>
                          <td style={{ padding: '11px 16px', color: 'var(--cd-text-muted)', whiteSpace: 'nowrap' }}>{c.expiryDate || '—'}</td>
                        </>
                      )}
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
        {importOpen && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
            <div style={{ background: 'var(--cd-surface)', borderRadius: 20, border: '1px solid var(--cd-border)', width: '100%', maxWidth: 520, boxShadow: '0 24px 64px rgba(0,0,0,0.2)' }}>
              <div style={{ padding: '22px 26px', borderBottom: '1px solid var(--cd-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--cd-text)' }}>Import Certificate Documents</div>
                  <div style={{ fontSize: 12, color: 'var(--cd-text-muted)', marginTop: 3 }}>Name this upload set, then import CSV or Excel records.</div>
                </div>
                <button onClick={() => { if (!importing) setImportOpen(false); }} style={{ background: 'none', border: 'none', cursor: importing ? 'wait' : 'pointer', color: 'var(--cd-text-muted)', fontSize: 18, lineHeight: 1 }}>✕</button>
              </div>
              <div style={{ padding: '22px 26px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label style={labelStyle}>Document Set Title</label>
                  <input
                    style={inputStyle}
                    value={importTitle}
                    onChange={e => setImportTitle(e.target.value)}
                    placeholder="e.g. January training certificates"
                    disabled={importing}
                  />
                </div>
                <div>
                  <label style={labelStyle}>CSV / Excel File</label>
                  <input
                    type="file"
                    accept=".csv,.xls,.xlsx"
                    disabled={importing}
                    onChange={e => {
                      const file = e.target.files?.[0] || null;
                      setPendingFile(file);
                      if (file && !importTitle.trim()) setImportTitle(file.name.replace(/\.[^.]+$/, ''));
                    }}
                    style={inputStyle}
                  />
                  <div style={{ fontSize: 11, color: 'var(--cd-text-muted)', marginTop: 6, lineHeight: 1.5 }}>
                    Required columns are Driver Name and Certificate Type. Other uploaded columns are preserved and displayed with their original names.
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 10, paddingTop: 4 }}>
                  <button
                    onClick={() => { setImportOpen(false); setPendingFile(null); setImportTitle(''); }}
                    disabled={importing}
                    className="bpl-btn-secondary"
                    style={{ flex: 1, padding: '10px', borderRadius: 10, fontSize: 13 }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => void importCertificates(pendingFile, importTitle)}
                    disabled={!pendingFile || importing}
                    style={{
                      flex: 2, background: 'linear-gradient(135deg, #0078D4, #005fa3)', color: '#fff', border: 'none',
                      borderRadius: 10, padding: '10px', fontSize: 13, fontWeight: 600,
                      cursor: pendingFile && !importing ? 'pointer' : 'not-allowed',
                      opacity: pendingFile && !importing ? 1 : 0.6,
                      boxShadow: '0 4px 14px rgba(0,120,212,0.35)',
                    }}
                  >
                    {importing ? 'Importing...' : 'Import Documents'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
  );
}
