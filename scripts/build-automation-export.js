/**
 * Build CSV / Excel exports for scheduled report automations (server-side).
 */
import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';
import { handleEventsLogQuery } from './events-log-api.js';
import { pendingTriggerEffectiveTime } from './connectivity-triggers.js';
import {
  automationOfflineCandidates,
  classifyConnectivity,
  diffRepeatOffenders,
  normalizeConnectivityEventType,
  NO_RECENT_COMMUNICATION,
  trackingWindowHoursFromReportConfig,
} from './connectivity-events.js';
import { connectivityEventDisplayLabel } from './connectivity-labels.js';
import { pruneTabularColumns } from './prune-tabular-columns.js';

const IVMS_EVENT_TYPES = [
  'Harsh Braking',
  'Harsh Acceleration',
  'Overspeeding',
  'Overspeed Tiered',
  'Harsh Cornering',
];

const CONNECTIVITY_EVENT_TYPES = [NO_RECENT_COMMUNICATION, 'Offline', 'Non-Operational'];

const HIDDEN_LABELS = new Set([
  'Possible Power Tamper',
  'Battery Disconnection',
  'Battery Disconnected',
  'Front Panel Tamper',
  'Back Panel Tamper',
  'No Blue Key',
]);

const EVENT_COLUMNS = [
  { header: 'Asset Name', get: e => e.assetName || 'N/A' },
  { header: 'Reg No', get: e => e.regNo || 'N/A', textForce: true },
  { header: 'Transporter', get: e => e.transporter || 'N/A' },
  { header: 'Driver', get: e => e.driverName || 'N/A' },
  { header: 'Phone', get: e => e.driverPhone || 'N/A', textForce: true },
  { header: 'Event', get: e => shortEventLabel(e.label || '') },
  { header: 'Note', get: e => e.connectivityNote || '' },
  {
    header: 'Event Time',
    get: e => formatLagosDateTime(e.eventTime),
  },
  { header: 'Inactive window', get: e => e.inactiveWindow || '' },
  {
    header: 'Last location',
    get: e => {
      const addr = e.address;
      if (addr && addr !== 'N/A' && addr !== 'null') return addr;
      return 'N/A';
    },
  },
  { header: 'Remark', get: () => '' },
];

const LAGOS_TIME_ZONE = 'Africa/Lagos';

function shortEventLabel(label) {
  const normalized = normalizeConnectivityEventType(String(label || '').trim());
  if (normalized === NO_RECENT_COMMUNICATION) return 'NRC >2Hrs';
  return connectivityEventDisplayLabel(normalized);
}

function formatLagosDateTime(value) {
  if (!value) return 'N/A';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return date.toLocaleString('en-GB', {
    timeZone: LAGOS_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function formatLagosDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return date.toLocaleDateString('en-GB', {
    timeZone: LAGOS_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function formatLagosTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return date.toLocaleTimeString('en-GB', {
    timeZone: LAGOS_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatWindowTimeRange(from, to) {
  return `${formatLagosTime(from)} - ${formatLagosTime(to)}`;
}

function formatInactiveWindow(from, to) {
  if (!from || !to) return '';
  const start = formatLagosDateTime(from);
  const end = formatLagosDateTime(to);
  if (start === 'N/A' || end === 'N/A') return '';
  return `${start} -> ${end}`;
}

function reportLogoPath() {
  const candidates = [
    path.join(process.cwd(), 'public', 'BPL logo.png'),
    path.join(process.cwd(), 'public', 'BPL logo.jpg'),
    path.join(process.cwd(), 'public', 'BPL logo.jpeg'),
    path.join(process.cwd(), 'public', 'HBM-logo.png'),
    path.join(process.cwd(), 'public', 'HBM-logo.jpeg'),
  ];
  return candidates.find(file => fs.existsSync(file)) || null;
}

function imageExtension(file) {
  const ext = path.extname(file || '').toLowerCase().replace('.', '');
  if (ext === 'jpg') return 'jpeg';
  if (ext === 'jpeg' || ext === 'png') return ext;
  return 'png';
}

function normalizeAutomationEventType(eventType) {
  return normalizeConnectivityEventType(String(eventType || '').trim());
}

function isConnectivityEventType(label) {
  return CONNECTIVITY_EVENT_TYPES.includes(label);
}

function reportingWindowLabel(config = {}) {
  if (config.windowMode === 'last24h') return 'Last 24 hours';
  const value = Number(config.lookbackValue) || 2;
  const unit = config.lookbackUnit || 'hours';
  const singular = value === 1 ? unit.replace(/s$/, '') : unit;
  return `Last ${value} ${singular}`;
}

function reportingWindowBounds(reportConfig, { now = new Date() } = {}) {
  const end = now instanceof Date ? now : new Date(now);
  if (!reportConfig) {
    return {
      from: new Date(end.getTime() - 24 * 60 * 60 * 1000).toISOString(),
      to: end.toISOString(),
    };
  }
  if (reportConfig.windowMode === 'last24h') {
    return {
      from: new Date(end.getTime() - 24 * 60 * 60 * 1000).toISOString(),
      to: end.toISOString(),
    };
  }
  const unitMs = reportConfig.lookbackUnit === 'weeks'
    ? 7 * 24 * 60 * 60 * 1000
    : reportConfig.lookbackUnit === 'days'
      ? 24 * 60 * 60 * 1000
      : 60 * 60 * 1000;
  const value = Number(reportConfig.lookbackValue) || 2;
  return {
    from: new Date(end.getTime() - value * unitMs).toISOString(),
    to: end.toISOString(),
  };
}

function loadVehicles() {
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), 'public', 'data.json'), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function matchesSearch(entry, search, vehicle) {
  const q = String(search || '').trim().toLowerCase();
  if (!q) return true;
  const hay = [
    entry.regNo,
    entry.assetName,
    entry.assetId,
    entry.transporter,
    entry.site,
    entry.driverName,
    entry.driverPhone,
    vehicle?.status,
  ].filter(Boolean).join(' ').toLowerCase();
  return hay.includes(q);
}

function matchesSite(vehicle, siteKeys) {
  if (!siteKeys?.length) return true;
  const zoneKey = String(vehicle.zone || '').trim();
  const siteKey = String(vehicle.site || '').trim();
  return siteKeys.includes(zoneKey) || (siteKey && siteKeys.includes(siteKey));
}

function buildConnectivityEntries(vehicles, eventType, { siteKeys, search, previousSnapshot, now, windowHours }) {
  const normalized = normalizeAutomationEventType(eventType);
  if (!normalized || !isConnectivityEventType(normalized)) return [];

  const windowH = Math.max(1, windowHours ?? 24);
  const candidateIds = automationOfflineCandidates(vehicles, now, windowH).map(v => String(v.id || ''));
  const repeatIds = new Set(diffRepeatOffenders(previousSnapshot?.assetIds || [], candidateIds));
  const out = [];
  const ts = now.toISOString();
  const nowMs = now.getTime();

  for (const v of vehicles) {
    const bucket = classifyConnectivity(v, { windowHours: windowH, now: nowMs });
    if (bucket !== normalized) continue;
    if (!matchesSite(v, siteKeys)) continue;

    const eventTime = v.date && v.date !== 'N/A' ? v.date : ts;
    const entry = {
      eventId: `connectivity:${v.id}:${bucket}`,
      label: bucket,
      type: 'warning',
      timestamp: eventTime,
      eventTime,
      assetId: String(v.id || ''),
      regNo: v.regNo,
      assetName: v.assetName,
      site: v.site,
      transporter: v.transporter,
      driverName: v.driverName,
      driverPhone: v.driverPhone,
      address: v.address,
      connectivityNote: bucket === 'Offline' && repeatIds.has(String(v.id || ''))
        ? 'Repeat offender'
        : '',
    };
    if (!matchesSearch(entry, search, v)) continue;
    out.push(entry);
  }

  out.sort((a, b) => new Date(b.eventTime).getTime() - new Date(a.eventTime).getTime());
  return out;
}

function collectEventEntries(reportConfig, { now, previousSnapshot } = {}) {
  const eventType = normalizeAutomationEventType(reportConfig.eventType);
  const windowHours = trackingWindowHoursFromReportConfig(reportConfig);
  const { from, to } = reportingWindowBounds(reportConfig, { now });
  const siteKeys = Array.isArray(reportConfig.siteKeys) ? reportConfig.siteKeys : [];
  const search = String(reportConfig.search || '');
  const vehicles = loadVehicles();
  const vehicleById = new Map(vehicles.map(v => [String(v.id), v]));

  const wantsConnectivity = isConnectivityEventType(eventType);
  const wantsIvms = !eventType || (!wantsConnectivity && IVMS_EVENT_TYPES.includes(eventType));
  const wantsAllIvms = !eventType && !wantsConnectivity;

  let ivmsEntries = [];
  if (wantsIvms || wantsAllIvms) {
    const types = eventType && !wantsAllIvms && !wantsConnectivity
      ? eventType
      : undefined;
    const rows = handleEventsLogQuery({
      from,
      to,
      types,
      limit: 'all',
    });
    ivmsEntries = rows
      .filter(e => e.type !== 'panic')
      .filter(e => !HIDDEN_LABELS.has(String(e.label || '').trim()))
      .filter(e => {
        const v = vehicleById.get(String(e.assetId));
        if (!matchesSite(v || { site: e.site, zone: '' }, siteKeys)) return false;
        return matchesSearch(e, search, v);
      });
  }

  let connectivityEntries = [];
  if (wantsConnectivity) {
    connectivityEntries = buildConnectivityEntries(vehicles, eventType, {
      siteKeys,
      search,
      previousSnapshot,
      now,
      windowHours,
    });
  } else if (!eventType) {
    connectivityEntries = CONNECTIVITY_EVENT_TYPES.flatMap(type =>
      buildConnectivityEntries(vehicles, type, { siteKeys, search, previousSnapshot, now, windowHours }),
    );
  }

  return [...ivmsEntries, ...connectivityEntries];
}

function pendingTriggerRowsToEntries(rows = []) {
  return rows.map(row => {
    let vehicle = {};
    try {
      vehicle = row.vehicle_json ? JSON.parse(row.vehicle_json) : {};
    } catch {
      vehicle = {};
    }
    const eventTime = pendingTriggerEffectiveTime(row) || row.created_at || new Date().toISOString();
    return {
      eventId: row.id,
      label: row.event_type,
      type: 'warning',
      timestamp: eventTime,
      eventTime,
      inactiveWindow: formatInactiveWindow(row.last_seen_at, eventTime),
      assetId: String(row.asset_id || ''),
      regNo: vehicle.regNo || vehicle.RegistrationNumber || 'N/A',
      assetName: vehicle.assetName || vehicle.Description || 'N/A',
      site: vehicle.site || vehicle.zone || '',
      transporter: vehicle.transporter || 'N/A',
      driverName: vehicle.driverName || 'N/A',
      driverPhone: vehicle.driverPhone || 'N/A',
      address: vehicle.address || vehicle.position?.address || 'N/A',
      connectivityNote: `Triggered at ${Number(row.threshold_hours).toLocaleString()}h silence`,
    };
  });
}

function entriesToTabular(entries, title, meta, details = {}) {
  return {
    title,
    meta,
    details,
    columns: EVENT_COLUMNS.map(c => ({ header: c.header, textForce: c.textForce })),
    rows: entries.map((e, index) => EVENT_COLUMNS.map(c => c.get(e, index))),
    rowCount: entries.length,
  };
}

function filterTriggerRowsForWindow(rows, windowBounds) {
  if (!Array.isArray(rows) || !windowBounds?.from || !windowBounds?.to) return rows || [];
  const fromMs = new Date(windowBounds.from).getTime();
  const toMs = new Date(windowBounds.to).getTime();
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return rows;
  return rows.filter(row => {
    const effectiveMs = new Date(pendingTriggerEffectiveTime(row) || '').getTime();
    return Number.isFinite(effectiveMs) && effectiveMs >= fromMs && effectiveMs <= toMs;
  });
}

function slugTitle(reportTitle) {
  return String(reportTitle || 'report').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]+/g, '');
}

function buildCsvBuffer(columns, rows) {
  const headers = columns.map(c => `"${c.header}"`);
  const body = rows.map(row =>
    row.map((val, i) => {
      const escaped = String(val).replace(/"/g, '""');
      if (columns[i]?.textForce && val !== 'N/A') return `"=""${escaped}"""`;
      return `"${escaped}"`;
    }),
  );
  const csv = '\uFEFF' + [headers, ...body].map(r => r.join(',')).join('\n');
  return Buffer.from(csv, 'utf8');
}

async function buildExcelBuffer(report) {
  const { columns, rows, title, details = {} } = report;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'HBM Fleet Intelligence';
  wb.created = new Date();
  wb.modified = new Date();
  const ws = wb.addWorksheet('Events', {
    views: [{ showGridLines: false }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1 },
  });
  const excelColumns = [{ header: '#' }, ...columns];
  const excelRows = rows.map((row, index) => [index + 1, ...row]);
  const colCount = Math.max(excelColumns.length, 10);
  const lastCol = colCount - 1;
  const logoStartCol = Math.max(lastCol - 1, 6);

  const argb = rgb => `FF${rgb}`;
  const solidFill = rgb => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: rgb.startsWith('FF') ? rgb : argb(rgb) } });
  const setCell = (row, col, value, style = {}) => {
    const cell = ws.getCell(row, col + 1);
    cell.value = value ?? '';
    Object.assign(cell, style);
    return cell;
  };
  const fillRange = (startRow, endRow, startCol, endCol, style) => {
    for (let row = startRow; row <= endRow; row += 1) {
      for (let col = startCol; col <= endCol; col += 1) setCell(row, col, '', style);
    }
  };

  const blue = '0078D4';
  const blueDark = '005A9E';
  const blueMid = '106EBE';
  const ink = '0F172A';
  const muted = '64748B';
  const grid = 'E5E7EB';
  const soft = 'F7F5FA';
  const dangerSoft = 'FEE2E2';
  const danger = 'B91C1C';
  const topBand = { fill: solidFill(blue) };
  const kpiBand = { fill: solidFill('F8F7FB') };
  const borderBottom = { bottom: { style: 'thin', color: { argb: argb(grid) } } };
  const eventColIndex = excelColumns.findIndex(col => col.header === 'Event');

  fillRange(1, 6, 0, lastCol, topBand);
  fillRange(7, 9, 0, lastCol, kpiBand);
  fillRange(2, 5, logoStartCol, lastCol, { fill: solidFill('FFFFFF') });
  ws.mergeCells(2, 1, 2, Math.min(5, lastCol + 1));
  ws.mergeCells(4, 1, 4, Math.min(2, lastCol + 1));
  ws.mergeCells(4, 3, 4, Math.min(4, lastCol + 1));
  ws.mergeCells(4, 5, 4, Math.min(7, lastCol + 1));
  ws.mergeCells(2, logoStartCol + 1, 5, lastCol + 1);

  setCell(2, 0, title || 'Event Report', {
    font: { bold: true, color: { argb: 'FFFFFFFF' }, size: 18 },
    fill: solidFill(blue),
    alignment: { vertical: 'middle' },
  });
  setCell(4, 0, details.windowLabel || 'Last 1 Hour', {
    font: { bold: true, color: { argb: 'FFFFFFFF' }, size: 9 },
    fill: solidFill(blueMid),
    alignment: { horizontal: 'center', vertical: 'middle' },
  });
  setCell(4, 2, details.siteLabel || 'All Sites', {
    font: { bold: true, color: { argb: 'FFFFFFFF' }, size: 9 },
    fill: solidFill(blueMid),
    alignment: { horizontal: 'center', vertical: 'middle' },
  });
  setCell(4, 4, details.eventTypeFull || details.eventType || 'All event types', {
    font: { bold: true, color: { argb: 'FFFFFFFF' }, size: 9 },
    fill: solidFill(blueDark),
    alignment: { horizontal: 'center', vertical: 'middle' },
  });
  const logoFile = reportLogoPath();
  if (logoFile) {
    const imageId = wb.addImage({ filename: logoFile, extension: imageExtension(logoFile) });
    ws.addImage(imageId, {
      tl: { col: logoStartCol + 0.18, row: 1.18 },
      ext: { width: 170, height: 112 },
      editAs: 'oneCell',
    });
  } else {
    setCell(2, logoStartCol, 'BPL', {
      font: { bold: true, italic: true, color: { argb: argb(blueDark) }, size: 22 },
      fill: solidFill('FFFFFF'),
      alignment: { horizontal: 'center', vertical: 'middle' },
    });
    setCell(4, logoStartCol, 'LOGISTICS & SUPPLY CHAIN MANAGEMENT', {
      font: { bold: true, color: { argb: argb(danger) }, size: 8 },
      fill: solidFill('FFFFFF'),
      alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
    });
  }

  const kpis = [
    ['TOTAL EVENTS', details.totalEvents ?? rows.length],
    ['EVENT TYPE', details.eventType || 'All event types'],
    ['REPORT DATE', details.reportDate || formatLagosDate(new Date())],
    ['WINDOW', details.window || 'N/A'],
  ];
  kpis.forEach(([label, value], index) => {
    const col = Math.min(index * 2, lastCol);
    setCell(8, col, label, {
      font: { color: { argb: argb(muted) }, size: 9 },
      fill: solidFill('F8F7FB'),
      alignment: { vertical: 'middle' },
    });
    setCell(9, col, value, {
      font: { bold: true, color: { argb: argb(index === 1 ? danger : blueDark) }, size: 14 },
      fill: solidFill('F8F7FB'),
      alignment: { vertical: 'middle' },
    });
  });

  let rowIdx = 11;
  excelColumns.forEach((col, i) => {
    setCell(rowIdx, i, col.header.toUpperCase(), {
      font: { bold: true, color: { argb: 'FFFFFFFF' }, size: 9 },
      fill: solidFill(blueDark),
      alignment: { horizontal: i === 0 ? 'center' : 'left', vertical: 'middle', wrapText: true },
    });
  });
  rowIdx++;

  excelRows.forEach((row, rowOffset) => {
    row.forEach((val, i) => {
      const isEvent = i === eventColIndex;
      const fill = rowOffset % 2 === 0 ? 'FFFFFF' : soft;
      const cellStyle = {
        font: { bold: isEvent, color: { argb: argb(isEvent ? danger : ink) }, size: isEvent ? 8 : 10 },
        fill: solidFill(isEvent ? dangerSoft : fill),
        border: borderBottom,
        alignment: {
          horizontal: i === 0 || isEvent ? 'center' : 'left',
          vertical: 'middle',
          wrapText: true,
        },
      };
      setCell(rowIdx, i, excelColumns[i]?.textForce ? String(val) : val, cellStyle);
    });
    rowIdx++;
  });

  Array.from({ length: colCount }, (_, index) => {
    const col = excelColumns[index] || {};
    const widths = {
      '#': 5,
      'Asset Name': 28,
      'Reg No': 14,
      Transporter: 24,
      Driver: 22,
      Phone: 16,
      Event: 16,
      Note: 22,
      'Event Time': 22,
      'Inactive window': 38,
      'Last location': 32,
      Remark: 18,
    };
    ws.getColumn(index + 1).width = widths[col.header] || 16;
  });
  [20, 28, 18, 24, 22, 18, 14, 16, 24, 10, 28].forEach((height, index) => {
    ws.getRow(index + 1).height = height;
  });
  ws.autoFilter = {
    from: { row: 11, column: 1 },
    to: { row: Math.max(rowIdx - 1, 11), column: excelColumns.length },
  };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/**
 * @returns {{ filename: string, mime: string, contentBase64: string, rowCount: number, meta: string } | null}
 */
export async function buildAutomationExport({
  reportConfig,
  title,
  format = 'csv',
  previousSnapshot = null,
  triggerRows = null,
  now = new Date(),
}) {
  if (!reportConfig || reportConfig.reportType !== 'events') return null;

  const sendAt = now instanceof Date ? now : new Date(now);
  const triggerExport = Array.isArray(triggerRows);
  const windowBounds = triggerExport
    ? {
      from: new Date(sendAt.getTime() - 60 * 60 * 1000).toISOString(),
      to: sendAt.toISOString(),
    }
    : reportingWindowBounds(reportConfig, { now: sendAt });
  const scopedTriggerRows = triggerExport
    ? filterTriggerRowsForWindow(triggerRows, windowBounds)
    : null;
  const entries = scopedTriggerRows
    ? pendingTriggerRowsToEntries(scopedTriggerRows)
    : collectEventEntries(reportConfig, { now: sendAt, previousSnapshot });
  const windowPhrase = triggerExport
    ? `Last 1 Hour`
    : reportingWindowLabel(reportConfig);
  const normalizedEventType = triggerExport
    ? NO_RECENT_COMMUNICATION
    : normalizeAutomationEventType(reportConfig.eventType);
  const eventLabel = triggerExport
    ? 'NRC >2Hrs'
    : shortEventLabel(normalizedEventType || 'All event types');
  const eventLabelFull = triggerExport
    ? 'No Recent Communication > 2Hrs'
    : connectivityEventDisplayLabel(normalizedEventType || 'All event types');
  const siteLabel = reportConfig.site
    || (Array.isArray(reportConfig.siteKeys) && reportConfig.siteKeys.length ? 'Selected Sites' : 'All Sites');
  const meta = [
    `Window: ${windowPhrase} (${formatWindowTimeRange(windowBounds.from, windowBounds.to)})`,
    `Event: ${eventLabel}`,
    reportConfig.search ? `Search: ${reportConfig.search}` : '',
    `Site: ${siteLabel}`,
  ].filter(Boolean).join('  ·  ');
  const details = {
    totalEvents: entries.length,
    eventType: eventLabel,
    eventTypeFull: eventLabelFull,
    reportDate: formatLagosDate(sendAt),
    window: formatWindowTimeRange(windowBounds.from, windowBounds.to),
    windowLabel: windowPhrase,
    siteLabel,
  };

  const report = pruneTabularColumns(entriesToTabular(
    entries,
    triggerExport ? 'Event Report' : title || 'Event Report',
    meta,
    details,
  ));
  const stamp = new Date().toISOString().slice(0, 10);
  const base = `${slugTitle(report.title)}-${stamp}`;
  const fmt = String(format || 'csv').toLowerCase();

  if (fmt === 'excel') {
    const buffer = await buildExcelBuffer(report);
    return {
      filename: `${base}.xlsx`,
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      contentBase64: buffer.toString('base64'),
      rowCount: report.rowCount,
      meta,
    };
  }

  const buffer = buildCsvBuffer(report.columns, report.rows);
  return {
    filename: `${base}.csv`,
    mime: 'text/csv;charset=utf-8',
    contentBase64: buffer.toString('base64'),
    rowCount: report.rowCount,
    meta,
  };
}
