import XLSX from 'xlsx-js-style';
import { displayDriverName } from './driverUtils';
import { brandLabel } from './branding';
import { DEMO_BRANDING, demoPhoneLabel } from '../config/demoBranding';
import { authFetchInit } from './authApi';
import type { ReportColumn, TabularReport } from './reportTypes';
import { connectivityEventDisplayLabel } from './reports/eventTypeCatalog';
import { pruneTabularColumns } from './reports/pruneTabularColumns';

export interface LogEntry {
  timestamp: string;
  assetId: string;
  driverId?: string;
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
  connectivityNote?: string;
}

export type ExportFormat = 'csv' | 'excel' | 'pdf';

const EVENT_COLUMNS: { header: string; get: (e: LogEntry) => string; textForce?: boolean }[] = [
  { header: 'Asset Name', get: (e) => brandLabel(e.assetName) || 'N/A' },
  { header: 'Reg No', get: (e) => e.regNo || 'N/A', textForce: true },
  { header: 'Transporter', get: (e) => brandLabel(e.transporter) || 'N/A' },
  { header: 'Driver', get: (e) => displayDriverName(e.driverName, 'N/A') },
  { header: 'Phone', get: (e) => scrubPhone(e.driverPhone), textForce: true },
  { header: 'Event', get: (e) => connectivityEventDisplayLabel(e.label || '') },
  { header: 'Note', get: (e) => e.connectivityNote || '' },
  { header: 'Event Time', get: (e) => (e.eventTime ? new Date(e.eventTime).toLocaleString('en-GB') : 'N/A') },
  {
    header: 'Location',
    get: (e) => {
      if (e.address && e.address !== 'N/A' && e.address !== 'null') return brandLabel(e.address);
      return 'N/A';
    },
  },
];

function scrubPhone(phone?: string) {
  if (!phone) return 'N/A';
  if (!DEMO_BRANDING) return phone;
  return demoPhoneLabel(phone);
}

const COL_KEYS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

function fileStamp() {
  return new Date().toISOString().slice(0, 10);
}

function slugTitle(reportTitle: string) {
  return reportTitle.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]+/g, '');
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

export function logEntriesToTabular(
  entries: LogEntry[],
  reportTitle: string,
  meta: string,
): TabularReport {
  return {
    reportType: 'events',
    title: reportTitle,
    meta,
    columns: EVENT_COLUMNS.map(c => ({ header: c.header, textForce: c.textForce })),
    rows: entries.map(e => EVENT_COLUMNS.map(c => c.get(e))),
    rowCount: entries.length,
    archiveType: 'Events',
  };
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

function buildCsvBlob(columns: ReportColumn[], rows: string[][]) {
  const headers = columns.map(c => `"${c.header}"`);
  const body = rows.map(row =>
    row.map((val, i) => {
      const escaped = String(val).replace(/"/g, '""');
      if (columns[i]?.textForce && val !== 'N/A') return `"=""${escaped}"""`;
      return `"${escaped}"`;
    }),
  );
  const csv = '\uFEFF' + [headers, ...body].map(r => r.join(',')).join('\n');
  return new Blob([csv], { type: 'text/csv;charset=utf-8;' });
}

function buildExcelBlob(report: TabularReport) {
  const { columns, rows, title, meta } = report;
  const wb = XLSX.utils.book_new();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ws: any = {};

  const setCell = (col: string, row: number, value: string, style: object) => {
    ws[`${col}${row}`] = { v: value, t: 's', s: style };
  };

  let rowIdx = 1;
  setCell('A', rowIdx, title, {
    font: { bold: true, color: { rgb: '0078D4' }, sz: 14 },
  });
  rowIdx++;
  setCell('A', rowIdx, meta, {
    font: { color: { rgb: '64748B' }, sz: 10 },
  });
  rowIdx += 2;

  columns.forEach((col, i) => {
    const key = COL_KEYS[i] || `A${i}`;
    setCell(key, rowIdx, col.header, {
      font: { bold: true, color: { rgb: '64748B' }, sz: 10 },
      fill: { fgColor: { rgb: 'F1F5F9' } },
    });
  });
  rowIdx++;

  rows.forEach(row => {
    row.forEach((val, i) => {
      const key = COL_KEYS[i] || `A${i}`;
      setCell(key, rowIdx, String(val), {
        font: { color: { rgb: '1E293B' } },
        fill: { fgColor: { rgb: 'FFFFFF' } },
        border: { bottom: { style: 'thin', color: { rgb: 'E2E8F0' } } },
      });
    });
    rowIdx++;
  });

  const lastCol = COL_KEYS[Math.max(0, columns.length - 1)] || 'A';
  ws['!ref'] = `A1:${lastCol}${rowIdx}`;
  ws['!cols'] = columns.map(c => ({ wch: c.width || Math.max(12, c.header.length + 2) }));

  XLSX.utils.book_append_sheet(wb, ws, 'Fleet Report');
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([out], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

async function buildPdfBlob(report: TabularReport) {
  const { default: jsPDF } = await import('jspdf');
  const { default: autoTable } = await import('jspdf-autotable');

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  doc.setFontSize(16);
  doc.setTextColor(0, 120, 212);
  doc.text(report.title, 14, 16);

  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text(
    `Generated: ${new Date().toLocaleString('en-GB')} • ${report.rowCount} row${report.rowCount !== 1 ? 's' : ''}`,
    14,
    23,
  );
  doc.text(report.meta, 14, 29);

  autoTable(doc, {
    head: [report.columns.map(c => c.header)],
    body: report.rows,
    startY: 34,
    styles: { fontSize: 7, cellPadding: 2 },
    headStyles: {
      fillColor: [241, 245, 249],
      textColor: [100, 116, 139],
      fontStyle: 'bold',
      fontSize: 7,
    },
    alternateRowStyles: { fillColor: [248, 250, 252] },
  });

  return doc.output('blob');
}

export async function buildTabularReportBlob(
  report: TabularReport,
  format: ExportFormat,
): Promise<{ blob: Blob; filename: string; mime: string }> {
  const pruned = pruneTabularColumns(report);
  const stamp = fileStamp();
  const base = `${slugTitle(pruned.title)}-${stamp}`;

  if (format === 'csv') {
    return {
      blob: buildCsvBlob(pruned.columns, pruned.rows),
      filename: `${base}.csv`,
      mime: 'text/csv;charset=utf-8',
    };
  }
  if (format === 'excel') {
    return {
      blob: buildExcelBlob(pruned),
      filename: `${base}.xlsx`,
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }
  return {
    blob: await buildPdfBlob(pruned),
    filename: `${base}.pdf`,
    mime: 'application/pdf',
  };
}

export async function exportTabularReport(report: TabularReport, format: ExportFormat) {
  const { blob, filename, mime } = await buildTabularReportBlob(report, format);
  triggerBrowserDownload(blob, filename);
  void archiveReportDownload({
    filename,
    mime,
    blob,
    type: report.archiveType,
    meta: {
      reportTitle: report.title,
      filters: report.meta,
      format,
      reportType: report.reportType,
      rowCount: report.rowCount,
    },
  });
}

/** @deprecated prefer buildTabularReportBlob(logEntriesToTabular(...)) */
export async function buildReportBlob(
  entries: LogEntry[],
  format: ExportFormat,
  reportTitle: string,
  meta: string,
): Promise<{ blob: Blob; filename: string; mime: string }> {
  return buildTabularReportBlob(logEntriesToTabular(entries, reportTitle, meta), format);
}

export async function exportReport(
  entries: LogEntry[],
  format: ExportFormat,
  reportTitle: string,
  meta: string,
) {
  await exportTabularReport(logEntriesToTabular(entries, reportTitle, meta), format);
}
