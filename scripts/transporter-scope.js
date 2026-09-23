/**
 * Resolve fleet asset IDs for site / transporter scope (admin site selector + transporter lock).
 */
import fs from 'fs';
import path from 'path';
import { getRequestUser } from './auth-jwt.js';
import { liveFleetAssetIds, restrictToLiveFleet } from './fleet-exclusions.js';

export function parseAssetIdList(value) {
  if (value == null || value === '') return null;
  const ids = [...new Set(
    (Array.isArray(value) ? value : String(value).split(','))
      .map(id => String(id || '').trim())
      .filter(Boolean),
  )];
  return ids.length ? ids : null;
}

export function parseScopeKeyList(value) {
  if (value == null || value === '') return null;
  const keys = [...new Set(
    (Array.isArray(value) ? value : String(value).split(','))
      .map(key => String(key || '').trim())
      .filter(Boolean),
  )];
  return keys.length ? keys : null;
}

function siteKeyFor(zone) {
  const z = String(zone || '').trim();
  return z || 'Unknown';
}

/** Map site/transporter/zone names → vehicle asset ids from data.json. */
export function assetIdsForSiteScope(siteScope) {
  const keys = parseScopeKeyList(siteScope);
  if (!keys) return null;
  const allowed = new Set(keys);
  const allowedLower = new Set(keys.map(k => k.toLowerCase()));
  try {
    const dataPath = path.join(process.cwd(), 'public', 'data.json');
    if (!fs.existsSync(dataPath)) return [];
    const vehicles = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    if (!Array.isArray(vehicles)) return [];
    return [...new Set(
      vehicles
        .filter(v => {
          const site = String(v.site || '').trim();
          const transporter = String(v.transporter || '').trim();
          const zone = siteKeyFor(v.zone);
          return allowed.has(site)
            || allowed.has(transporter)
            || allowed.has(zone)
            || allowedLower.has(site.toLowerCase())
            || allowedLower.has(transporter.toLowerCase())
            || allowedLower.has(zone.toLowerCase());
        })
        .map(v => (v.id != null ? String(v.id) : ''))
        .filter(Boolean),
    )];
  } catch {
    return [];
  }
}

/**
 * Resolve request scope to asset IDs.
 * Unscoped (null/empty) → live fleet only (drops XN Decommissioned + Non Operational).
 */
export function resolveAssetScope(assetIds = null, siteScope = null) {
  const explicit = parseAssetIdList(assetIds);
  if (explicit) return restrictToLiveFleet(explicit);
  const fromSites = assetIdsForSiteScope(siteScope);
  if (fromSites) return fromSites;
  return liveFleetAssetIds();
}

/** Asset ids locked to the signed-in transporter account (null = not locked). */
export function scopedTransporterAssetIds(req) {
  const user = getRequestUser(req);
  const transporters = Array.isArray(user?.transporters)
    ? user.transporters.map(t => String(t || '').trim()).filter(Boolean)
    : [];
  if (transporters.length === 0) return null;
  return assetIdsForSiteScope(transporters) || [];
}

/**
 * Intersect optional request assetIds/siteScope with transporter lock when present.
 * Returns a comma-joined id list, an array, or null (unscoped).
 */
export function applySignedInTransporterScope(req, assetIds = null, siteScope = null) {
  const locked = scopedTransporterAssetIds(req);
  const requested = resolveAssetScope(assetIds, siteScope);
  if (!locked) return requested;
  if (!requested) return locked;
  const allowed = new Set(locked);
  return requested.filter(id => allowed.has(id));
}

export function assetIdsQueryValue(ids) {
  if (ids == null) return null;
  if (Array.isArray(ids)) {
    // Empty lock must not become "unscoped" — keep a non-matching sentinel.
    if (ids.length === 0) return '__none__';
    return ids.join(',');
  }
  return String(ids);
}
