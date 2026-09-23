import fs from 'fs';
import path from 'path';
import { getFuelHistory } from './db.js';
import { memoApiResponse, apiCacheKey } from './api-response-cache.js';

let vehicleLookupCache = null;
let vehicleLookupMtimeMs = 0;

function parseBounds({ period = 'day', from = null, to = null } = {}) {
  const now = Date.now();
  if (from && to) {
    const start = new Date(from).getTime();
    const endDate = new Date(to);
    endDate.setHours(23, 59, 59, 999);
    const end = endDate.getTime();
    if (Number.isNaN(start) || Number.isNaN(end)) return null;
    return { start, end };
  }
  const cutoffs = {
    day: 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
    month: 30 * 24 * 60 * 60 * 1000,
  };
  return { start: now - (cutoffs[period] || cutoffs.day), end: now };
}

function loadVehicleLookup(cwd = process.cwd()) {
  const dataPath = path.join(cwd, 'public', 'data.json');
  if (!fs.existsSync(dataPath)) return new Map();
  try {
    const mtimeMs = fs.statSync(dataPath).mtimeMs;
    if (vehicleLookupCache && vehicleLookupMtimeMs === mtimeMs) return vehicleLookupCache;
    const lookup = new Map();
    JSON.parse(fs.readFileSync(dataPath, 'utf8')).forEach(v => {
      lookup.set(v.id?.toString(), {
        regNo: v.regNo,
        assetName: v.assetName,
        zone: v.zone,
        site: v.site || '',
        transporter: v.transporter || '',
      });
    });
    vehicleLookupCache = lookup;
    vehicleLookupMtimeMs = mtimeMs;
    return lookup;
  } catch {
    return vehicleLookupCache ?? new Map();
  }
}

function parseAssetIdList(raw) {
  if (raw == null || raw === '') return null;
  const list = (Array.isArray(raw) ? raw : String(raw).split(','))
    .map(id => String(id || '').trim())
    .filter(Boolean);
  return list.length ? [...new Set(list)] : null;
}

function parseScopeKeyList(raw) {
  if (raw == null || raw === '') return null;
  const list = String(raw).split(',').map(t => t.trim()).filter(Boolean);
  return list.length ? [...new Set(list)] : null;
}

function resolveAssetIds(vehicles, assetIds, siteScope) {
  const explicit = parseAssetIdList(assetIds);
  const siteKeys = parseScopeKeyList(siteScope);
  if (!explicit && !siteKeys) {
    // Unscoped → live fleet only (vehicles map is already data.json).
    return [...vehicles.keys()];
  }
  let ids = explicit;
  if (siteKeys) {
    const allowed = new Set(siteKeys.map(k => String(k).trim().toLowerCase()));
    const siteIds = [...vehicles.entries()]
      .filter(([, v]) => {
        const zone = String(v.zone || '').trim().toLowerCase() || 'unknown';
        const site = String(v.site || '').trim().toLowerCase();
        const transporter = String(v.transporter || '').trim().toLowerCase();
        return allowed.has(zone) || allowed.has(site) || allowed.has(transporter);
      })
      .map(([id]) => id);
    ids = ids ? ids.filter(id => siteIds.includes(id)) : siteIds;
  }
  return [...new Set(ids || [])];
}
function computeFuelHistoryResponse({ cwd = process.cwd(), period = 'day', from = null, to = null, assetIds = null, siteScope = null } = {}) {
  const bounds = parseBounds({ period, from, to });
  if (!bounds) {
    const err = new Error('Invalid from/to dates');
    err.statusCode = 400;
    throw err;
  }

  const vehicles = loadVehicleLookup(cwd);
  const scopedAssetIds = resolveAssetIds(vehicles, assetIds, siteScope);
  const entries = getFuelHistory({
    fromIso: new Date(bounds.start).toISOString(),
    toIso: new Date(bounds.end).toISOString(),
    assetIds: scopedAssetIds,
  });

  const seriesMap = new Map();
  entries.forEach(entry => {
    if (!entry.assetId) return;
    if (!seriesMap.has(entry.assetId)) seriesMap.set(entry.assetId, []);
    seriesMap.get(entry.assetId).push({
      time: entry.timestamp,
      level: Math.max(0, entry.level),
    });
  });
  const result = [];
  seriesMap.forEach((data, assetId) => {
    data.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
    const info = vehicles.get(assetId) || {};
    result.push({
      assetId,
      regNo: (info.regNo || assetId).toString().trim(),
      assetName: info.assetName || '',
      zone: info.zone || '',
      data,
    });
  });
  return result;
}

export function getFuelHistoryResponse(options = {}) {
  const period = options.period || 'day';
  const ttlMs = options.from && options.to
    ? 5 * 60_000
    : period === 'day'
      ? 60_000
      : 5 * 60_000;
  return memoApiResponse(
    'fuel-history',
    ttlMs,
    apiCacheKey({
      period,
      from: options.from || null,
      to: options.to || null,
      cwd: options.cwd || process.cwd(),
      assetIds: options.assetIds || null,
      siteScope: options.siteScope || options.sites || null,
    }),
    () => computeFuelHistoryResponse({ ...options, period }),
  );
}

export function getFuelSeriesResponse(options = {}) {
  return getFuelHistoryResponse(options);
}
