/**
 * Fleet / quarry utilization from trips (drive, idle/stand, engine-on).
 * No load events, no kpi_events.
 */
import fs from 'fs';
import path from 'path';
import { loadUtilRollupsByAsset } from './db.js';

const QUARRY_ZONES = new Set(['QUARRY EWEKORO', 'QUARRY MFAMOSING']);

const RESULT_FRESH_TTL_MS = 120_000;
const RESULT_STALE_TTL_MS = 300_000;
const RESULT_CACHE_MAX = 8;
const resultCache = new Map();
const inflightRefresh = new Set();

let vehiclesLookupCache = null;
let vehiclesLookupMtimeMs = 0;

function cacheKey({ period, from, to, scope, assetScope = '*' }) {
  return `${period || 'week'}|${from || ''}|${to || ''}|${scope || 'all'}|${assetScope}`;
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

function assetScopeCacheKey(ids) {
  if (!ids) return '*';
  const s = ids.slice().sort().join(',');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return `${ids.length}:${(h >>> 0).toString(16)}`;
}

function resolveAssetScope(vehicles, assetIds = null, siteScope = null) {
  const explicit = parseAssetIdList(assetIds);
  const siteKeys = parseScopeKeyList(siteScope);
  if (!explicit && !siteKeys) return null;
  let ids = explicit;
  if (siteKeys) {
    const allowed = new Set(siteKeys.map(k => String(k).trim().toLowerCase()));
    const siteIds = [...vehicles.entries()]
      .filter(([, v]) => {
        const zone = String(v.zone || 'Unknown').trim().toLowerCase();
        const site = String(v.site || '').trim().toLowerCase();
        const transporter = String(v.transporter || '').trim().toLowerCase();
        return allowed.has(zone) || allowed.has(site) || allowed.has(transporter);
      })
      .map(([id]) => id);
    ids = ids ? ids.filter(id => siteIds.includes(id)) : siteIds;
  }
  return [...new Set(ids || [])];
}

function parsePeriodBounds(period, fromQ, toQ) {
  const now = Date.now();
  if (fromQ && toQ) {
    const start = new Date(fromQ).getTime();
    const endDate = new Date(toQ);
    endDate.setHours(23, 59, 59, 999);
    return { start, end: Math.min(endDate.getTime(), now) };
  }
  const cutoffs = { day: 86400000, week: 604800000, month: 2592000000 };
  const ms = cutoffs[period] || cutoffs.week;
  return { start: now - ms, end: now };
}

function classifyAsset(regNo = '', assetName = '') {
  const key = `${regNo} ${assetName}`.toUpperCase();
  if (/\b(DT|RD)\s?\d/.test(key)) return 'dumpTruck';
  if (/\bEXC?\s?\d/.test(key)) return 'excavator';
  return 'other';
}

function loadVehicles(cwd) {
  const dataPath = path.join(cwd, 'public', 'data.json');
  try {
    if (!fs.existsSync(dataPath)) return new Map();
    const mtimeMs = fs.statSync(dataPath).mtimeMs;
    if (vehiclesLookupCache && mtimeMs === vehiclesLookupMtimeMs) return vehiclesLookupCache;

    const map = new Map();
    JSON.parse(fs.readFileSync(dataPath, 'utf8')).forEach(v => {
      map.set(v.id?.toString(), {
        regNo: v.regNo || v.id,
        assetName: v.assetName || '',
        transporter: (v.transporter || v.site || '').trim(),
        site: (v.site || '').trim(),
        zone: (v.zone || '').toUpperCase(),
        assetClass: classifyAsset(v.regNo, v.assetName),
      });
    });

    vehiclesLookupCache = map;
    vehiclesLookupMtimeMs = mtimeMs;
    return map;
  } catch {
    return vehiclesLookupCache ?? new Map();
  }
}

function tripDriveSeconds(t) {
  const d = Number(t.DrivingTime ?? t.drivingTimeSeconds);
  if (Number.isFinite(d) && d > 0) return d;
  const h = Number(t.drivingHours);
  if (Number.isFinite(h) && h > 0) return h * 3600;
  return 0;
}

function tripEngineSeconds(t) {
  const engH = Number(t.engineHours);
  if (Number.isFinite(engH) && engH > 0) return engH * 3600;
  const engSec = Number(t.EngineSeconds);
  if (Number.isFinite(engSec) && engSec > 0) return engSec;
  const drive = tripDriveSeconds(t);
  const standH = Number(t.standingHours);
  const stand = Number.isFinite(standH) && standH > 0
    ? standH * 3600
    : (Number(t.StandingTime) || 0);
  if (drive + stand > 0) return drive + stand;
  // Legacy rows ingested before SubTrips only stored Duration.
  if (!t.hasSubTrips) {
    const dur = Number(t.Duration ?? t.durationSeconds);
    if (Number.isFinite(dur) && dur > 0) return dur;
  }
  return 0;
}

function tripIdleSeconds(t, engineSec, driveSec) {
  const idleH = Number(t.idleHours);
  if (Number.isFinite(idleH) && idleH > 0) return idleH * 3600;
  const standH = Number(t.standingHours);
  if (Number.isFinite(standH) && standH > 0) return standH * 3600;
  return Math.max(0, engineSec - driveSec);
}

function computeRuntime(trips) {
  const result = new Map();
  trips.forEach(t => {
    const assetId = (t.AssetId ?? t.assetId)?.toString();
    if (!assetId) return;
    const engineSeconds = tripEngineSeconds(t);
    const drivingSeconds = tripDriveSeconds(t);
    const idleSeconds = tripIdleSeconds(t, engineSeconds, drivingSeconds);
    const distance = Number(t.DistanceKilometers ?? t.distanceKm) || 0;
    if (!result.has(assetId)) {
      result.set(assetId, { engineSeconds: 0, drivingSeconds: 0, idleSeconds: 0, distanceKm: 0, tripCount: 0 });
    }
    const row = result.get(assetId);
    row.engineSeconds += engineSeconds;
    row.drivingSeconds += drivingSeconds;
    row.idleSeconds += idleSeconds;
    row.distanceKm += distance;
    row.tripCount += 1;
  });
  return result;
}

export function computeUtilization({
  cwd = process.cwd(),
  period = 'week',
  from,
  to,
  scope = 'all',
  assetIds = null,
  siteScope = null,
  sites = null,
} = {}) {
  const vehicles = loadVehicles(cwd);
  const ids = resolveAssetScope(vehicles, assetIds, siteScope ?? sites);
  const key = cacheKey({ period, from, to, scope, assetScope: assetScopeCacheKey(ids) });
  const cached = resultCache.get(key);
  if (cached) {
    const ageMs = Date.now() - cached.at;
    if (ageMs < RESULT_FRESH_TTL_MS) return cached.data;
    if (ageMs < RESULT_STALE_TTL_MS) {
      if (!inflightRefresh.has(key)) {
        inflightRefresh.add(key);
        setImmediate(() => {
          try {
            const result = computeUtilizationFresh({ cwd, period, from, to, scope, scopedAssetIds: ids, vehicles });
            resultCache.set(key, { at: Date.now(), data: result });
            while (resultCache.size > RESULT_CACHE_MAX) {
              const oldest = resultCache.keys().next().value;
              resultCache.delete(oldest);
            }
          } catch {
            // keep stale
          } finally {
            inflightRefresh.delete(key);
          }
        });
      }
      return cached.data;
    }
  }

  const result = computeUtilizationFresh({ cwd, period, from, to, scope, scopedAssetIds: ids, vehicles });
  resultCache.set(key, { at: Date.now(), data: result });
  while (resultCache.size > RESULT_CACHE_MAX) {
    const oldest = resultCache.keys().next().value;
    resultCache.delete(oldest);
  }
  return result;
}

function emptyPayload(start, end, windowHours, scope) {
  return {
    generatedAt: new Date().toISOString(),
    period: { start: new Date(start).toISOString(), end: new Date(end).toISOString() },
    windowHours,
    scope,
    summary: {
      assetCount: 0,
      fleetAssetCount: 0,
      assetsWithTrips: 0,
      totalEngineHours: 0,
      totalDrivingHours: 0,
      totalIdleHours: 0,
      totalDistanceKm: 0,
      avgUtilizationPct: null,
      avgAvailabilityPct: null,
    },
    assets: [],
  };
}

function computeUtilizationFresh({
  cwd = process.cwd(),
  period = 'week',
  from,
  to,
  scope = 'all',
  scopedAssetIds = null,
  vehicles: providedVehicles = null,
} = {}) {
  const { start, end } = parsePeriodBounds(period, from, to);
  const windowHours = (end - start) / 3600000;
  const vehicles = providedVehicles || loadVehicles(cwd);

  const assetIds = new Set();
  if (scope === 'quarry') {
    vehicles.forEach((v, id) => { if (QUARRY_ZONES.has(v.zone)) assetIds.add(id); });
  } else {
    vehicles.forEach((_, id) => assetIds.add(id));
  }
  if (scopedAssetIds) {
    const scoped = new Set(scopedAssetIds.map(id => id?.toString()).filter(Boolean));
    [...assetIds].forEach(id => { if (!scoped.has(id)) assetIds.delete(id); });
  }

  if (assetIds.size === 0) return emptyPayload(start, end, windowHours, scope);

  const rollups = loadUtilRollupsByAsset(
    new Date(start).toISOString(),
    new Date(end + 1).toISOString(),
    [...assetIds],
  );
  const runtimeByAsset = new Map(
    rollups.map(r => [String(r.assetId), r]),
  );

  const fleetAssetCount = assetIds.size;
  let assetsWithTrips = 0;
  const assets = [...assetIds].map(id => {
    const info = vehicles.get(id) || {};
    const r = runtimeByAsset.get(id);
    const engineHours = Number(r?.totalEngineHours) || 0;
    const drivingHours = Number(r?.totalDrivingHours) || 0;
    const idleHours = Number(r?.totalIdleHours) || 0;
    const tripCount = Number(r?.tripCount) || 0;
    if (tripCount > 0) assetsWithTrips += 1;
    return {
      assetId: id,
      regNo: info.regNo || id,
      assetName: info.assetName || '',
      transporter: info.transporter || '',
      zone: info.zone || '',
      assetClass: info.assetClass || 'other',
      engineHours,
      drivingHours,
      idleHours,
      tripCount,
      distanceKm: Number(r?.totalDistanceKm) || 0,
      utilizationPct: engineHours > 0 ? Math.min(100, (drivingHours / engineHours) * 100) : null,
      availabilityPct: windowHours > 0 && engineHours > 0 ? Math.min(100, (engineHours / windowHours) * 100) : null,
    };
  }).filter(a => a.tripCount > 0 || a.engineHours > 0 || a.distanceKm > 0)
    .sort((a, b) => (a.regNo || '').localeCompare(b.regNo || ''));

  const sum = (fn) => assets.reduce((s, a) => s + fn(a), 0);
  const withUtil = assets.filter(a => a.utilizationPct != null);
  const withAvail = assets.filter(a => a.availabilityPct != null);

  return {
    generatedAt: new Date().toISOString(),
    period: { start: new Date(start).toISOString(), end: new Date(end).toISOString() },
    windowHours,
    scope,
    summary: {
      assetCount: assets.length,
      fleetAssetCount,
      assetsWithTrips,
      totalEngineHours: sum(a => a.engineHours),
      totalDrivingHours: sum(a => a.drivingHours),
      totalIdleHours: sum(a => a.idleHours),
      totalDistanceKm: sum(a => a.distanceKm),
      avgUtilizationPct: withUtil.length ? withUtil.reduce((s, a) => s + a.utilizationPct, 0) / withUtil.length : null,
      avgAvailabilityPct: withAvail.length ? withAvail.reduce((s, a) => s + a.availabilityPct, 0) / withAvail.length : null,
    },
    assets,
  };
}
