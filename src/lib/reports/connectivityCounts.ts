/** Connectivity event types — classified from latest GPS snapshot + tracking window. */

export const NO_RECENT_COMMUNICATION = 'No recent communication';
export const LEGACY_NO_TELEMETRY = 'No telemetry';

export const CONNECTIVITY_EVENT_TYPES = [
  NO_RECENT_COMMUNICATION,
  'Offline',
  'Non-Operational',
] as const;

export function normalizeConnectivityEventType(eventType: string): string {
  if (eventType === LEGACY_NO_TELEMETRY) return NO_RECENT_COMMUNICATION;
  return eventType;
}

export type ConnectivityEventType = (typeof CONNECTIVITY_EVENT_TYPES)[number];

export const IVMS_EVENT_TYPES = [
  'Harsh Braking',
  'Harsh Acceleration',
  'Overspeeding',
  'Overspeed Tiered',
  'Harsh Cornering',
] as const;

export const OFFLINE_MIN_HOURS = 24;
export const NON_OP_MIN_HOURS = 30 * 24;

export function isConnectivityEventType(label: string): label is ConnectivityEventType {
  return (CONNECTIVITY_EVENT_TYPES as readonly string[]).includes(normalizeConnectivityEventType(label));
}

export interface ConnectivityVehicle {
  id?: string;
  status?: string;
  position?: unknown;
  date?: string;
}

export interface ConnectivityBucketOptions {
  windowHours?: number;
  now?: number;
}

export function gpsAgeHours(vehicle: ConnectivityVehicle, now = Date.now()): number | null {
  const raw = vehicle.date;
  if (!raw || raw === 'N/A') return null;
  const ts = new Date(raw).getTime();
  if (!Number.isFinite(ts)) return null;
  return Math.max(0, (now - ts) / 3_600_000);
}

export function isNonOperationalTier(vehicle: ConnectivityVehicle, now = Date.now()): boolean {
  if (vehicle.status === 'Inactive') return true;
  const ageH = gpsAgeHours(vehicle, now);
  return ageH != null && ageH >= NON_OP_MIN_HOURS;
}

export function isOfflineTier(vehicle: ConnectivityVehicle, now = Date.now()): boolean {
  if (isNonOperationalTier(vehicle, now)) return false;
  const ageH = gpsAgeHours(vehicle, now);
  if (ageH != null && ageH >= OFFLINE_MIN_HOURS && ageH < NON_OP_MIN_HOURS) return true;
  if (vehicle.status === 'Offline' && vehicle.position && ageH != null && ageH >= OFFLINE_MIN_HOURS) {
    return true;
  }
  return false;
}

/**
 * Mutually exclusive buckets:
 * 1. Non-Operational — 30d+ no GPS
 * 2. Offline — 24h–30d no GPS (excludes Non-Operational)
 * 3. No recent communication — no GPS within tracking window, still &lt;24h stale (excludes Offline & Non-Operational)
 */
export function connectivityBucket(
  vehicle: ConnectivityVehicle,
  opts: ConnectivityBucketOptions = {},
): ConnectivityEventType | null {
  const now = opts.now ?? Date.now();
  const windowH = Math.max(1, opts.windowHours ?? 24);

  if (isNonOperationalTier(vehicle, now)) return 'Non-Operational';
  if (isOfflineTier(vehicle, now)) return 'Offline';

  const ageH = gpsAgeHours(vehicle, now);
  if (ageH == null) return null;
  if (ageH >= windowH && ageH < OFFLINE_MIN_HOURS) return NO_RECENT_COMMUNICATION;

  return null;
}

export function isReportOffline(vehicle: ConnectivityVehicle, opts?: ConnectivityBucketOptions): boolean {
  return connectivityBucket(vehicle, opts) === 'Offline';
}

export function isAutomationOfflineCandidate(
  vehicle: ConnectivityVehicle,
  now = Date.now(),
  windowHours = 2,
): boolean {
  if (isNonOperationalTier(vehicle, now)) return false;
  const bucket = connectivityBucket(vehicle, { windowHours, now });
  if (bucket === NO_RECENT_COMMUNICATION || bucket === 'Offline') return true;
  const ageH = gpsAgeHours(vehicle, now);
  return ageH != null && ageH >= 2;
}

export function countConnectivityFromGps(
  vehicles: ConnectivityVehicle[],
  eventType: string,
  windowHours = 24,
): number {
  const normalized = normalizeConnectivityEventType(eventType);
  if (!isConnectivityEventType(normalized)) return 0;
  return vehicles.filter(v => connectivityBucket(v, { windowHours }) === normalized).length;
}

export function connectivityCountsFromGps(vehicles: ConnectivityVehicle[], windowHours = 24) {
  const counts: Record<ConnectivityEventType, number> = {
    [NO_RECENT_COMMUNICATION]: 0,
    Offline: 0,
    'Non-Operational': 0,
  };
  for (const v of vehicles) {
    const bucket = connectivityBucket(v, { windowHours });
    if (bucket) counts[bucket] += 1;
  }
  return counts;
}
