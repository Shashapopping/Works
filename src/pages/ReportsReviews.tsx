import { useState } from 'react';
import { CalendarDays, CheckCircle2, Download, FileSpreadsheet, FileText, Search, ShieldCheck, X } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useFleet, type LogEntry } from '../context/FleetContext';
import { displayDriverName } from '../lib/driverUtils';

interface Action {
  id: string;
  goal: string;
  owner: string;
  status: 'pending' | 'in_progress' | 'complete';
  dueDate: string;
  category: string;
  createdAt: string;
}

const HIDDEN_LABELS = ['Possible Power Tamper', 'Battery Disconnection', 'Battery Disconnected', 'Front Panel Tamper', 'Back Panel Tamper', 'No Blue Key'];
const TEXT_FORCE_HEADERS = ['Reg No', 'Phone'];

type ReportProcessId = 'weekly' | 'monthly' | 'quarterly' | 'actions';
type ReportFormat = 'csv' | 'excel' | 'pdf';

async function loadExportLibs() {
  const [{ default: XLSX }, { default: jsPDF }, { default: autoTable }] = await Promise.all([
    import('xlsx-js-style'),
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  return { XLSX, jsPDF, autoTable };
}

const REPORT_PROCESSES: Array<{
  id: ReportProcessId;
  title: string;
  cadence: string;
  rangeDays: number | null;
  description: string;
  accent: string;
  icon: typeof CalendarDays;
}> = [
  {
    id: 'weekly',
    title: 'Weekly Safety Review',
    cadence: 'Last 7 days',
    rangeDays: 7,
    description: 'Incident detail pack for weekly toolbox talks and supervisor follow-up.',
    accent: '#CC0000',
    icon: CalendarDays,
  },
  {
    id: 'monthly',
    title: 'Monthly Performance Report',
    cadence: 'Last 30 days',
    rangeDays: 30,
    description: 'Aggregated monthly evidence for fleet safety score, trends, and driver coaching.',
    accent: '#0078D4',
    icon: FileSpreadsheet,
  },
  {
    id: 'quarterly',
    title: 'Quarterly Management Review',
    cadence: 'Last 90 days',
    rangeDays: 90,
    description: 'Management review extract for ISO 39001 performance and recurring risk patterns.',
    accent: '#7c3aed',
    icon: ShieldCheck,
  },
  {
    id: 'actions',
    title: 'Action Register',
    cadence: 'All open evidence',
    rangeDays: null,
    description: 'Continuous improvement tracker with owners, due dates, and completion status.',
    accent: '#16a34a',
    icon: CheckCircle2,
  },
];

function useActions() {
  const [actions, setActions] = useState<Action[]>(() => {
    try { return JSON.parse(localStorage.getItem('bpl_actions') || '[]'); } catch { return []; }
  });

  const add = (a: Action) => setActions(prev => {
    const n = [...prev, a];
    localStorage.setItem('bpl_actions', JSON.stringify(n));
    return n;
  });

  const update = (id: string, u: Partial<Action>) => setActions(prev => {
    const n = prev.map(a => a.id === id ? { ...a, ...u } : a);
    localStorage.setItem('bpl_actions', JSON.stringify(n));
    return n;
  });

  return { actions, add, update };
}

function SectionHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--cd-text)', fontFamily: 'var(--cd-font-display)' }}>{title}</div>
      {subtitle && <div style={{ fontSize: 12, color: 'var(--cd-text-muted)', marginTop: 2 }}>{subtitle}</div>}
    </div>
  );
}

const getEventName = (e: LogEntry) => e.label || 'Unknown';
const eventTime = (e: LogEntry) => new Date(e.eventTime || e.timestamp).getTime();
const isReportableEvent = (e: LogEntry) => e.type !== 'panic' && !HIDDEN_LABELS.includes(e.label || '');
const formatDateTime = (value?: string) => value ? new Date(value).toLocaleString('en-GB') : 'N/A';
const formatLocation = (e: LogEntry) => {
  if (e.address && e.address !== 'N/A' && e.address !== 'null') return e.address;
  if (e.latitude && e.longitude) return `${Number(e.latitude).toFixed(5)}, ${Number(e.longitude).toFixed(5)}`;
  return 'N/A';
};

function getProcessEvents(events: LogEntry[], process: (typeof REPORT_PROCESSES)[number]) {
  if (process.id === 'actions') return [];
  const cutoff = process.rangeDays ? Date.now() - process.rangeDays * 24 * 60 * 60 * 1000 : 0;
  return events
    .filter(e => isReportableEvent(e) && eventTime(e) >= cutoff)
    .sort((a, b) => eventTime(b) - eventTime(a));
}

function summarizeEvents(events: LogEntry[]) {
  return {
    total: events.length,
    harshBraking: events.filter(e => e.label === 'Harsh Braking').length,
    harshAcceleration: events.filter(e => e.label === 'Harsh Acceleration').length,
    overspeeding: events.filter(e => e.label === 'Overspeeding' || e.label === 'Overspeed Tiered').length,
    harshCornering: events.filter(e => e.label === 'Harsh Cornering').length,
  };
}

function buildProcessExport(process: (typeof REPORT_PROCESSES)[number], events: LogEntry[], actions: Action[]) {
  if (process.id === 'actions') {
    return {
      headers: ['Goal', 'Owner', 'Status', 'Category', 'Due Date', 'Created At'],
      rows: actions.map(a => [
        a.goal,
        a.owner,
        a.status.replace('_', ' '),
        a.category,
        a.dueDate ? new Date(a.dueDate).toLocaleDateString('en-GB') : 'N/A',
        formatDateTime(a.createdAt),
      ]),
    };
  }

  return {
    headers: ['Type', 'Asset Name', 'Reg No', 'Transporter', 'Driver', 'Phone', 'Event Time', 'Location', 'Speed', 'Speed Limit'],
    rows: events.map(e => [
      getEventName(e),
      e.assetName || 'N/A',
      e.regNo || 'N/A',
      e.transporter || 'N/A',
      displayDriverName(e.driverName, 'N/A'),
      e.driverPhone || 'N/A',
      formatDateTime(e.eventTime || e.timestamp),
      formatLocation(e),
      e.speed != null ? Math.round(e.speed).toString() : 'N/A',
      e.speedLimit != null ? Math.round(e.speedLimit).toString() : 'N/A',
    ]),
  };
}

function filterExportRows(rows: string[][], searchTerm: string) {
  const query = searchTerm.trim().toLowerCase();
  if (!query) return rows;

  return rows.filter(row => row.some(cell => String(cell).toLowerCase().includes(query)));
}

function downloadCsv(filename: string, headers: string[], rows: string[][]) {
  const encode = (value: string, header?: string) => {
    const escaped = String(value).replace(/"/g, '""');
    if (header && TEXT_FORCE_HEADERS.includes(header) && escaped !== 'N/A') return `"=""${escaped}"""`;
    return `"${escaped}"`;
  };
  const csv = '\uFEFF' + [
    headers.map(h => encode(h)),
    ...rows.map(row => row.map((cell, i) => encode(cell, headers[i]))),
  ].map(row => row.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

async function downloadExcel(filename: string, sheetName: string, headers: string[], rows: string[][]) {
  const { XLSX } = await loadExportLibs();
  const wb = XLSX.utils.book_new();
  const wsData = [
    headers,
    ...rows.map(row => row.map((cell, i) => (
      TEXT_FORCE_HEADERS.includes(headers[i]) && cell !== 'N/A' ? { v: cell, t: 's' } : cell
    ))),
  ];
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

async function downloadPdf(filename: string, process: (typeof REPORT_PROCESSES)[number], headers: string[], rows: string[][]) {
  const { jsPDF, autoTable } = await loadExportLibs();
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  doc.setFontSize(16);
  doc.setTextColor(51, 65, 85);
  doc.text(process.title, 14, 16);
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text(`${process.cadence} | Generated ${new Date().toLocaleString('en-GB')} | ${rows.length} row${rows.length !== 1 ? 's' : ''}`, 14, 23);
  doc.text(process.description, 14, 29);

  autoTable(doc, {
    head: [headers],
    body: rows,
    startY: 36,
    styles: { fontSize: 7, cellPadding: 2, overflow: 'linebreak' },
    headStyles: { fillColor: [241, 245, 249], textColor: [71, 85, 105], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
  });

  doc.save(`${filename}.pdf`);
}

function ReportDownloadCenter({ events, actions }: { events: LogEntry[]; actions: Action[] }) {
  const [selectedProcess, setSelectedProcess] = useState<ReportProcessId>('weekly');
  const [format, setFormat] = useState<ReportFormat>('pdf');
  const [searchTerm, setSearchTerm] = useState('');
  const [error, setError] = useState('');
  const process = REPORT_PROCESSES.find(p => p.id === selectedProcess) || REPORT_PROCESSES[0];
  const processEvents = getProcessEvents(events, process);
  const summary = summarizeEvents(processEvents);
  const exportData = buildProcessExport(process, processEvents, actions);
  const filteredRows = filterExportRows(exportData.rows, searchTerm);
  const filteredExportData = { headers: exportData.headers, rows: filteredRows };
  const previewRows = filteredRows.slice(0, 5);
  const rowCount = filteredRows.length;
  const totalRowCount = exportData.rows.length;
  const hasSearch = searchTerm.trim().length > 0;

  const handleDownload = async () => {
    setError('');
    try {
      const filename = `cnl-${process.id}-report-${new Date().toISOString().slice(0, 10)}`;
      if (format === 'csv') downloadCsv(filename, filteredExportData.headers, filteredExportData.rows);
      else if (format === 'excel') await downloadExcel(filename, process.title, filteredExportData.headers, filteredExportData.rows);
      else await downloadPdf(filename, process, filteredExportData.headers, filteredExportData.rows);
    } catch (err) {
      console.error('Report download failed:', err);
      setError('Could not generate the selected report. Please confirm the export libraries loaded and try again.');
    }
  };

  const metricCards = process.id === 'actions'
    ? [
        { label: 'Pending', value: actions.filter(a => a.status === 'pending').length, color: '#d97706' },
        { label: 'In Progress', value: actions.filter(a => a.status === 'in_progress').length, color: '#0078D4' },
        { label: 'Complete', value: actions.filter(a => a.status === 'complete').length, color: '#16a34a' },
      ]
    : [
        { label: 'Events', value: summary.total, color: process.accent },
        { label: 'Harsh Braking', value: summary.harshBraking, color: '#CC0000' },
        { label: 'Overspeed', value: summary.overspeeding, color: '#d97706' },
      ];

  return (
    <div className="bpl-card" style={{ overflow: 'hidden', border: '1px solid color-mix(in srgb, var(--cd-border) 80%, #64748B 20%)' }}>
      <div className="bpl-card-header" style={{ alignItems: 'flex-start', gap: 16 }}>
        <div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '4px 10px', borderRadius: 999, background: 'rgba(100,116,139,0.1)', color: 'var(--cd-text-muted)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
            <FileText size={13} /> Evidence Export Hub
          </div>
          <div className="bpl-card-title" style={{ fontSize: 18 }}>Download defined review processes</div>
          <div style={{ fontSize: 13, color: 'var(--cd-text-muted)', marginTop: 4, maxWidth: 640 }}>
            Select a reporting process, review the live evidence set, then export a board-ready CSV, Excel, or PDF pack.
          </div>
        </div>
        <button className="bpl-btn-danger" onClick={handleDownload} disabled={rowCount === 0} style={{ opacity: rowCount === 0 ? 0.55 : 1, cursor: rowCount === 0 ? 'not-allowed' : 'pointer', minHeight: 40 }}>
          <Download size={15} /> Download {format.toUpperCase()}
        </button>
      </div>

      <div className="bpl-card-body" style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 0.95fr) minmax(320px, 1.05fr)', gap: 18 }}>
        <div style={{ display: 'grid', gap: 10 }}>
          {REPORT_PROCESSES.map(item => {
            const selected = item.id === selectedProcess;
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => setSelectedProcess(item.id)}
                style={{
                  textAlign: 'left',
                  padding: 14,
                  borderRadius: 12,
                  border: selected ? `1px solid ${item.accent}` : '1px solid var(--cd-border)',
                  background: selected ? `linear-gradient(135deg, ${item.accent}14, var(--cd-surface))` : 'var(--cd-surface-2)',
                  cursor: 'pointer',
                  transition: 'border-color 180ms ease, background 180ms ease',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <span style={{ width: 34, height: 34, borderRadius: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: `${item.accent}16`, color: item.accent }}>
                    <Icon size={17} />
                  </span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--cd-text)', fontFamily: 'var(--cd-font-display)' }}>{item.title}</div>
                    <div style={{ fontSize: 11, color: 'var(--cd-text-muted)' }}>{item.cadence}</div>
                  </div>
                </div>
                <div style={{ fontSize: 12, color: 'var(--cd-text-muted)', lineHeight: 1.5 }}>{item.description}</div>
              </button>
            );
          })}
        </div>

        <div style={{ display: 'grid', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            {metricCards.map(card => (
              <div key={card.label} style={{ border: '1px solid var(--cd-border)', borderRadius: 12, padding: 14, background: 'var(--cd-surface-2)' }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--cd-text-muted)', marginBottom: 6 }}>{card.label}</div>
                <div style={{ fontSize: 28, lineHeight: 1, fontWeight: 700, color: card.color, fontFamily: 'var(--cd-font-display)' }}>{card.value}</div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--cd-text)', fontFamily: 'var(--cd-font-display)' }}>{process.title}</div>
              <div style={{ fontSize: 12, color: 'var(--cd-text-muted)' }}>
                {hasSearch ? `${rowCount} of ${totalRowCount}` : rowCount} export row{rowCount !== 1 ? 's' : ''} ready
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {(['csv', 'excel', 'pdf'] as ReportFormat[]).map(f => (
                <button
                  key={f}
                  onClick={() => setFormat(f)}
                  style={{
                    padding: '7px 13px',
                    borderRadius: 999,
                    border: format === f ? '1px solid var(--bpl-blue)' : '1px solid var(--cd-border)',
                    background: format === f ? 'var(--bpl-blue-soft)' : 'var(--cd-surface-2)',
                    color: format === f ? 'var(--bpl-blue)' : 'var(--cd-text-muted)',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                    textTransform: 'uppercase',
                  }}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="report-export-search" style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--cd-text-muted)', display: 'block', marginBottom: 6 }}>
              Search export data
            </label>
            <div style={{ position: 'relative' }}>
              <Search size={15} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--cd-text-muted)' }} />
              <input
                id="report-export-search"
                type="search"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                placeholder="Search driver, reg no, asset, transporter, event, location..."
                style={{
                  width: '100%',
                  minHeight: 40,
                  padding: hasSearch ? '9px 38px 9px 34px' : '9px 12px 9px 34px',
                  borderRadius: 10,
                  border: '1px solid var(--cd-border)',
                  background: 'var(--cd-surface-2)',
                  color: 'var(--cd-text)',
                  fontSize: 13,
                  outline: 'none',
                }}
              />
              {hasSearch && (
                <button
                  type="button"
                  aria-label="Clear report search"
                  onClick={() => setSearchTerm('')}
                  style={{
                    position: 'absolute',
                    right: 8,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    width: 26,
                    height: 26,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 999,
                    border: '1px solid var(--cd-border)',
                    background: 'var(--cd-surface)',
                    color: 'var(--cd-text-muted)',
                    cursor: 'pointer',
                  }}
                >
                  <X size={13} />
                </button>
              )}
            </div>
            <div style={{ fontSize: 11, color: 'var(--cd-text-muted)', marginTop: 5 }}>
              {hasSearch ? `Filtering downloads to records matching "${searchTerm.trim()}".` : 'Search applies to the preview and the downloaded file.'}
            </div>
          </div>

          <div style={{ border: '1px solid var(--cd-border)', borderRadius: 12, overflow: 'hidden', background: 'var(--cd-surface)' }}>
            {rowCount === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--cd-text-muted)', fontSize: 13 }}>
                {hasSearch ? 'No records match this search. Clear it or try another driver, vehicle, event, or location.' : 'No records match this process yet. The export will be available once the system has evidence for this period.'}
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="bpl-table">
                  <thead>
                    <tr>
                      {filteredExportData.headers.slice(0, 5).map(h => <th key={h}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, rowIndex) => (
                      <tr key={`${row[0]}-${rowIndex}`}>
                        {row.slice(0, 5).map((cell, cellIndex) => (
                          <td key={`${cell}-${cellIndex}`} style={{ maxWidth: 180, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {error && <div style={{ fontSize: 12, color: '#CC0000', background: 'var(--bpl-red-soft)', border: '1px solid rgba(204,0,0,0.2)', borderRadius: 8, padding: '8px 10px' }}>{error}</div>}
        </div>
      </div>
    </div>
  );
}

function WeeklyReport({ events }: { events: any[] }) {
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const fourteenDaysAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;

  const reportableEvents = events.filter(isReportableEvent);
  const thisWeek = reportableEvents.filter(e => new Date(e.eventTime || e.timestamp).getTime() >= sevenDaysAgo);
  const lastWeek = reportableEvents.filter(e => {
    const t = new Date(e.eventTime || e.timestamp).getTime();
    return t >= fourteenDaysAgo && t < sevenDaysAgo;
  });

  const counts = (evts: any[]) => ({
    harsh_braking: evts.filter(e => e.label === 'Harsh Braking').length,
    overspeeding: evts.filter(e => e.label?.includes('Overspeed')).length,
    harsh_accel: evts.filter(e => e.label === 'Harsh Acceleration').length,
    harsh_cornering: evts.filter(e => e.label === 'Harsh Cornering').length,
    total: evts.length,
  });

  const tw = counts(thisWeek);
  const lw = counts(lastWeek);
  const delta = (a: number, b: number) => b === 0 ? 0 : Math.round(((a - b) / b) * 100);
  const pctChange = delta(tw.total, lw.total);

  const chartData = [
    { name: 'Harsh Braking', 'This Week': tw.harsh_braking, 'Last Week': lw.harsh_braking },
    { name: 'Overspeeding', 'This Week': tw.overspeeding, 'Last Week': lw.overspeeding },
    { name: 'Harsh Accel.', 'This Week': tw.harsh_accel, 'Last Week': lw.harsh_accel },
    { name: 'Harsh Cornering', 'This Week': tw.harsh_cornering, 'Last Week': lw.harsh_cornering },
  ];

  return (
    <div>
      <div className="bpl-kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 16 }}>
        <div className="bpl-kpi-card">
          <div className="bpl-kpi-label">Total Incidents</div>
          <div className="bpl-kpi-value">{tw.total}</div>
          <div className="bpl-kpi-sub">
            {pctChange < 0 ? <span className="bpl-kpi-delta-up">↓ {Math.abs(pctChange)}% vs last week</span> :
             pctChange > 0 ? <span className="bpl-kpi-delta-down">↑ +{pctChange}% vs last week</span> :
             <span>Same as last week</span>}
          </div>
        </div>
        <div className="bpl-kpi-card">
          <div className="bpl-kpi-label">Overspeeding</div>
          <div className="bpl-kpi-value" style={{ color: '#d97706' }}>{tw.overspeeding}</div>
          <div className="bpl-kpi-sub" style={{ color: lw.overspeeding < tw.overspeeding ? '#CC0000' : '#16a34a' }}>
            vs {lw.overspeeding} last week
          </div>
        </div>
        <div className="bpl-kpi-card" style={{ borderTop: '3px solid #CC0000' }}>
          <div className="bpl-kpi-label">Harsh Braking</div>
          <div className="bpl-kpi-value" style={{ color: '#CC0000' }}>{tw.harsh_braking}</div>
          <div className="bpl-kpi-sub" style={{ color: lw.harsh_braking < tw.harsh_braking ? '#CC0000' : '#16a34a' }}>
            vs {lw.harsh_braking} last week
          </div>
        </div>
        <div className="bpl-kpi-card" style={{ borderTop: '3px solid #CC0000' }}>
          <div className="bpl-kpi-label">Harsh Acceleration</div>
          <div className="bpl-kpi-value" style={{ color: '#CC0000' }}>{tw.harsh_accel}</div>
          <div className="bpl-kpi-sub" style={{ color: lw.harsh_accel < tw.harsh_accel ? '#CC0000' : '#16a34a' }}>
            vs {lw.harsh_accel} last week
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div className="bpl-card" style={{ padding: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--cd-text)', marginBottom: 12, fontFamily: 'var(--cd-font-display)' }}>
            Week-over-Week Comparison
          </div>
          {tw.total === 0 && lw.total === 0 ? (
            <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--cd-text-muted)', fontSize: 13 }}>No incident data available</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--cd-border)" />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'var(--cd-text-muted)' }} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--cd-text-muted)' }} />
                <Tooltip contentStyle={{ background: 'var(--cd-surface)', border: '1px solid var(--cd-border)', borderRadius: 8, fontSize: 12 }} />
                <Legend />
                <Bar dataKey="This Week" fill="#CC0000" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Last Week" fill="var(--cd-border)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="bpl-card" style={{ padding: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--cd-text)', marginBottom: 10, fontFamily: 'var(--cd-font-display)' }}>
            Weekly Safety Summary
          </div>
          <div style={{ fontSize: 13, color: 'var(--cd-text)', lineHeight: 1.7 }}>
            {tw.total === 0
              ? 'No incident data available for this period. Connect the MiX Telematics API to populate real fleet data.'
              : `Fleet recorded ${tw.total} safety events this week${lw.total > 0 ? `, compared to ${lw.total} last week (${pctChange > 0 ? `+${pctChange}%` : `${pctChange}%`})` : ''}. ${tw.harsh_braking > 0 ? `Harsh braking remains the leading incident category at ${tw.harsh_braking} events.` : 'No harsh braking events recorded.'} ${tw.overspeeding > 0 ? `${tw.overspeeding} overspeeding event${tw.overspeeding > 1 ? 's' : ''} should be reviewed for coaching or route controls.` : 'No overspeeding events recorded this week.'}`}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ReportsReviews() {
  const { events } = useFleet();
  const { actions } = useActions();

  const pending = actions.filter(a => a.status === 'pending').length;
  const inProgress = actions.filter(a => a.status === 'in_progress').length;
  const complete = actions.filter(a => a.status === 'complete').length;

  return (
    <div>
      <div className="bpl-page-header">
        <h1 className="bpl-page-title">Reports & Reviews</h1>
        <p className="bpl-page-subtitle">Measure improvement, create accountability, and generate ISO 39001 evidence</p>
      </div>

      {/* Action KPIs */}
      <div className="bpl-kpi-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 28 }}>
        <div className="bpl-kpi-card" style={{ borderTop: '3px solid #d97706' }}>
          <div className="bpl-kpi-label">Pending Actions</div>
          <div className="bpl-kpi-value" style={{ color: '#d97706' }}>{pending}</div>
        </div>
        <div className="bpl-kpi-card" style={{ borderTop: '3px solid #0078D4' }}>
          <div className="bpl-kpi-label">In Progress</div>
          <div className="bpl-kpi-value" style={{ color: '#0078D4' }}>{inProgress}</div>
        </div>
        <div className="bpl-kpi-card" style={{ borderTop: '3px solid #16a34a' }}>
          <div className="bpl-kpi-label">Complete</div>
          <div className="bpl-kpi-value" style={{ color: '#16a34a' }}>{complete}</div>
        </div>
      </div>

      {/* Defined Process Downloads */}
      <div style={{ marginBottom: 32 }}>
        <ReportDownloadCenter events={events} actions={actions} />
      </div>

      {/* Weekly Report */}
      <div style={{ marginBottom: 32 }}>
        <SectionHeading title="Weekly Report" subtitle="7-day incident summary and week-over-week comparison" />
        <WeeklyReport events={events} />
      </div>
    </div>
  );
}
