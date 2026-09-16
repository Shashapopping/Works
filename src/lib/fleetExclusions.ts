/**
 * Fleet placements excluded from the live dashboard fleet (Assets, map, counts, site picker).
 * Mirrors MiX “not in active ops” buckets — keep scripts/fleet-exclusions.js in sync.
 */

export const DECOMMISSIONED_SITE = 'XN - Decommissioned';
export const NON_OPERATIONAL_ZONE = 'Non Operational in HBM Operations';

const DECOMMISSIONED_RE = /XN\s*-\s*Decommissioned/i;
const NON_OPERATIONAL_ZONE_RE = /Non\s*Operational\s*in\s*HBM/i;

export function isDecommissionedSite(name?: string | null): boolean {
  if (!name) return false;
  return DECOMMISSIONED_RE.test(String(name).trim());
}

/** True when zone (or site label) is under Non Operational in HBM Operations. */
export function isNonOperationalPlacement(zoneOrSite?: string | null): boolean {
  if (!zoneOrSite) return false;
  return NON_OPERATIONAL_ZONE_RE.test(String(zoneOrSite).trim());
}

export function isExcludedUserState(userState?: string | null): boolean {
  return String(userState || '').trim() === 'Decommissioned';
}

/** Drop from fleet lists — decommissioned site/state or Non Operational zone. */
export function isExcludedFleetPlacement(input: {
  site?: string | null;
  zone?: string | null;
  userState?: string | null;
}): boolean {
  if (isExcludedUserState(input.userState)) return true;
  if (isDecommissionedSite(input.site)) return true;
  if (isNonOperationalPlacement(input.zone) || isNonOperationalPlacement(input.site)) return true;
  return false;
}
