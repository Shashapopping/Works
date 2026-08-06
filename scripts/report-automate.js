/**
 * Account-tied report automations — daily / weekly / monthly via Resend.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getDb, getAllEvents } from './db.js';
import { sendAutomatedReportEmail, isEmailConfigured } from './email.js';

export const REPORT_PACKS = [
  { id: 'safety_events', label: 'Safety & incidents', hint: 'Event counts and top labels for the period' },
  { id: 'fleet_summary', label: 'Fleet summary', hint: 'Live fleet status snapshot with period incident total' },
];

export const FREQUENCIES = ['daily', 'weekly', 'monthly'];

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
    enabled: !!row.enabled,
    frequency: row.frequency,
    packs: parseJson(row.packs, []),
    recipients: parseJson(row.recipients, []),
    sendHour: row.send_hour,
    dayOfWeek: row.day_of_week,
    dayOfMonth: row.day_of_month,
    timezone: row.timezone,
    lastSentAt: row.last_sent_at,
    nextSendAt: row.next_send_at,
    lastError: row.last_error,
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

function periodBounds(frequency) {
  const end = Date.now();
  const ms =
    frequency === 'daily' ? 86400000
      : frequency === 'monthly' ? 30 * 86400000
        : 7 * 86400000;
  return {
    from: new Date(end - ms).toISOString(),
    to: new Date(end).toISOString(),
  };
}

function computeNextSendAt({
  frequency,
  sendHour = 7,
  dayOfWeek = 1,
  dayOfMonth = 1,
  timezone = 'Africa/Lagos',
  from = new Date(),
}) {
  // Scan forward up to 40 days in 30-min steps for the next matching local slot
  const start = new Date(from.getTime() + 60_000);
  for (let i = 0; i < 40 * 48; i++) {
    const candidate = new Date(start.getTime() + i * 30 * 60_000);
    const p = zonedParts(candidate, timezone);
    if (p.hour !== sendHour || p.minute > 29) continue;
    if (frequency === 'weekly' && p.weekday !== dayOfWeek) continue;
    if (frequency === 'monthly' && p.day !== dayOfMonth) continue;
    return candidate.toISOString();
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

function buildPackPayload(packs, frequency) {
  const { from, to } = periodBounds(frequency);
  const events = getAllEvents({ from, to, limit: 5000 });
  const safetyLabels = [
    'Harsh Braking', 'Harsh Acceleration', 'Overspeeding',
    'Overspeed Tiered', 'Harsh Cornering',
  ];
  const byLabel = {};
  let safetyTotal = 0;
  for (const e of events) {
    const label = e.label || 'Unknown';
    if (!safetyLabels.includes(label)) continue;
    byLabel[label] = (byLabel[label] || 0) + 1;
    safetyTotal += 1;
  }

  const sections = [];
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

  return { from, to, frequency, sections, eventSampleCount: events.length };
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
  validateInput(input);
  const recipients = normalizeRecipients(input.recipients, userEmail);
  const id = newId();
  const now = nowIso();
  const timezone = input.timezone || 'Africa/Lagos';
  const sendHour = clampHour(input.sendHour);
  const dayOfWeek = clampDow(input.dayOfWeek);
  const dayOfMonth = clampDom(input.dayOfMonth);
  const nextSendAt = computeNextSendAt({
    frequency: input.frequency,
    sendHour,
    dayOfWeek,
    dayOfMonth,
    timezone,
  });

  getDb().prepare(`
    INSERT INTO report_automations (
      id, user_id, enabled, frequency, packs, recipients,
      send_hour, day_of_week, day_of_month, timezone,
      last_sent_at, next_send_at, last_error, created_at, updated_at
    ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?)
  `).run(
    id,
    userId,
    input.frequency,
    JSON.stringify(input.packs),
    JSON.stringify(recipients),
    sendHour,
    dayOfWeek,
    dayOfMonth,
    timezone,
    nextSendAt,
    now,
    now,
  );

  return getAutomationForUser(id, userId);
}

export function updateAutomation(id, userId, input, userEmail) {
  const existing = getAutomationForUser(id, userId);
  if (!existing) {
    throw Object.assign(new Error('Automation not found'), { status: 404 });
  }

  const frequency = input.frequency ?? existing.frequency;
  const packs = input.packs ?? existing.packs;
  const recipients = input.recipients != null
    ? normalizeRecipients(input.recipients, userEmail)
    : existing.recipients;
  const enabled = input.enabled != null ? (input.enabled ? 1 : 0) : (existing.enabled ? 1 : 0);
  const sendHour = input.sendHour != null ? clampHour(input.sendHour) : existing.sendHour;
  const dayOfWeek = input.dayOfWeek != null ? clampDow(input.dayOfWeek) : existing.dayOfWeek;
  const dayOfMonth = input.dayOfMonth != null ? clampDom(input.dayOfMonth) : existing.dayOfMonth;
  const timezone = input.timezone || existing.timezone;
  const now = nowIso();

  validateInput({ frequency, packs, recipients });

  const nextSendAt = enabled
    ? computeNextSendAt({ frequency, sendHour, dayOfWeek, dayOfMonth, timezone })
    : existing.nextSendAt;

  getDb().prepare(`
    UPDATE report_automations SET
      enabled = ?, frequency = ?, packs = ?, recipients = ?,
      send_hour = ?, day_of_week = ?, day_of_month = ?, timezone = ?,
      next_send_at = ?, updated_at = ?, last_error = NULL
    WHERE id = ? AND user_id = ?
  `).run(
    enabled,
    frequency,
    JSON.stringify(packs),
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

  return getAutomationForUser(id, userId);
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

  const payload = buildPackPayload(auto.packs, auto.frequency);
  const result = await sendAutomatedReportEmail({
    to: auto.recipients,
    frequency: auto.frequency,
    packs: auto.packs,
    payload,
    test,
  });

  const now = nowIso();
  if (result.sent) {
    const nextSendAt = computeNextSendAt({
      frequency: auto.frequency,
      sendHour: auto.sendHour,
      dayOfWeek: auto.dayOfWeek ?? 1,
      dayOfMonth: auto.dayOfMonth ?? 1,
      timezone: auto.timezone,
      from: new Date(),
    });
    getDb().prepare(`
      UPDATE report_automations
      SET last_sent_at = ?, next_send_at = ?, last_error = NULL, updated_at = ?
      WHERE id = ?
    `).run(now, nextSendAt, now, id);
  } else {
    getDb().prepare(`
      UPDATE report_automations SET last_error = ?, updated_at = ? WHERE id = ?
    `).run(result.error || 'Send failed', now, id);
  }

  return { ...result, automation: getAutomationForUser(id, userId) };
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

export function startReportAutomateScheduler() {
  if (schedulerStarted) return;
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
    throw Object.assign(new Error('Frequency must be daily, weekly, or monthly'), { status: 400 });
  }
  if (!Array.isArray(packs) || packs.length === 0) {
    throw Object.assign(new Error('Select at least one report pack'), { status: 400 });
  }
  const allowed = new Set(REPORT_PACKS.map(p => p.id));
  if (packs.some(p => !allowed.has(p))) {
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
  return Math.min(28, Math.max(1, Math.round(n)));
}
