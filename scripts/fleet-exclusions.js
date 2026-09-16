/**
 * Fleet placements excluded from the live dashboard fleet.
 * Keep in sync with src/lib/fleetExclusions.ts.
 */

export const DECOMMISSIONED_SITE = 'XN - Decommissioned';
export const NON_OPERATIONAL_ZONE = 'Non Operational in HBM Operations';

const DECOMMISSIONED_RE = /XN\s*-\s*Decommissioned/i;
const NON_OPERATIONAL_ZONE_RE = /Non\s*Operational\s*in\s*HBM/i;

export function isDecommissionedSite(name) {
  if (!name) return false;
  return DECOMMISSIONED_RE.test(String(name).trim());
}

export function isNonOperationalPlacement(zoneOrSite) {
  if (!zoneOrSite) return false;
  return NON_OPERATIONAL_ZONE_RE.test(String(zoneOrSite).trim());
}

export function isExcludedUserState(userState) {
  return String(userState || '').trim() === 'Decommissioned';
}

export function isExcludedFleetPlacement({ site, zone, userState } = {}) {
  if (isExcludedUserState(userState)) return true;
  if (isDecommissionedSite(site)) return true;
  if (isNonOperationalPlacement(zone) || isNonOperationalPlacement(site)) return true;
  return false;
}
