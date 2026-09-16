/**
 * Server-side report export — pages all matching events so downloads are complete
 * (not capped by the 10k one-shot browser dump).
 */
import { handleEventsLogQuery } from './events-log-api.js';

const PAGE_SIZE = 1000;
/** Soft safety ceiling — ~1 year of HBM warnings is far below this. */
const MAX_EXPORT_ROWS = 500_000;

const HIDDEN_LABELS = new Set([
  'Possible Power Tamper',
  'Battery Disconnection',
  'Battery Disconnected',
  'Front Panel Tamper',
  'Back Panel Tamper',
  'No Blue Key',
]);

const EVENT_HEADERS = [
  'Asset Name',
  'Reg No',
  'Transporter',
  'Driver',
  'Phone',
  'Event',
  'Note',
  'Event Time',
  'Last location',
  'Remark',
];

function csvEscape(val, textForce = false) {
  const s = String(val ?? '');
  const escaped = s.replace(/"/g, '""');
  if (textForce && s && s !== 'N/A') return `"=""${escaped}"""`;
  return `"${escaped}"`;
}

function formatEventTime(iso) {
  if (!iso) return 'N/A';
  try {
    return new Date(iso).toLocaleString('en-GB');
  } catch {
    return String(iso);
  }
}

function rowFromEntry(e) {
  const address = e.address && e.address !== 'N/A' && e.address !== 'null' ? e.address : 'N/A';
  return [
    e.assetName || 'N/A',
    e.regNo || 'N/A',
    e.transporter || 'N/A',
    e.driverName || 'N/A',
    e.driverPhone || 'N/A',
    e.label || '',
    e.connectivityNote || '',
    formatEventTime(e.eventTime || e.timestamp),
    address,
    '',
  ];
}

function matchesSearch(entry, q) {
  if (!q) return true;
  const s = q.toLowerCase();
  return (
    (entry.regNo && entry.regNo !== 'N/A' && entry.regNo.toLowerCase().includes(s))
    || (entry.assetName && entry.assetName.toLowerCase().includes(s))
    || (entry.assetId && String(entry.assetId).toLowerCase().includes(s))
    || (entry.driverName && entry.driverName !== 'N/A' && entry.driverName.toLowerCase().includes(s))
    || (entry.label && entry.label.toLowerCase().includes(s))
  );
}

/**
 * Page through /events/log until every matching row is collected (complete export).
 */
export function collectAllEventEntries(query = {}) {
  const rows = [];
  let offset = 0;
  let total = Infinity;

  while (offset < total && rows.length < MAX_EXPORT_ROWS) {
    const page = handleEventsLogQuery({
      ...query,
      format: 'page',
      limit: String(PAGE_SIZE),
      offset: String(offset),
    });
    const entries = Array.isArray(page?.entries) ? page.entries : [];
    total = Number.isFinite(Number(page?.total)) ? Number(page.total) : entries.length;
    if (!entries.length) break;

    for (const e of entries) {
      if (e?.type === 'panic') continue;
      const label = String(e?.label || '').trim();
      if (HIDDEN_LABELS.has(label)) continue;
      rows.push(e);
      if (rows.length >= MAX_EXPORT_ROWS) break;
    }

    offset += entries.length;
    // Do not assume entries.length === requested PAGE_SIZE — /events/log page
    // mode may enforce a lower max. Stop only when the API has no more rows.
    if (offset >= total) break;
  }

  return rows;
}

function buildCsvBuffer(rowArrays) {
  // Match client reportExport.buildCsvBlob: headers + rows only (no title/meta preamble).
  const lines = [
    EVENT_HEADERS.map((h, i) => csvEscape(h, i === 1 || i === 4)).join(','),
    ...rowArrays.map(row => row.map((cell, i) => csvEscape(cell, i === 1 || i === 4)).join(',')),
  ];
  return Buffer.from(`\uFEFF${lines.join('\n')}`, 'utf8');
}

async function buildExcelBuffer(title, meta, rowArrays) {
  const XLSX = (await import('xlsx-js-style')).default;
  const aoa = [
    [title],
    [meta],
    [],
    EVENT_HEADERS,
    ...rowArrays,
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Events');
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

function normalizeExtraEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.type === 'panic') return null;
  const label = String(raw.label || '').trim();
  if (!label || HIDDEN_LABELS.has(label)) return null;
  return {
    assetName: raw.assetName,
    regNo: raw.regNo,
    transporter: raw.transporter,
    driverName: raw.driverName,
    driverPhone: raw.driverPhone,
    label,
    connectivityNote: raw.connectivityNote || '',
    eventTime: raw.eventTime || raw.timestamp,
    timestamp: raw.timestamp || raw.eventTime,
    address: raw.address,
    assetId: raw.assetId,
  };
}

/**
 * @param {{
 *   reportType?: string,
 *   format?: 'csv'|'excel',
 *   from?: string|null,
 *   to?: string|null,
 *   types?: string|null,
 *   assetIds?: string|null,
 *   siteScope?: string|null,
 *   sites?: string|null,
 *   q?: string|null,
 *   search?: string|null,
 *   title?: string,
 *   meta?: string,
 *   includeIvms?: boolean,
 *   extraEntries?: object[],
 * }} opts
 */
export async function buildEventsReportExport(opts = {}) {
  const format = String(opts.format || 'csv').toLowerCase() === 'excel' ? 'excel' : 'csv';
  const title = opts.title || 'HBM Events Report';
  const meta = opts.meta || '';
  const q = (opts.q || opts.search || '').trim();
  const includeIvms = opts.includeIvms !== false;

  let entries = [];
  if (includeIvms) {
    entries = collectAllEventEntries({
      from: opts.from || null,
      to: opts.to || null,
      types: opts.types || null,
      assetIds: opts.assetIds || null,
      siteScope: opts.siteScope || opts.sites || null,
      sites: opts.sites || null,
      q: q || null,
      excludeHidden: '1',
    });
    // Extra client-style search pass (label etc.) when q was also sent to SQL.
    if (q) entries = entries.filter(e => matchesSearch(e, q));
  }

  const extras = Array.isArray(opts.extraEntries) ? opts.extraEntries : [];
  for (const raw of extras) {
    if (entries.length >= MAX_EXPORT_ROWS) break;
    const e = normalizeExtraEntry(raw);
    if (!e) continue;
    if (q && !matchesSearch(e, q)) continue;
    entries.push(e);
  }

  const rowArrays = entries.map(rowFromEntry);
  const stamp = new Date().toISOString().slice(0, 10);
  const slug = title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]+/g, '').slice(0, 60) || 'events';

  if (format === 'excel') {
    const buffer = await buildExcelBuffer(title, meta, rowArrays);
    return {
      buffer,
      filename: `${slug}-${stamp}.xlsx`,
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      rowCount: rowArrays.length,
      truncated: rowArrays.length >= MAX_EXPORT_ROWS,
    };
  }

  const buffer = buildCsvBuffer(rowArrays);
  return {
    buffer,
    filename: `${slug}-${stamp}.csv`,
    mime: 'text/csv;charset=utf-8',
    rowCount: rowArrays.length,
    truncated: rowArrays.length >= MAX_EXPORT_ROWS,
  };
}
