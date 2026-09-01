const NO_RECENT_COMMUNICATION = 'No recent communication';
const LEGACY_NO_TELEMETRY = 'No telemetry';

const NO_RECENT_COMMUNICATION_DISPLAY_LABEL =
  'No recent communication (excluding Non-Operational 30 days and Offline 24–30 days)';

export function normalizeConnectivityEventType(eventType) {
  if (eventType === LEGACY_NO_TELEMETRY) return NO_RECENT_COMMUNICATION;
  return eventType;
}

export function connectivityEventDisplayLabel(bucket) {
  const normalized = normalizeConnectivityEventType(bucket);
  if (normalized === NO_RECENT_COMMUNICATION) return NO_RECENT_COMMUNICATION_DISPLAY_LABEL;
  return bucket || 'Unknown';
}
