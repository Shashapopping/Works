/**
 * Shared /api/events/log behaviour (prod server + Vite middleware).
 * format=page → { entries, total }. Supports q / assetId / assetIds search.
 */
import fs from 'fs';
import path from 'path';
import { getAllEvents } from './db.js';
import { countMatchingEvents } from './event-aggregates.js';

let vehicleLookupCache = { map: new Map(), mtimeMs: 0 };

/** data.json is rewritten by the MiX poller every ~30s — cache the parsed
 *  lookup by mtime instead of re-reading/re-parsing it on every request. */
function vehicleLookup() {
  const dataPath = path.join(process.cwd(), 'public', 'data.json');
  try {
    const stat = fs.statSync(dataPath);
    if (stat.mtimeMs === vehicleLookupCache.mtimeMs) return vehicleLookupCache.map;

    const map = new Map();
    const vehicles = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    vehicles.forEach(v => {
      map.set(v.id?.toString(), {
        regNo: v.regNo || 'N/A',
        assetName: v.assetName || 'Unknown Vehicle',
        transporter: v.transporter || 'N/A',
        position: v.position,
        site: v.site || null,
        zone: v.zone || null,
      });
    });
    vehicleLookupCache = { map, mtimeMs: stat.mtimeMs };
    return map;
  } catch {
    return vehicleLookupCache.map;
  }
}

function enrichEvent(entry, lookup) {
  const vehicle = lookup.get(entry.asset_id?.toString()) || {};
  const enriched = {
    timestamp: entry.timestamp,
    assetId: entry.asset_id,
    driverId: entry.driver_id,
    driverName: entry.driver_name,
    driverPhone: entry.driver_phone,
    eventId: entry.event_id,
    eventType: entry.event_type,
    label: entry.label,
    eventTime: entry.event_time,
    receivedAt: entry.received_at,
    latitude: entry.latitude,
    longitude: entry.longitude,
    address: entry.address || vehicle.position?.address || null,
    speed: entry.speed ?? null,
    speedLimit: entry.speed_limit ?? null,
    type: entry.type,
    regNo: vehicle.regNo || 'N/A',
    assetName: vehicle.assetName || 'Unknown Vehicle',
    transporter: vehicle.transporter || 'N/A',
    site: vehicle.site || null,
    zone: vehicle.zone || null,
  };
  if ((enriched.latitude == null || enriched.longitude == null) && vehicle.position) {
    enriched.latitude = vehicle.position.latitude;
    enriched.longitude = vehicle.position.longitude;
  }
  if (!enriched.address && vehicle.position?.address) {
    enriched.address = vehicle.position.address;
  }
  return enriched;
}

function parseTypes(raw) {
  if (!raw) return null;
  const list = String(raw).split(',').map(t => t.trim()).filter(Boolean);
  return list.length ? list : null;
}

function parseAssetIds(raw, singleRaw) {
  if (raw) {
    const list = String(raw).split(',').map(t => t.trim()).filter(Boolean);
    return list.length ? list : null;
  }
  const single = (singleRaw || '').trim();
  return single ? [single] : null;
}

function parseScopeKeyList(raw) {
  if (raw == null || raw === '') return null;
  const list = String(raw).split(',').map(t => t.trim()).filter(Boolean);
  return list.length ? [...new Set(list)] : null;
}

function siteKeyFor(value) {
  const v = String(value || '').trim();
  return v || 'Unknown';
}

function assetIdsForSiteScope(siteScope, lookup) {
  const keys = parseScopeKeyList(siteScope);
  if (!keys) return null;
  const allowed = new Set(keys.map(k => String(k).trim().toLowerCase()));
  const ids = [];
  for (const [assetId, vehicle] of lookup.entries()) {
    const zone = siteKeyFor(vehicle.zone).toLowerCase();
    const site = String(vehicle.site || '').trim().toLowerCase();
    const transporter = String(vehicle.transporter || '').trim().toLowerCase();
    if (allowed.has(zone) || allowed.has(site) || allowed.has(transporter)) {
      ids.push(String(assetId));
    }
  }
  return [...new Set(ids)];
}

function mergeAssetScopes(explicitIds, siteIds) {
  if (!siteIds) return explicitIds;
  if (!explicitIds) return siteIds;
  const selected = new Set(siteIds.map(String));
  return explicitIds.filter(id => selected.has(String(id)));
}

function isDateOnlyToken(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

function eventRangeBounds(range, from, to) {
  if (from || to) return { from, to };
  const now = new Date();
  const r = String(range || '').toLowerCase();
  let start = null;
  if (r === 'today' || r === 'day') {
    start = new Date(now);
    start.setHours(0, 0, 0, 0);
  } else if (r === '7d' || r === '7days' || r === 'week') {
    start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - 6);
  } else if (r === '30d' || r === '30days') {
    start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - 29);
  }
  return {
    from: start ? start.toISOString() : null,
    to: start ? now.toISOString() : null,
  };
}

function normalizeDateBound(value, endOfDay = false) {
  if (!value) return null;
  const token = String(value);
  if (isDateOnlyToken(token)) return token.trim() + 'T' + (endOfDay ? '23:59:59.999' : '00:00:00');
  return token;
}
function matchesSearch(entry, q) {
  if (!q) return true;
  const s = q.toLowerCase();
  return (
    (entry.regNo && entry.regNo !== 'N/A' && entry.regNo.toLowerCase().includes(s))
    || (entry.assetName && entry.assetName.toLowerCase().includes(s))
    || (entry.assetId && String(entry.assetId).toLowerCase().includes(s))
    || (entry.driverName && entry.driverName !== 'N/A' && entry.driverName.toLowerCase().includes(s))
  );
}

/**
 * @param {{ from?: string|null, to?: string|null, range?: string|null, types?: string|null, limit?: string|null, offset?: string|null, format?: string|null, driver?: string|null, driverName?: string|null, q?: string|null, search?: string|null, assetId?: string|null, assetIds?: string|null, sites?: string|null, siteScope?: string|null, excludeHidden?: string|null }} query
 */
export function handleEventsLogQuery(query = {}) {
  const lookup = vehicleLookup();
  const rangeBounds = eventRangeBounds(query.range, query.from || null, query.to || null);
  const from = normalizeDateBound(rangeBounds.from, false);
  const to = normalizeDateBound(rangeBounds.to, true);
  const types = parseTypes(query.types);
  const driver = query.driver || query.driverName ? String(query.driver || query.driverName) : null;
  const q = (query.q || query.search || '').trim();
  const explicitAssetIds = parseAssetIds(query.assetIds, query.assetId);
  const siteAssetIds = assetIdsForSiteScope(query.siteScope || query.sites, lookup);
  const assetIds = mergeAssetScopes(explicitAssetIds, siteAssetIds);
  const format = String(query.format || '').toLowerCase();
  const excludeHidden = query.excludeHidden === true || query.excludeHidden === '1' || query.excludeHidden === 'true';

  const needsPostFilter = Boolean(q);
  const fetchLimit = needsPostFilter ? null : undefined;

  if (format === 'page') {
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 500);
    const offset = Math.max(Number(query.offset) || 0, 0);

    let entries = getAllEvents({
      from,
      to,
      types,
      limit: needsPostFilter ? null : limit,
      offset: needsPostFilter ? 0 : offset,
      driver,
      assetIds,
      excludeHidden,
    }).map(e => enrichEvent(e, lookup));

    if (q) {
      entries = entries.filter(e => matchesSearch(e, q));
    }

    let total;
    if (needsPostFilter) {
      total = entries.length;
      entries = entries.slice(offset, offset + limit);
    } else {
      total = countMatchingEvents({ from, to, types, driver, assetIds, excludeHidden });
    }
    return { entries, total };
  }

  const limitRaw = query.limit;
  const hasRange = !!(from || to);
  let limit;
  if (limitRaw == null || limitRaw === '' || String(limitRaw).toLowerCase() === 'all') {
    limit = hasRange ? null : 500;
  } else {
    limit = Math.min(Math.max(Number(limitRaw) || 500, 1), 20000);
  }

  let entries = getAllEvents({
    from,
    to,
    types,
    limit: fetchLimit ?? limit,
    driver,
    assetIds,
      excludeHidden,
    }).map(e => enrichEvent(e, lookup));

  if (q) {
    entries = entries.filter(e => matchesSearch(e, q));
  }

  return entries;
}
