/**
 * Connectivity classification for report automations — mirrors src/lib/reports/connectivityCounts.ts.
 */

export const NO_RECENT_COMMUNICATION = 'No recent communication';
export const LEGACY_NO_TELEMETRY = 'No telemetry';

export function normalizeConnectivityEventType(eventType) {
  if (eventType === LEGACY_NO_TELEMETRY) return NO_RECENT_COMMUNICATION;
  return eventType;
}

export const OFFLINE_MIN_HOURS = 24;
export const NON_OP_MIN_HOURS = 30 * 24;

export function gpsAgeHours(vehicle, now = Date.now()) {
  const raw = vehicle.date || vehicle.lastUpdate;
  if (!raw || raw === 'N/A') return null;
  const ts = new Date(raw).getTime();
  if (!Number.isFinite(ts)) return null;
  return Math.max(0, (now - ts) / 3_600_000);
}

export function isNonOperationalTier(vehicle, now = Date.now()) {
  if (String(vehicle.status || '') === 'Inactive') return true;
  const ageH = gpsAgeHours(vehicle, now);
  return ageH != null && ageH >= NON_OP_MIN_HOURS;
}

export function isOfflineTier(vehicle, now = Date.now()) {
  if (isNonOperationalTier(vehicle, now)) return false;
  const ageH = gpsAgeHours(vehicle, now);
  if (ageH != null && ageH >= OFFLINE_MIN_HOURS && ageH < NON_OP_MIN_HOURS) return true;
  if (String(vehicle.status || '') === 'Offline' && vehicle.position && ageH != null && ageH >= OFFLINE_MIN_HOURS) {
    return true;
  }
  return false;
}

export function trackingWindowHoursFromReportConfig(reportConfig = {}) {
  if (!reportConfig || reportConfig.windowMode === 'last24h') return 24;
  const value = Math.max(1, Math.floor(Number(reportConfig.lookbackValue) || 2));
  const unit = reportConfig.lookbackUnit || 'hours';
  if (unit === 'weeks') return value * 7 * 24;
  if (unit === 'days') return value * 24;
  return value;
}

export function classifyConnectivity(vehicle, { windowHours = 24, now = Date.now() } = {}) {
  const windowH = Math.max(1, windowHours);

  if (isNonOperationalTier(vehicle, now)) return 'Non-Operational';
  if (isOfflineTier(vehicle, now)) return 'Offline';

  const ageH = gpsAgeHours(vehicle, now);
  if (ageH == null) return null;
  if (ageH >= windowH && ageH < OFFLINE_MIN_HOURS) return NO_RECENT_COMMUNICATION;

  return null;
}

export function isReportOffline(vehicle, opts = {}) {
  return classifyConnectivity(vehicle, opts) === 'Offline';
}

export function isAutomationOfflineCandidate(vehicle, now = Date.now(), windowHours = 2) {
  if (isNonOperationalTier(vehicle, now)) return false;
  const bucket = classifyConnectivity(vehicle, { windowHours, now });
  if (bucket === NO_RECENT_COMMUNICATION || bucket === 'Offline') return true;
  const ageH = gpsAgeHours(vehicle, now);
  return ageH != null && ageH >= 2;
}

export function automationOfflineCandidates(vehicles, now = new Date(), windowHours = 2) {
  const ts = now.getTime();
  return vehicles.filter(v => isAutomationOfflineCandidate(v, ts, windowHours));
}

export function diffRepeatOffenders(previousAssetIds, currentAssetIds) {
  const prev = new Set(previousAssetIds || []);
  const repeat = [];
  for (const id of currentAssetIds || []) {
    if (prev.has(id)) repeat.push(id);
  }
  return repeat;
}

export function parseOfflineSnapshot(raw) {
  if (!raw) return null;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || !Array.isArray(parsed.assetIds)) return null;
    return {
      assetIds: parsed.assetIds.map(String),
      sentAt: String(parsed.sentAt || ''),
    };
  } catch {
    return null;
  }
}

export function formatOfflineDuration(hours) {
  if (hours == null) return 'unknown';
  if (hours < 24) return `${Math.floor(hours)}h`;
  return `${Math.floor(hours / 24)}d ${Math.floor(hours % 24)}h`;
}

export function vehicleDisplayLabel(v) {
  return `${v.regNo || v.RegistrationNumber || 'Unknown'} · ${v.site || v.transporter || 'Unknown site'}`;
}

export function enrichOfflineVehicle(v, now = new Date(), windowHours = 24) {
  const lastSeenMs = new Date(v.date || v.lastUpdate || 0).getTime();
  const offlineHours = Number.isFinite(lastSeenMs)
    ? Math.max(0, (now.getTime() - lastSeenMs) / 3_600_000)
    : null;
  const id = String(v.id || v.assetId || '');
  const bucket = classifyConnectivity(v, { windowHours, now: now.getTime() });
  return { ...v, id, lastSeenMs, offlineHours, bucket };
}
