import crypto from 'crypto';
import { getDb } from './db.js';
import {
  gpsAgeHours,
  normalizeConnectivityEventType,
  NO_RECENT_COMMUNICATION,
} from './connectivity-events.js';

export const GPS_SILENCE_TRIGGER_HOURS = 2;
export const GPS_SILENCE_TRIGGER_LABEL = 'No recent communication (2 hrs)';

function nowIso(now = new Date()) {
  return (now instanceof Date ? now : new Date(now)).toISOString();
}

export function isTriggerModeConfig(reportConfig) {
  return normalizeConnectivityEventType(String(reportConfig?.eventType || '')) === NO_RECENT_COMMUNICATION;
}

function triggerEventType(reportConfig = {}) {
  return NO_RECENT_COMMUNICATION;
}

function vehicleAssetId(vehicle) {
  return String(vehicle?.id || vehicle?.assetId || vehicle?.AssetId || '').trim();
}

function lastSeenAt(vehicle) {
  const raw = vehicle?.date || vehicle?.lastUpdate || vehicle?.LastUpdate;
  if (!raw || raw === 'N/A') return null;
  const ts = new Date(raw);
  return Number.isFinite(ts.getTime()) ? ts.toISOString() : null;
}

function matchesSite(vehicle, siteKeys) {
  if (!siteKeys?.length) return true;
  const zoneKey = String(vehicle.zone || '').trim();
  const siteKey = String(vehicle.site || '').trim();
  return siteKeys.includes(zoneKey) || (siteKey && siteKeys.includes(siteKey));
}

function matchesSearch(vehicle, search) {
  const q = String(search || '').trim().toLowerCase();
  if (!q) return true;
  const hay = [
    vehicle.regNo,
    vehicle.RegistrationNumber,
    vehicle.assetName,
    vehicle.Description,
    vehicle.id,
    vehicle.assetId,
    vehicle.transporter,
    vehicle.site,
    vehicle.zone,
    vehicle.driverName,
    vehicle.driverPhone,
    vehicle.status,
  ].filter(Boolean).join(' ').toLowerCase();
  return hay.includes(q);
}

function shouldQueue({ ageHours, thresholdHours }) {
  return ageHours != null && ageHours >= thresholdHours;
}

function activeTriggerAutomations() {
  const rows = getDb().prepare(`
    SELECT id, report_config
    FROM report_automations
    WHERE enabled = 1
      AND report_config IS NOT NULL
  `).all();
  return rows
    .map(row => {
      try {
        return { id: row.id, reportConfig: JSON.parse(row.report_config) };
      } catch {
        return null;
      }
    })
    .filter(a => a && isTriggerModeConfig(a.reportConfig));
}

export function initializeConnectivityTriggerState(automationId, reportConfig, vehicles, now = new Date()) {
  if (!automationId || !isTriggerModeConfig(reportConfig) || !Array.isArray(vehicles)) return 0;
  const db = getDb();
  const thresholdHours = GPS_SILENCE_TRIGGER_HOURS;
  const siteKeys = Array.isArray(reportConfig.siteKeys) ? reportConfig.siteKeys : [];
  const search = String(reportConfig.search || '');
  const stamp = nowIso(now);
  const upsert = db.prepare(`
    INSERT INTO connectivity_trigger_state (
      automation_id, asset_id, was_silent, last_age_hours, last_seen_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(automation_id, asset_id) DO UPDATE SET
      was_silent = excluded.was_silent,
      last_age_hours = excluded.last_age_hours,
      last_seen_at = excluded.last_seen_at,
      updated_at = excluded.updated_at
  `);
  let n = 0;
  const tx = db.transaction(() => {
    for (const vehicle of vehicles) {
      if (!matchesSite(vehicle, siteKeys) || !matchesSearch(vehicle, search)) continue;
      const assetId = vehicleAssetId(vehicle);
      if (!assetId) continue;
      const ageHours = gpsAgeHours(vehicle, now.getTime());
      const silent = ageHours != null && ageHours >= thresholdHours ? 1 : 0;
      upsert.run(automationId, assetId, silent, ageHours, lastSeenAt(vehicle), stamp);
      n += 1;
    }
  });
  tx();
  return n;
}

export function queueConnectivityTriggersForPoll(vehicles, now = new Date()) {
  if (!Array.isArray(vehicles) || vehicles.length === 0) return { queued: 0, automations: 0 };
  const automations = activeTriggerAutomations();
  if (automations.length === 0) return { queued: 0, automations: 0 };

  const db = getDb();
  const getState = db.prepare(`
    SELECT was_silent FROM connectivity_trigger_state
    WHERE automation_id = ? AND asset_id = ?
  `);
  const upsertState = db.prepare(`
    INSERT INTO connectivity_trigger_state (
      automation_id, asset_id, was_silent, last_age_hours, last_seen_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(automation_id, asset_id) DO UPDATE SET
      was_silent = excluded.was_silent,
      last_age_hours = excluded.last_age_hours,
      last_seen_at = excluded.last_seen_at,
      updated_at = excluded.updated_at
  `);
  const insertPending = db.prepare(`
    INSERT OR IGNORE INTO connectivity_trigger_pending (
      id, automation_id, asset_id, event_type, threshold_hours, threshold_operator,
      triggered_at, last_seen_at, vehicle_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let queued = 0;
  const stamp = nowIso(now);
  const nowMs = now.getTime();
  const tx = db.transaction(() => {
    for (const automation of automations) {
      const cfg = automation.reportConfig;
      const thresholdHours = GPS_SILENCE_TRIGGER_HOURS;
      const siteKeys = Array.isArray(cfg.siteKeys) ? cfg.siteKeys : [];
      const search = String(cfg.search || '');
      const eventType = triggerEventType(cfg);

      for (const vehicle of vehicles) {
        if (!matchesSite(vehicle, siteKeys) || !matchesSearch(vehicle, search)) continue;
        const assetId = vehicleAssetId(vehicle);
        if (!assetId) continue;
        const ageHours = gpsAgeHours(vehicle, nowMs);
        const silent = ageHours != null && ageHours >= thresholdHours;
        const state = getState.get(automation.id, assetId);

        if (state && !state.was_silent && shouldQueue({ ageHours, thresholdHours })) {
          const result = insertPending.run(
            crypto.randomUUID(),
            automation.id,
            assetId,
            eventType,
            thresholdHours,
            'gte',
            stamp,
            lastSeenAt(vehicle),
            JSON.stringify(vehicle),
            stamp,
          );
          queued += result.changes || 0;
        }

        upsertState.run(automation.id, assetId, silent ? 1 : 0, ageHours, lastSeenAt(vehicle), stamp);
      }
    }
  });
  tx();

  return { queued, automations: automations.length };
}

export function pendingConnectivityTriggerCount(automationId) {
  if (!automationId) return 0;
  return getDb().prepare(`
    SELECT COUNT(*) AS c FROM connectivity_trigger_pending WHERE automation_id = ?
  `).get(automationId)?.c || 0;
}

export function listPendingConnectivityTriggers(automationId) {
  if (!automationId) return [];
  return getDb().prepare(`
    SELECT *
    FROM connectivity_trigger_pending
    WHERE automation_id = ?
    ORDER BY created_at ASC
  `).all(automationId);
}

export function clearPendingConnectivityTriggers(automationId) {
  if (!automationId) return 0;
  return getDb().prepare(`
    DELETE FROM connectivity_trigger_pending WHERE automation_id = ?
  `).run(automationId).changes || 0;
}
