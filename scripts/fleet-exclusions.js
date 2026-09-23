/**
 * Fleet placements excluded from the live dashboard fleet.
 * Keep in sync with src/lib/fleetExclusions.ts.
 */

import fs from 'fs';
import path from 'path';

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

/**
 * Asset IDs in the live fleet snapshot (data.json) — already excludes XN Decommissioned
 * and Non Operational in HBM Operations. Use when a query would otherwise mean "all SQLite".
 */
export function liveFleetAssetIds(cwd = process.cwd()) {
  try {
    const dataPath = path.join(cwd, 'public', 'data.json');
    if (!fs.existsSync(dataPath)) return [];
    const vehicles = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    if (!Array.isArray(vehicles)) return [];
    return [...new Set(
      vehicles
        .map(v => (v?.id != null ? String(v.id) : ''))
        .filter(Boolean),
    )];
  } catch {
    return [];
  }
}

/** Keep only asset IDs that are in the live (non-excluded) fleet. */
export function restrictToLiveFleet(assetIds, cwd = process.cwd()) {
  if (assetIds == null) return liveFleetAssetIds(cwd);
  const live = new Set(liveFleetAssetIds(cwd));
  if (live.size === 0) return [];
  return assetIds.map(id => String(id)).filter(id => live.has(id));
}
