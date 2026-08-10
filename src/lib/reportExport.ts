import XLSX from 'xlsx-js-style';
import { displayDriverName } from './driverUtils';
import { authFetchInit } from './authApi';

export interface LogEntry {
  timestamp: string;
  assetId: string;
  regNo?: string;
  assetName?: string;
  site?: string;
  transporter?: string;
  driverName?: string;
  driverPhone?: string;
  address?: string;
  eventId: string;
  label?: string;
  eventTime: string;
  type: 'panic' | 'warning';
}

export type ExportFormat = 'csv' | 'excel' | 'pdf';

const COLUMNS = [
  { header: 'Asset Name', get: (e: LogEntry) => e.assetName || 'N/A' },
  { header: 'Reg No', get: (e: LogEntry) => e.regNo || 'N/A' },
  { header: 'Site', get: (e: LogEntry) => e.site || 'N/A' },
  { header: 'Transporter', get: (e: LogEntry) => e.transporter || 'N/A' },
  { header: 'Driver', get: (e: LogEntry) => displayDriverName(e.driverName, 'N/A') },
  { header: 'Phone', get: (e: LogEntry) => e.driverPhone || 'N/A' },
  { header: 'Event', get: (e: LogEntry) => e.label || 'Unknown' },
  { header: 'Event Time', get: (e: LogEntry) => (e.eventTime ? new Date(e.eventTime).toLocaleString('en-GB') : 'N/A') },
  {
    header: 'Location',
    get: (e: LogEntry) => {
      if (e.address && e.address !== 'N/A' && e.address !== 'null') return e.address;
      return 'N/A';
    },
  },
];

const TEXT_FORCE_COLUMNS = ['Phone', 'Reg No'];
const COL_KEYS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];

function fileStamp() {
  return new Date().toISOString().slice(0, 10);
}

function slugTitle(reportTitle: string) {
  return reportTitle.toLowerCase().replace(/\s+/g, '-');
}

function triggerBrowserDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Shelve a downloaded report into Documents (non-blocking on failure). */
export async function archiveReportDownload(opts: {
  filename: string;
  mime: string;
  blob: Blob;
  type?: string;
  meta?: Record<string, unknown>;
}) {
  try {
    const buffer = await opts.blob.arrayBuffer();
    const contentBase64 = arrayBufferToBase64(buffer);
    const res = await fetch('/api/documents/archive', authFetchInit({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: opts.filename,
        mime: opts.mime,
        contentBase64,
        type: opts.type || 'Events',
        source: 'reports-download',
        meta: opts.meta || null,
      }),
    }));
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.warn('Documents archive failed:', err?.error || res.status);
    }
  } catch (e) {
    console.warn('Documents archive error:', (e as Error)?.message || e);
  }
}

function buildCsvBlob(entries: LogEntry[]) {
  const headers = COLUMNS.map(c => `"${c.header}"`);
  const rows = entries.map(e =>
    COLUMNS.map(c => {
      const val = String(c.get(e));
      const escaped = val.replace(/"/g, '""');
      if (TEXT_FORCE_COLUMNS.includes(c.header) && val !== 'N/A') return `"=""${escaped}"""`;
      return `"${escaped}"`;
    }),
  );
  const csv = '\uFEFF' + [headers, ...rows].map(r => r.join(',')).join('\n');
  return new Blob([csv], { type: 'text/csv;charset=utf-8;' });
}

function buildExcelBlob(entries: LogEntry[], reportTitle: string, meta: string) {
  const wb = XLSX.utils.book_new();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ws: any = {};

  const setCell = (col: string, row: number, value: string, style: object) => {
    ws[`${col}${row}`] = { v: value, t: 's', s: style };
  };

  let rowIdx = 1;
  setCell('A', rowIdx, reportTitle, {
    font: { bold: true, color: { rgb: '0078D4' }, sz: 14 },
  });
  rowIdx++;
  setCell('A', rowIdx, meta, {
    font: { color: { rgb: '64748B' }, sz: 10 },
  });
  rowIdx += 2;

  COLUMNS.forEach((col, i) => {
    setCell(COL_KEYS[i], rowIdx, col.header, {
      font: { bold: true, color: { rgb: '64748B' }, sz: 10 },
      fill: { fgColor: { rgb: 'F1F5F9' } },
    });
  });
  rowIdx++;

  entries.forEach(e => {
    const isPanic = e.type === 'panic';
    const bgColor = isPanic ? 'FEF2F2' : 'FFFBEB';
    const borderColor = isPanic ? 'FECDD3' : 'FDE68A';
    COLUMNS.forEach((col, i) => {
      setCell(COL_KEYS[i], rowIdx, String(col.get(e)), {
        font: { color: { rgb: '1E293B' } },
        fill: { fgColor: { rgb: bgColor } },
        border: { bottom: { style: 'thin', color: { rgb: borderColor } } },
      });
    });
    rowIdx++;
  });

  ws['!ref'] = `A1:I${rowIdx}`;
  ws['!cols'] = [
    { wch: 28 }, { wch: 14 }, { wch: 16 }, { wch: 20 },
    { wch: 22 }, { wch: 18 }, { wch: 20 }, { wch: 22 }, { wch: 45 },
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'Fleet Report');
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([out], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

async function buildPdfBlob(entries: LogEntry[], reportTitle: string, meta: string) {
  const { default: jsPDF } = await import('jspdf');
  const { default: autoTable } = await import('jspdf-autotable');

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  doc.setFontSize(16);
  doc.setTextColor(0, 120, 212);
  doc.text(reportTitle, 14, 16);

  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text(`Generated: ${new Date().toLocaleString('en-GB')} • ${entries.length} event${entries.length !== 1 ? 's' : ''}`, 14, 23);
  doc.text(meta, 14, 29);

  autoTable(doc, {
    head: [COLUMNS.map(c => c.header)],
    body: entries.map(e => COLUMNS.map(c => String(c.get(e)))),
    startY: 34,
    styles: { fontSize: 7, cellPadding: 2 },
    headStyles: { fillColor: [241, 245, 249], textColor: [100, 116, 139], fontStyle: 'bold', fontSize: 7 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 6) {
        const isPanic = entries[data.row.index]?.type === 'panic';
        data.cell.styles.textColor = isPanic ? [200, 16, 46] : [133, 79, 11];
        data.cell.styles.fontStyle = 'bold';
      }
    },
  });

  return doc.output('blob');
}

export async function exportReport(
  entries: LogEntry[],
  format: ExportFormat,
  reportTitle: string,
  meta: string,
) {
  const stamp = fileStamp();
  const base = `${slugTitle(reportTitle)}-${stamp}`;
  let blob: Blob;
  let filename: string;
  let mime: string;

  if (format === 'csv') {
    blob = buildCsvBlob(entries);
    filename = `${base}.csv`;
    mime = 'text/csv;charset=utf-8';
  } else if (format === 'excel') {
    blob = buildExcelBlob(entries, reportTitle, meta);
    filename = `${base}.xlsx`;
    mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  } else {
    blob = await buildPdfBlob(entries, reportTitle, meta);
    filename = `${base}.pdf`;
    mime = 'application/pdf';
  }

  triggerBrowserDownload(blob, filename);
  void archiveReportDownload({
    filename,
    mime,
    blob,
    type: 'Events',
    meta: { reportTitle, filters: meta, format, eventCount: entries.length },
  });
}
