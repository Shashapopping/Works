const SYSTEM_DRIVER_IDS = new Set([
  '-7564450339336730068', // MiX "Unknown"
  '-4331286019934761070', // No Driver Assigned
]);

export function isActiveDriverId(driverId?: string | null): boolean {
  if (!driverId) return false;
  return !SYSTEM_DRIVER_IDS.has(String(driverId));
}

/** Returns false for missing, N/A, Unknown, and synthetic Unknown (assetId) keys. */
export function isKnownDriver(name?: string | null): boolean {
  if (!name) return false;
  const norm = name.trim().toLowerCase();
  if (!norm) return false;
  if (norm === 'n/a' || norm === 'unknown' || norm === 'unknown driver') return false;
  if (norm === 'no driver assigned' || norm === 'no driver') return false;
  if (norm === 'n/a (n/a)') return false;
  if (norm.startsWith('unknown (')) return false;
  return true;
}

export function isActiveDriver(name?: string | null, driverId?: string | null): boolean {
  if (driverId && !isActiveDriverId(driverId)) return false;
  return isKnownDriver(name);
}

export function displayDriverName(name?: string | null, fallback = '—'): string {
  if (!isKnownDriver(name)) return fallback;
  return name!.trim();
}
