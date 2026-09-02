/**
 * Build CSV / Excel exports for scheduled report automations (server-side).
 */
import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx-js-style';
import { handleEventsLogQuery } from './events-log-api.js';
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

const GPS_SILENCE_TRIGGER_LABEL = 'No recent communication (2 hrs)';

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
  { header: 'Event', get: e => connectivityEventDisplayLabel(e.label || '') },
  { header: 'Note', get: e => e.connectivityNote || '' },
  {
    header: 'Event Time',
    get: e => (e.eventTime ? new Date(e.eventTime).toLocaleString('en-GB') : 'N/A'),
  },
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

const COL_KEYS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

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
    const eventTime = row.triggered_at || row.created_at || new Date().toISOString();
    return {
      eventId: row.id,
      label: row.event_type,
      type: 'warning',
      timestamp: eventTime,
      eventTime,
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

function entriesToTabular(entries, title, meta) {
  return {
    title,
    meta,
    columns: EVENT_COLUMNS.map(c => ({ header: c.header, textForce: c.textForce })),
    rows: entries.map(e => EVENT_COLUMNS.map(c => c.get(e))),
    rowCount: entries.length,
  };
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

function buildExcelBuffer(report) {
  const { columns, rows, title, meta } = report;
  const wb = XLSX.utils.book_new();
  const ws = {};

  const setCell = (col, row, value, style) => {
    ws[`${col}${row}`] = { v: value, t: 's', s: style };
  };

  let rowIdx = 1;
  setCell('A', rowIdx, title, { font: { bold: true, color: { rgb: '0078D4' }, sz: 14 } });
  rowIdx++;
  setCell('A', rowIdx, meta, { font: { color: { rgb: '64748B' }, sz: 10 } });
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

  ws['!ref'] = `A1:${COL_KEYS[Math.max(columns.length - 1, 0)] || 'A'}${rowIdx - 1}`;
  XLSX.utils.book_append_sheet(wb, ws, 'Events');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

/**
 * @returns {{ filename: string, mime: string, contentBase64: string, rowCount: number, meta: string } | null}
 */
export function buildAutomationExport({
  reportConfig,
  title,
  format = 'csv',
  previousSnapshot = null,
  triggerRows = null,
  now = new Date(),
}) {
  if (!reportConfig || reportConfig.reportType !== 'events') return null;

  const entries = Array.isArray(triggerRows)
    ? pendingTriggerRowsToEntries(triggerRows)
    : collectEventEntries(reportConfig, { now, previousSnapshot });
  const windowPhrase = Array.isArray(triggerRows)
    ? `New arrivals since last send`
    : reportingWindowLabel(reportConfig);
  const eventLabel = Array.isArray(triggerRows)
    ? GPS_SILENCE_TRIGGER_LABEL
    : normalizeAutomationEventType(reportConfig.eventType) || 'All event types';
  const meta = [
    `Window: ${windowPhrase}`,
    `Event: ${eventLabel}`,
    reportConfig.search ? `Search: ${reportConfig.search}` : '',
    reportConfig.site ? `Site: ${reportConfig.site}` : '',
  ].filter(Boolean).join('  ·  ');

  const report = pruneTabularColumns(entriesToTabular(
    entries,
    Array.isArray(triggerRows) ? GPS_SILENCE_TRIGGER_LABEL : title || 'Fleet report',
    meta,
  ));
  const stamp = new Date().toISOString().slice(0, 10);
  const base = `${slugTitle(report.title)}-${stamp}`;
  const fmt = String(format || 'csv').toLowerCase();

  if (fmt === 'excel') {
    const buffer = buildExcelBuffer(report);
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
