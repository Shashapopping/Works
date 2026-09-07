/**
 * Account-tied report automations — hourly / daily / weekly / monthly via Resend.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getDb } from './db.js';
import { querySafetyEventAggregates } from './event-aggregates.js';
import { sendAutomatedReportEmail, sendReportExportEmail, isEmailConfigured } from './email.js';
import { archiveDocument, archiveOrReplaceAutomationProfile } from './documents.js';
import { buildAutomationExport } from './build-automation-export.js';
import {
  automationOfflineCandidates,
  classifyConnectivity,
  diffRepeatOffenders,
  enrichOfflineVehicle,
  formatOfflineDuration,
  normalizeConnectivityEventType,
  NO_RECENT_COMMUNICATION,
  parseOfflineSnapshot,
  trackingWindowHoursFromReportConfig,
  vehicleDisplayLabel,
} from './connectivity-events.js';
import {
  clearPendingConnectivityTriggers,
  GPS_SILENCE_TRIGGER_HOURS,
  GPS_SILENCE_TRIGGER_LABEL,
  initializeConnectivityTriggerState,
  isTriggerModeConfig,
  listPendingConnectivityTriggers,
  pendingConnectivityTriggerCount,
} from './connectivity-triggers.js';

export const REPORT_PACKS = [
  { id: 'offline_2h', label: 'Offline assets', hint: 'Not receiving GPS (excludes Non-Operational). Repeat offenders flagged across sends.' },
  { id: 'safety_events', label: 'Safety & incidents', hint: 'Event counts and top labels for the period' },
  { id: 'fleet_summary', label: 'Fleet summary', hint: 'Live fleet status snapshot with period incident total' },
];

export const FREQUENCIES = ['hourly', 'daily', 'weekly', 'monthly'];
const LOOKBACK_UNITS = ['hours', 'days', 'weeks'];

function newId() {
  return crypto.randomUUID();
}

function nowIso() {
  return new Date().toISOString();
}

function parseJson(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function rowToAutomation(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title || null,
    enabled: !!row.enabled,
    frequency: row.frequency,
    packs: parseJson(row.packs, []),
    reportConfig: parseJson(row.report_config || 'null', null),
    format: row.format || 'csv',
    recipients: parseJson(row.recipients, []),
    sendHour: row.send_hour,
    dayOfWeek: row.day_of_week,
    dayOfMonth: row.day_of_month,
    timezone: row.timezone,
    lastSentAt: row.last_sent_at,
    nextSendAt: row.next_send_at,
    lastError: row.last_error,
    lastOfflineSnapshot: parseOfflineSnapshot(row.last_offline_snapshot),
    pendingTriggerCount: pendingConnectivityTriggerCount(row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Local wall-clock parts in a timezone (best-effort via Intl). */
function zonedParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map(p => [p.type, p.value]));
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: weekdayMap[parts.weekday] ?? 0,
  };
}

function lastDayOfMonth(year, month1to12) {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

const NIGHT_BATCH_DELIVERY_HOUR = 6;
const NIGHT_WINDOW_START_HOUR = 19;

function isNightSendHour(sendHour) {
  return sendHour >= NIGHT_WINDOW_START_HOUR || sendHour < NIGHT_BATCH_DELIVERY_HOUR;
}

function matchesScheduleDay(parts, frequency, dayOfWeek, dayOfMonth) {
  if (frequency === 'daily') return true;
  if (frequency === 'weekly') return parts.weekday === dayOfWeek;
  if (frequency === 'monthly') {
    if (dayOfMonth === 0) return parts.day === lastDayOfMonth(parts.year, parts.month);
    return parts.day === dayOfMonth;
  }
  return true;
}

function getTimeZoneOffsetMs(date, timeZone) {
  const p = zonedParts(date, timeZone);
  // Interpret local wall-clock parts as if they were UTC, then compare.
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, 0, 0);
  return asUTC - date.getTime();
}

function localToUtcIso({ year, month, day, hour = 0, minute = 0 }, timeZone) {
  const baseUtcMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let utcMs = baseUtcMs;
  // Refine offset once or twice; good enough for fixed-offset zones (e.g. Lagos).
  for (let i = 0; i < 2; i++) {
    const offsetMs = getTimeZoneOffsetMs(new Date(utcMs), timeZone);
    utcMs = baseUtcMs - offsetMs;
  }
  return new Date(utcMs).toISOString();
}

function periodBounds({ frequency, dayOfMonth = 1, timezone = 'Africa/Lagos', now = new Date() }) {
  const end = now;

  if (frequency === 'hourly') {
    return {
      from: new Date(end.getTime() - 60 * 60 * 1000).toISOString(),
      to: end.toISOString(),
    };
  }

  if (frequency === 'daily') {
    return {
      from: new Date(end.getTime() - 86400000).toISOString(),
      to: end.toISOString(),
    };
  }

  if (frequency === 'weekly') {
    return {
      from: new Date(end.getTime() - 7 * 86400000).toISOString(),
      to: end.toISOString(),
    };
  }

  // Monthly: avoid a fixed "30 days" window.
  // dayOfMonth meaning:
  // - 0: end-of-month report window (from 1st of current month)
  // - 1..28: cycle from dayOfMonth in previous month
  const pEnd = zonedParts(end, timezone);

  if (dayOfMonth === 0) {
    const from = localToUtcIso(
      { year: pEnd.year, month: pEnd.month, day: 1, hour: 0, minute: 0 },
      timezone,
    );
    return { from, to: end.toISOString() };
  }

  const prevMonth = pEnd.month === 1 ? 12 : pEnd.month - 1;
  const prevYear = pEnd.month === 1 ? pEnd.year - 1 : pEnd.year;
  const from = localToUtcIso(
    { year: prevYear, month: prevMonth, day: dayOfMonth, hour: 0, minute: 0 },
    timezone,
  );
  return { from, to: end.toISOString() };
}

function normalizeLookbackValue(value) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? Math.min(n, 365) : 2;
}

function normalizeLookbackUnit(unit) {
  return LOOKBACK_UNITS.includes(unit) ? unit : 'hours';
}

function normalizeReportingWindow(config = {}) {
  if (config.windowMode === 'last24h' || config.windowMode === 'customLookback') {
    return {
      windowMode: config.windowMode,
      lookbackValue: normalizeLookbackValue(config.lookbackValue),
      lookbackUnit: normalizeLookbackUnit(config.lookbackUnit),
    };
  }

  // Legacy automation profiles used manual report date ranges.
  if (config.dateRange === '7days') {
    return { windowMode: 'customLookback', lookbackValue: 7, lookbackUnit: 'days' };
  }
  if (config.dateRange === '30days') {
    return { windowMode: 'customLookback', lookbackValue: 30, lookbackUnit: 'days' };
  }

  return { windowMode: 'last24h', lookbackValue: 2, lookbackUnit: 'hours' };
}

function reportingWindowLabel(config = {}) {
  const window = normalizeReportingWindow(config);
  if (window.windowMode === 'last24h') return 'Last 24 hours';
  const singular = window.lookbackValue === 1 ? window.lookbackUnit.replace(/s$/, '') : window.lookbackUnit;
  return `Last ${window.lookbackValue} ${singular}`;
}

function reportingWindowBounds(reportConfig, { frequency, dayOfMonth, timezone, now }) {
  if (!reportConfig) return periodBounds({ frequency, dayOfMonth, timezone, now });
  const end = now instanceof Date ? now : new Date(now);
  const window = normalizeReportingWindow(reportConfig);
  if (window.windowMode === 'last24h') {
    return {
      from: new Date(end.getTime() - 24 * 60 * 60 * 1000).toISOString(),
      to: end.toISOString(),
    };
  }

  const unitMs = window.lookbackUnit === 'weeks'
    ? 7 * 24 * 60 * 60 * 1000
    : window.lookbackUnit === 'days'
      ? 24 * 60 * 60 * 1000
      : 60 * 60 * 1000;
  return {
    from: new Date(end.getTime() - window.lookbackValue * unitMs).toISOString(),
    to: end.toISOString(),
  };
}

function computeNextSendAt({
  frequency,
  sendHour = 7,
  dayOfWeek = 1,
  dayOfMonth = 1,
  timezone = 'Africa/Lagos',
  nightBatch = false,
  from = new Date(),
}) {
  const useNightBatch = frequency === 'hourly' && nightBatch;

  if (frequency === 'hourly') {
    for (let m = 1; m <= 25 * 60; m++) {
      const t = new Date(from.getTime() + m * 60_000);
      const p = zonedParts(t, timezone);
      if (p.minute !== 0) continue;
      if (useNightBatch && isNightSendHour(p.hour)) continue;
      return t.toISOString();
    }
    return new Date(from.getTime() + 60 * 60 * 1000).toISOString();
  }

  for (let d = 0; d < 60; d++) {
    const probe = new Date(from.getTime() + d * 86400000);
    const parts = zonedParts(probe, timezone);
    if (!matchesScheduleDay(parts, frequency, dayOfWeek, dayOfMonth)) continue;

    const candidate = new Date(localToUtcIso({
      year: parts.year,
      month: parts.month,
      day: parts.day,
      hour: sendHour,
      minute: 0,
    }, timezone));
    if (candidate > from) return candidate.toISOString();
  }
  return new Date(from.getTime() + 86400000).toISOString();
}

function loadMetadata() {
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), 'public', 'metadata.json'), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
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

function buildConnectivityPackSections(vehicles, now, previousSnapshot, { eventType = '', windowHours = 24 } = {}) {
  const ts = now instanceof Date ? now : new Date(now);
  const windowH = Math.max(1, windowHours);
  const enriched = automationOfflineCandidates(vehicles, ts, windowH).map(v => enrichOfflineVehicle(v, ts, windowH));
  const candidateIds = enriched.map(v => v.id).filter(Boolean);
  const prevIds = previousSnapshot?.assetIds || [];
  const repeatIdSet = new Set(diffRepeatOffenders(prevIds, candidateIds));

  const sections = [];
  const wantsOffline = eventType === 'Offline' || eventType === '';
  const wantsNonOp = eventType === 'Non-Operational';
  const wantsNoRecentCommunication = normalizeConnectivityEventType(eventType) === NO_RECENT_COMMUNICATION;

  if (wantsNoRecentCommunication) {
    const noTel = vehicles
      .filter(v => classifyConnectivity(v, { windowHours: windowH, now: ts.getTime() }) === NO_RECENT_COMMUNICATION)
      .map(v => enrichOfflineVehicle(v, ts, windowH));
    sections.push({
      id: 'no_recent_communication',
      title: 'No recent communication (no GPS in tracking window)',
      total: noTel.length,
      rows: noTel.slice(0, 20).map(v => ({
        label: vehicleDisplayLabel(v),
        count: formatOfflineDuration(v.offlineHours),
      })),
    });
  }

  if (wantsOffline && !wantsNonOp && !wantsNoRecentCommunication) {
    const offlineRows = enriched.filter(v => v.bucket === 'Offline');
    sections.push({
      id: 'offline',
      title: 'Offline (no GPS, excluding Non-Operational)',
      total: offlineRows.length,
      rows: offlineRows.slice(0, 20).map(v => ({
        label: vehicleDisplayLabel(v),
        count: `${formatOfflineDuration(v.offlineHours)}${repeatIdSet.has(v.id) ? ' · Repeat offender' : ''}`,
      })),
    });
    const repeatRows = enriched.filter(v => repeatIdSet.has(v.id));
    if (repeatRows.length > 0) {
      sections.push({
        id: 'repeat_offenders',
        title: 'Repeat offenders (still offline since last send)',
        total: repeatRows.length,
        rows: repeatRows.slice(0, 20).map(v => ({
          label: vehicleDisplayLabel(v),
          count: formatOfflineDuration(v.offlineHours),
        })),
      });
    }
  }

  if (wantsNonOp) {
    const nonOp = vehicles
      .filter(v => classifyConnectivity(v, { windowHours: windowH, now: ts.getTime() }) === 'Non-Operational')
      .map(v => enrichOfflineVehicle(v, ts, windowH));
    sections.push({
      id: 'non_operational',
      title: 'Non-Operational (30d+ no GPS)',
      total: nonOp.length,
      rows: nonOp.slice(0, 20).map(v => ({
        label: vehicleDisplayLabel(v),
        count: formatOfflineDuration(v.offlineHours),
      })),
    });
  }

  const shouldSnapshot = wantsOffline && !wantsNonOp && !wantsNoRecentCommunication;
  return {
    sections,
    offlineSnapshot: shouldSnapshot
      ? { assetIds: candidateIds, sentAt: ts.toISOString() }
      : null,
  };
}

function buildPackPayload(packs, { frequency, dayOfMonth, timezone, now, reportConfig = null, title = null, format = 'csv', previousSnapshot = null } = {}) {
  const { from, to } = reportingWindowBounds(reportConfig, {
    frequency,
    dayOfMonth,
    timezone,
    now,
  });
  const agg = querySafetyEventAggregates({ from, to });
  const safetyLabels = [
    'Harsh Braking', 'Harsh Acceleration', 'Overspeeding',
    'Overspeed Tiered', 'Harsh Cornering',
  ];
  const byLabel = agg.byLabel || {};
  const safetyTotal = safetyLabels.reduce((n, label) => n + (byLabel[label] || 0), 0);

  const sections = [];
  let offlineSnapshot = null;
  if (reportConfig) {
    sections.push({
      id: 'report_profile',
      title: title || 'Saved report profile',
      total: null,
      rows: [
        { label: 'Report type', count: reportConfig.reportType || 'events' },
        { label: 'Tracking window', count: reportingWindowLabel(reportConfig) },
        { label: 'Search', count: reportConfig.search || 'None' },
        { label: 'Site', count: reportConfig.site || 'All sites' },
        { label: 'Event type', count: reportConfig.eventType || 'All event types' },
        { label: 'View', count: reportConfig.view === 'trends' ? 'Trends graph' : 'Events table' },
        { label: 'Format', count: String(format || reportConfig.format || 'csv').toUpperCase() },
      ],
    });
  }
  if (packs.includes('offline_2h') || reportConfig?.eventType === 'Offline' || reportConfig?.eventType === 'Non-Operational' || normalizeConnectivityEventType(reportConfig?.eventType || '') === NO_RECENT_COMMUNICATION) {
    const vehicles = loadVehicles();
    const rawEventType = packs.includes('offline_2h') ? 'Offline' : (reportConfig?.eventType || '');
    const eventType = rawEventType;
    const windowHours = trackingWindowHoursFromReportConfig(reportConfig || {});
    const { sections: connSections, offlineSnapshot: connOfflineSnapshot } = buildConnectivityPackSections(
      vehicles,
      now,
      previousSnapshot,
      { eventType, windowHours },
    );
    sections.push(...connSections);
    if (connOfflineSnapshot) {
      offlineSnapshot = connOfflineSnapshot;
    }
  }
  if (packs.includes('safety_events')) {
    sections.push({
      id: 'safety_events',
      title: 'Safety & incidents',
      total: safetyTotal,
      rows: safetyLabels.map(label => ({ label, count: byLabel[label] || 0 })),
    });
  }
  if (packs.includes('fleet_summary')) {
    const meta = loadMetadata();
    sections.push({
      id: 'fleet_summary',
      title: 'Fleet summary',
      total: meta?.totalVehicles ?? null,
      rows: [
        { label: 'Moving', count: meta?.moving ?? '—' },
        { label: 'Idle', count: meta?.idle ?? '—' },
        { label: 'Parked', count: meta?.parked ?? '—' },
        { label: 'Offline / inactive', count: (meta?.offline ?? 0) + (meta?.inactive ?? 0) },
        { label: 'Period safety events', count: safetyTotal },
      ],
    });
  }

  return { from, to, frequency, sections, eventCensusCount: safetyTotal, offlineSnapshot };
}

function buildTriggerPackPayload(auto, triggerRows, now) {
  return {
    from: auto.lastSentAt,
    to: now.toISOString(),
    frequency: auto.frequency,
    sections: [{
      id: 'connectivity_trigger_pending',
      title: GPS_SILENCE_TRIGGER_LABEL,
      total: triggerRows.length,
      rows: triggerRows.slice(0, 20).map(row => {
        let vehicle = {};
        try {
          vehicle = row.vehicle_json ? JSON.parse(row.vehicle_json) : {};
        } catch {
          vehicle = {};
        }
        const regNo = vehicle.regNo || vehicle.RegistrationNumber || row.asset_id || 'Unknown';
        const site = vehicle.site || vehicle.zone || vehicle.transporter || 'Unknown site';
        return {
          label: `${regNo} · ${site}`,
          count: `${GPS_SILENCE_TRIGGER_HOURS}h silence reached`,
        };
      }),
    }],
    eventCensusCount: triggerRows.length,
    offlineSnapshot: null,
  };
}

function safeReportTitle(input) {
  const text = String(input || '').trim();
  return text.slice(0, 180) || 'Scheduled fleet report';
}

function normalizeReportFormat(format) {
  const f = String(format || 'csv').toLowerCase();
  return ['csv', 'excel', 'pdf'].includes(f) ? f : 'csv';
}

function normalizeReportConfig(config = {}) {
  if (!config || typeof config !== 'object') return null;
  const window = normalizeReportingWindow(config);
  const eventType = normalizeConnectivityEventType(String(config.eventType || ''));
  const isGpsSilenceTrigger = eventType === NO_RECENT_COMMUNICATION;
  const reportType = ['events', 'driver_scorecard', 'trips', 'asset_utilization'].includes(config.reportType)
    ? config.reportType
    : 'events';
  const view = ['events', 'trends'].includes(config.view) ? config.view : 'events';
  return {
    ...(isGpsSilenceTrigger
      ? { windowMode: 'customLookback', lookbackValue: GPS_SILENCE_TRIGGER_HOURS, lookbackUnit: 'hours' }
      : window),
    search: String(config.search || '').slice(0, 200),
    site: String(config.site || ''),
    siteKeys: Array.isArray(config.siteKeys)
      ? config.siteKeys.map(s => String(s || '').trim()).filter(Boolean)
      : [],
    eventType,
    view,
    reportType,
    tripGroupBy: config.tripGroupBy === 'driver' ? 'driver' : 'asset',
    format: normalizeReportFormat(config.format),
    nightBatch: !!config.nightBatch,
  };
}

function packsFromReportConfig(config, fallback = []) {
  if (config?.reportType) return [`report:${config.reportType}`];
  return Array.isArray(fallback) && fallback.length ? fallback : ['report:events'];
}

function stableComparable(value) {
  if (Array.isArray(value)) return value.map(stableComparable);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((acc, key) => {
    const next = value[key];
    if (next === undefined) return acc;
    acc[key] = stableComparable(next);
    return acc;
  }, {});
}

function comparableReportConfig(config) {
  if (!config) return null;
  return stableComparable({
    ...config,
    siteKeys: [...(config.siteKeys || [])].map(String).sort(),
  });
}

function automationSignature({ frequency, packs, reportConfig, format, recipients, sendHour, dayOfWeek, dayOfMonth, timezone }) {
  return JSON.stringify(stableComparable({
    frequency,
    packs: [...(packs || [])].map(String).sort(),
    reportConfig: comparableReportConfig(reportConfig),
    format: normalizeReportFormat(format),
    recipients: [...(recipients || [])].map(e => String(e || '').trim().toLowerCase()).filter(Boolean).sort(),
    sendHour,
    dayOfWeek,
    dayOfMonth,
    timezone,
  }));
}

function findDuplicateAutomation(userId, candidate, ignoreId = null) {
  const wanted = automationSignature(candidate);
  const rows = getDb().prepare(`
    SELECT * FROM report_automations
    WHERE user_id = ?
  `).all(userId);
  for (const row of rows) {
    if (ignoreId && row.id === ignoreId) continue;
    const existing = rowToAutomation(row);
    const sig = automationSignature({
      frequency: existing.frequency,
      packs: existing.packs,
      reportConfig: existing.reportConfig,
      format: existing.format,
      recipients: existing.recipients,
      sendHour: existing.sendHour,
      dayOfWeek: existing.dayOfWeek,
      dayOfMonth: existing.dayOfMonth,
      timezone: existing.timezone,
    });
    if (sig === wanted) return existing;
  }
  return null;
}

function archiveAutomationProfile(userId, automation) {
  if (!automation?.reportConfig) return null;
  try {
    const payload = {
      id: automation.id,
      title: automation.title,
      frequency: automation.frequency,
      recipients: automation.recipients,
      reportConfig: automation.reportConfig,
      format: automation.format,
      nextSendAt: automation.nextSendAt,
      savedAt: nowIso(),
    };
    return archiveOrReplaceAutomationProfile({
      automationId: automation.id,
      filename: `${automation.id}.automation.json`,
      mime: 'application/json',
      buffer: Buffer.from(JSON.stringify(payload, null, 2), 'utf8'),
      meta: { automationId: automation.id, title: automation.title },
      createdBy: userId,
    });
  } catch {
    return null;
  }
}

export function listAutomationsForUser(userId) {
  const rows = getDb().prepare(`
    SELECT * FROM report_automations
    WHERE user_id = ?
    ORDER BY created_at DESC
  `).all(userId);
  return rows.map(rowToAutomation);
}

export function getAutomationForUser(id, userId) {
  const row = getDb().prepare(`
    SELECT * FROM report_automations WHERE id = ? AND user_id = ?
  `).get(id, userId);
  return rowToAutomation(row);
}

export function createAutomation(userId, input, userEmail) {
  const reportConfig = normalizeReportConfig(input.reportConfig);
  const packs = packsFromReportConfig(reportConfig, input.packs);
  validateInput({ ...input, packs });
  const recipients = normalizeRecipients(input.recipients, userEmail);
  const id = newId();
  const now = nowIso();
  const timezone = input.timezone || 'Africa/Lagos';
  const sendHour = clampHour(input.sendHour);
  const dayOfWeek = clampDow(input.dayOfWeek);
  const dayOfMonth = clampDom(input.dayOfMonth);
  const format = normalizeReportFormat(input.format || reportConfig?.format);
  const title = safeReportTitle(input.title);
  const nextSendAt = computeNextSendAt({
    frequency: input.frequency,
    sendHour,
    dayOfWeek,
    dayOfMonth,
    timezone,
    nightBatch: input.frequency === 'hourly' && reportConfig?.nightBatch,
  });
  const duplicate = findDuplicateAutomation(userId, {
    frequency: input.frequency,
    packs,
    reportConfig,
    format,
    recipients,
    sendHour,
    dayOfWeek,
    dayOfMonth,
    timezone,
  });
  if (duplicate) {
    throw Object.assign(new Error('That exact automation already exists.'), {
      status: 409,
      code: 'duplicate_automation',
      duplicateId: duplicate.id,
    });
  }

  getDb().prepare(`
    INSERT INTO report_automations (
      id, user_id, enabled, title, frequency, packs, report_config, format, recipients,
      send_hour, day_of_week, day_of_month, timezone,
      last_sent_at, next_send_at, last_error, created_at, updated_at
    ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?)
  `).run(
    id,
    userId,
    title,
    input.frequency,
    JSON.stringify(packs),
    reportConfig ? JSON.stringify({ ...reportConfig, format }) : null,
    format,
    JSON.stringify(recipients),
    sendHour,
    dayOfWeek,
    dayOfMonth,
    timezone,
    nextSendAt,
    now,
    now,
  );

  const automation = getAutomationForUser(id, userId);
  if (isTriggerModeConfig(automation?.reportConfig)) {
    initializeConnectivityTriggerState(automation.id, automation.reportConfig, loadVehicles());
  }
  archiveAutomationProfile(userId, automation);
  return automation;
}

function scheduleFieldsChanged(input, existing) {
  if (input.frequency !== undefined && input.frequency !== existing.frequency) return true;
  if (input.sendHour !== undefined && input.sendHour !== existing.sendHour) return true;
  if (input.dayOfWeek !== undefined && input.dayOfWeek !== existing.dayOfWeek) return true;
  if (input.dayOfMonth !== undefined && input.dayOfMonth !== existing.dayOfMonth) return true;
  if (input.timezone !== undefined && input.timezone !== existing.timezone) return true;
  if (input.enabled !== undefined && !!input.enabled !== !!existing.enabled) return true;
  const nextFrequency = input.frequency ?? existing.frequency;
  if (nextFrequency === 'hourly' && input.reportConfig !== undefined) {
    const prevNight = !!existing.reportConfig?.nightBatch;
    const nextNight = !!normalizeReportConfig(input.reportConfig)?.nightBatch;
    if (prevNight !== nextNight) return true;
  }
  return false;
}

function triggerSettingsChanged(prev = {}, next = {}) {
  if (isTriggerModeConfig(prev) !== isTriggerModeConfig(next)) return true;
  if (!isTriggerModeConfig(next)) return false;
  if (trackingWindowHoursFromReportConfig(prev) !== trackingWindowHoursFromReportConfig(next)) return true;
  if (normalizeConnectivityEventType(prev.eventType || '') !== normalizeConnectivityEventType(next.eventType || '')) return true;
  if (String(prev.search || '') !== String(next.search || '')) return true;
  const prevSites = JSON.stringify([...(prev.siteKeys || [])].map(String).sort());
  const nextSites = JSON.stringify([...(next.siteKeys || [])].map(String).sort());
  return prevSites !== nextSites;
}

export function updateAutomation(id, userId, input, userEmail) {
  const existing = getAutomationForUser(id, userId);
  if (!existing) {
    throw Object.assign(new Error('Automation not found'), { status: 404 });
  }

  const frequency = input.frequency ?? existing.frequency;
  const reportConfig = input.reportConfig !== undefined
    ? normalizeReportConfig(input.reportConfig)
    : existing.reportConfig;
  const packs = packsFromReportConfig(reportConfig, input.packs ?? existing.packs);
  const recipients = input.recipients != null
    ? normalizeRecipients(input.recipients, userEmail)
    : existing.recipients;
  const enabled = input.enabled != null ? (input.enabled ? 1 : 0) : (existing.enabled ? 1 : 0);
  const sendHour = input.sendHour != null ? clampHour(input.sendHour) : existing.sendHour;
  const dayOfWeek = input.dayOfWeek != null ? clampDow(input.dayOfWeek) : existing.dayOfWeek;
  const dayOfMonth = input.dayOfMonth != null ? clampDom(input.dayOfMonth) : existing.dayOfMonth;
  const timezone = input.timezone || existing.timezone;
  const format = normalizeReportFormat(input.format || reportConfig?.format || existing.format);
  const title = input.title != null ? safeReportTitle(input.title) : (existing.title || safeReportTitle(null));
  const now = nowIso();

  validateInput({ frequency, packs, recipients });

  const scheduleChanged = scheduleFieldsChanged(input, existing);

  const duplicate = findDuplicateAutomation(userId, {
    frequency,
    packs,
    reportConfig,
    format,
    recipients,
    sendHour,
    dayOfWeek,
    dayOfMonth,
    timezone,
  }, id);
  if (duplicate) {
    throw Object.assign(new Error('That exact automation already exists.'), {
      status: 409,
      code: 'duplicate_automation',
      duplicateId: duplicate.id,
    });
  }

  const nextSendAt = !enabled
    ? existing.nextSendAt
    : scheduleChanged || !existing.nextSendAt
      ? computeNextSendAt({
        frequency,
        sendHour,
        dayOfWeek,
        dayOfMonth,
        timezone,
        nightBatch: frequency === 'hourly' && reportConfig?.nightBatch,
      })
      : existing.nextSendAt;

  getDb().prepare(`
    UPDATE report_automations SET
      enabled = ?, title = ?, frequency = ?, packs = ?, report_config = ?, format = ?, recipients = ?,
      send_hour = ?, day_of_week = ?, day_of_month = ?, timezone = ?,
      next_send_at = ?, updated_at = ?, last_error = NULL
    WHERE id = ? AND user_id = ?
  `).run(
    enabled,
    title,
    frequency,
    JSON.stringify(packs),
    reportConfig ? JSON.stringify({ ...reportConfig, format }) : null,
    format,
    JSON.stringify(recipients),
    sendHour,
    dayOfWeek,
    dayOfMonth,
    timezone,
    nextSendAt,
    now,
    id,
    userId,
  );

  const automation = getAutomationForUser(id, userId);
  if (input.reportConfig !== undefined && triggerSettingsChanged(existing.reportConfig, automation?.reportConfig)) {
    initializeConnectivityTriggerState(automation.id, automation.reportConfig, loadVehicles());
  }
  archiveAutomationProfile(userId, automation);
  return automation;
}

export function deleteAutomation(id, userId) {
  const result = getDb().prepare(`
    DELETE FROM report_automations WHERE id = ? AND user_id = ?
  `).run(id, userId);
  if (!result.changes) {
    throw Object.assign(new Error('Automation not found'), { status: 404 });
  }
  return { ok: true };
}

export async function sendAutomationNow(id, userId, { test = false } = {}) {
  const auto = getAutomationForUser(id, userId);
  if (!auto) throw Object.assign(new Error('Automation not found'), { status: 404 });
  if (!isEmailConfigured()) {
    throw Object.assign(new Error('Email is not configured (RESEND_API_KEY)'), { status: 503 });
  }

  const sendAt = new Date();
  const row = getDb().prepare('SELECT last_offline_snapshot FROM report_automations WHERE id = ?').get(id);
  const previousSnapshot = parseOfflineSnapshot(row?.last_offline_snapshot);
  const triggerWindow = isTriggerModeConfig(auto.reportConfig)
    ? periodBounds({ frequency: 'hourly', now: sendAt })
    : null;
  const triggerRows = triggerWindow
    ? listPendingConnectivityTriggers(auto.id, triggerWindow)
    : null;
  const payload = triggerRows
    ? buildTriggerPackPayload(auto, triggerRows, sendAt)
    : buildPackPayload(auto.packs, {
    frequency: auto.frequency,
    dayOfMonth: auto.dayOfMonth ?? 1,
    timezone: auto.timezone,
    now: sendAt,
    reportConfig: auto.reportConfig,
    title: auto.title,
    format: auto.format,
    previousSnapshot,
  });

  const exportFile = await buildAutomationExport({
    reportConfig: auto.reportConfig,
    title: auto.title,
    format: auto.format,
    previousSnapshot,
    triggerRows,
    now: sendAt,
  });

  if (!test && triggerRows && triggerRows.length === 0) {
    const now = sendAt.toISOString();
    const nextSendAt = computeNextSendAt({
      frequency: auto.frequency,
      sendHour: auto.sendHour,
      dayOfWeek: auto.dayOfWeek ?? 1,
      dayOfMonth: auto.dayOfMonth ?? 1,
      timezone: auto.timezone,
      nightBatch: auto.frequency === 'hourly' && auto.reportConfig?.nightBatch,
      from: sendAt,
    });
    getDb().prepare(`
      UPDATE report_automations
      SET last_sent_at = ?, next_send_at = ?, last_error = NULL, updated_at = ?
      WHERE id = ?
    `).run(now, nextSendAt, now, id);
    clearPendingConnectivityTriggers(id);
    return { sent: false, skipped: 'no_pending_triggers', automation: getAutomationForUser(id, userId), rowCount: 0 };
  }

  let result;
  if (exportFile) {
    result = await sendReportExportEmail({
      to: auto.recipients,
      filename: exportFile.filename,
      mime: exportFile.mime,
      contentBase64: exportFile.contentBase64,
      reportTitle: `${test ? '[Test] ' : ''}${triggerRows ? GPS_SILENCE_TRIGGER_LABEL : auto.title || 'Fleet report'}`,
      meta: exportFile.meta,
      eventCount: exportFile.rowCount,
    });
  } else {
    result = await sendAutomatedReportEmail({
      to: auto.recipients,
      frequency: auto.frequency,
      packs: auto.reportConfig ? [auto.title || auto.reportConfig.reportType] : auto.packs,
      payload,
      test,
    });
  }

  const now = sendAt.toISOString();
  if (result.sent) {
    const nextSendAt = computeNextSendAt({
      frequency: auto.frequency,
      sendHour: auto.sendHour,
      dayOfWeek: auto.dayOfWeek ?? 1,
      dayOfMonth: auto.dayOfMonth ?? 1,
      timezone: auto.timezone,
      nightBatch: auto.frequency === 'hourly' && auto.reportConfig?.nightBatch,
      from: sendAt,
    });
    getDb().prepare(`
      UPDATE report_automations
      SET last_sent_at = ?, next_send_at = ?, last_error = NULL, updated_at = ?,
          last_offline_snapshot = COALESCE(?, last_offline_snapshot)
      WHERE id = ?
    `).run(now, nextSendAt, now, payload.offlineSnapshot ? JSON.stringify(payload.offlineSnapshot) : null, id);
    if (!test && triggerRows) {
      clearPendingConnectivityTriggers(id);
    }
  } else {
    getDb().prepare(`
      UPDATE report_automations SET last_error = ?, updated_at = ? WHERE id = ?
    `).run(result.error || 'Send failed', now, id);
  }

  return { ...result, automation: getAutomationForUser(id, userId), rowCount: exportFile?.rowCount ?? null };
}

function dueAutomations(now = new Date()) {
  return getDb().prepare(`
    SELECT * FROM report_automations
    WHERE enabled = 1
      AND next_send_at IS NOT NULL
      AND next_send_at <= ?
  `).all(now.toISOString()).map(rowToAutomation);
}

export async function processDueAutomations() {
  if (!isEmailConfigured()) return { processed: 0, skipped: 'email_not_configured' };
  const due = dueAutomations();
  let processed = 0;
  for (const auto of due) {
    try {
      await sendAutomationNow(auto.id, auto.userId, { test: false });
      processed += 1;
    } catch (e) {
      getDb().prepare(`
        UPDATE report_automations SET last_error = ?, updated_at = ? WHERE id = ?
      `).run(e?.message || 'Send failed', nowIso(), auto.id);
    }
  }
  return { processed, due: due.length };
}

let schedulerStarted = false;

function reportAutomateSchedulerEnabled() {
  const flag = String(process.env.REPORT_AUTOMATE_SCHEDULER || '').trim().toLowerCase();
  if (['0', 'false', 'off', 'no'].includes(flag)) return false;
  if (['1', 'true', 'on', 'yes'].includes(flag)) return true;
  return process.env.NODE_ENV === 'production';
}

export function startReportAutomateScheduler() {
  if (schedulerStarted) return;
  if (!reportAutomateSchedulerEnabled()) {
    console.log('📬 Report Automate scheduler disabled outside production');
    return;
  }
  schedulerStarted = true;
  const tick = () => {
    processDueAutomations().catch(e => {
      console.warn('Report automate tick failed:', e?.message || e);
    });
  };
  // First check shortly after boot, then every 5 minutes
  setTimeout(tick, 20_000);
  setInterval(tick, 5 * 60_000);
  console.log('📬 Report Automate scheduler started');
}

function validateInput({ frequency, packs, recipients }) {
  if (!FREQUENCIES.includes(frequency)) {
    throw Object.assign(new Error('Frequency must be hourly, daily, weekly, or monthly'), { status: 400 });
  }
  if (!Array.isArray(packs) || packs.length === 0) {
    throw Object.assign(new Error('Select at least one report pack'), { status: 400 });
  }
  const allowed = new Set(REPORT_PACKS.map(p => p.id));
  if (packs.some(p => !allowed.has(p) && !String(p).startsWith('report:'))) {
    throw Object.assign(new Error('Invalid report pack'), { status: 400 });
  }
  if (recipients != null && (!Array.isArray(recipients) || recipients.length === 0)) {
    throw Object.assign(new Error('At least one recipient email is required'), { status: 400 });
  }
}

function normalizeRecipients(recipients, fallbackEmail) {
  const list = Array.isArray(recipients) ? recipients : [];
  const cleaned = [...new Set(
    list.map(e => String(e || '').trim().toLowerCase()).filter(Boolean),
  )];
  if (cleaned.length === 0 && fallbackEmail) cleaned.push(String(fallbackEmail).toLowerCase());
  if (cleaned.length === 0) {
    throw Object.assign(new Error('At least one recipient email is required'), { status: 400 });
  }
  for (const email of cleaned) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw Object.assign(new Error(`Invalid email: ${email}`), { status: 400 });
    }
  }
  return cleaned;
}

function clampHour(h) {
  const n = Number(h);
  if (!Number.isFinite(n)) return 7;
  return Math.min(23, Math.max(0, Math.round(n)));
}

function clampDow(d) {
  const n = Number(d);
  if (!Number.isFinite(n)) return 1;
  return Math.min(6, Math.max(0, Math.round(n)));
}

function clampDom(d) {
  const n = Number(d);
  if (!Number.isFinite(n)) return 1;
  if (n === 0) return 0;
  return Math.min(28, Math.max(1, Math.round(n)));
}
