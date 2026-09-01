/**
 * Operational KPI engine — utilization, availability, harsh braking,
 * overspeeding and fatigue management, computed from fleet.db:
 *   kpi_events, events, trips + public/data.json (zones)
 */
import fs from 'fs';
import path from 'path';
import { KPI_CATEGORY } from './kpi-constants.js';
import { getKpiEvents, getAllEvents, getTripsInRange } from './db.js';
import { qualifiesAsOverspeed } from './overspeed-filter.js';

const QUARRY_ZONES = new Set(['QUARRY EWEKORO', 'QUARRY MFAMOSING']);

// A loaded interval without an offload event is capped at this length
const MAX_LOADED_INTERVAL_MS = 2 * 60 * 60 * 1000;
// Overspeed events without an explicit end are assumed to last this long
const DEFAULT_OVERSPEED_SECONDS = 30;

/** Avoid re-scanning multi-MB logs on every page open (~20s+ cold). */
// Stale-while-revalidate: serve instantly, refresh in background.
const KPI_RESULT_FRESH_TTL_MS = 120_000;
const KPI_RESULT_STALE_TTL_MS = 300_000;
const KPI_RESULT_CACHE_MAX = 8;
const kpiResultCache = new Map();
const kpiInflightRefresh = new Set();

// mtime-guarded cache for rarely-changing lookups.
let vehiclesLookupCache = null;
let vehiclesLookupMtimeMs = 0;

function kpiCacheKey({ period, from, to, scope }) {
  return `${period || 'week'}|${from || ''}|${to || ''}|${scope || 'quarry'}`;
}

function tripInWindow(t, start, end) {
  const raw = t.TripEnd || t.tripEnd || t.TripStart || t.tripStart;
  const ts = raw ? new Date(raw).getTime() : NaN;
  return Number.isFinite(ts) && ts >= start && ts <= end;
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

function eventMs(e) {
  const raw = e.eventTime || e.timestamp;
  const t = raw ? new Date(raw).getTime() : NaN;
  return Number.isFinite(t) ? t : null;
}

/**
 * Pair loaded/offload events per asset into loaded intervals.
 * Returns Map assetId → { loadedSeconds, loadCount }.
 */
function computeLoadedDurations(kpiEvents, start, end) {
  const byAsset = new Map();
  kpiEvents.forEach(e => {
    if (e.category !== KPI_CATEGORY.LOADED
      && e.category !== KPI_CATEGORY.OFFLOAD
      && e.category !== KPI_CATEGORY.LOAD_DURATION) return;
    const t = eventMs(e);
    if (t == null || t < start - MAX_LOADED_INTERVAL_MS || t > end) return;
    if (!e.assetId) return;
    if (!byAsset.has(e.assetId)) byAsset.set(e.assetId, []);
    byAsset.get(e.assetId).push({ ...e, ms: t });
  });

  const result = new Map();
  byAsset.forEach((rows, assetId) => {
    rows.sort((a, b) => a.ms - b.ms);
    let loadedMs = 0;
    let loadCount = 0;
    let openSince = null;

    const closeInterval = (endMs) => {
      if (openSince == null) return;
      const capped = Math.min(endMs, openSince + MAX_LOADED_INTERVAL_MS);
      const s = Math.max(openSince, start);
      const f = Math.min(capped, end);
      if (f > s) loadedMs += f - s;
      openSince = null;
    };

    rows.forEach(e => {
      if (e.category === KPI_CATEGORY.LOAD_DURATION && e.endTime) {
        // Direct duration event — trust its own start/end
        const endMs = new Date(e.endTime).getTime();
        if (Number.isFinite(endMs) && endMs > e.ms) {
          const s = Math.max(e.ms, start);
          const f = Math.min(endMs, end);
          if (f > s) loadedMs += f - s;
          loadCount += 1;
        }
        return;
      }
      if (e.category === KPI_CATEGORY.LOADED) {
        if (openSince == null) {
          openSince = e.ms;
          loadCount += 1;
        }
        // repeated "loaded" ticks while already open extend the same interval
      } else if (e.category === KPI_CATEGORY.OFFLOAD) {
        closeInterval(e.ms);
      }
    });
    closeInterval(end);

    result.set(assetId, { loadedSeconds: Math.round(loadedMs / 1000), loadCount });
  });
  return result;
}

/** Engine runtime per asset ≈ sum of trip Duration within period (from MiX trips). */
function computeEngineRuntime(trips, start, end) {
  const result = new Map();
  trips.forEach(t => {
    const assetId = (t.AssetId ?? t.assetId)?.toString();
    if (!assetId) return;
    const ts = new Date(t.TripEnd || t.TripStart || t.tripEnd || t.tripStart).getTime();
    if (!Number.isFinite(ts) || ts < start || ts > end) return;
    const seconds = t.Duration ?? t.durationSeconds ?? t.DrivingTime ?? t.drivingTimeSeconds ?? 0;
    const distance = t.DistanceKilometers ?? t.distanceKm ?? 0;
    if (!result.has(assetId)) result.set(assetId, { engineSeconds: 0, distanceKm: 0, tripCount: 0 });
    const row = result.get(assetId);
    row.engineSeconds += seconds;
    row.distanceKm += distance;
    row.tripCount += 1;
  });
  return result;
}

function overspeedSeconds(e) {
  if (e.endTime && (e.eventTime || e.timestamp)) {
    const s = new Date(e.eventTime || e.timestamp).getTime();
    const f = new Date(e.endTime).getTime();
    if (Number.isFinite(s) && Number.isFinite(f) && f > s) {
      return Math.min((f - s) / 1000, 30 * 60);
    }
  }
  return DEFAULT_OVERSPEED_SECONDS;
}

export function computeKpi({ cwd = process.cwd(), period = 'week', from, to, scope = 'quarry' } = {}) {
  const cacheKey = kpiCacheKey({ period, from, to, scope });
  const cached = kpiResultCache.get(cacheKey);
  if (cached) {
    const ageMs = Date.now() - cached.at;
    if (ageMs < KPI_RESULT_FRESH_TTL_MS) return cached.data;

    if (ageMs < KPI_RESULT_STALE_TTL_MS) {
      if (!kpiInflightRefresh.has(cacheKey)) {
        kpiInflightRefresh.add(cacheKey);
        setImmediate(() => {
          try {
            const result = computeKpiFresh({ cwd, period, from, to, scope });
            kpiResultCache.set(cacheKey, { at: Date.now(), data: result });
            while (kpiResultCache.size > KPI_RESULT_CACHE_MAX) {
              const oldest = kpiResultCache.keys().next().value;
              kpiResultCache.delete(oldest);
            }
          } catch {
            // Keep stale value if refresh fails.
          } finally {
            kpiInflightRefresh.delete(cacheKey);
          }
        });
      }
      return cached.data;
    }
    // else expired beyond stale window → recompute synchronously
  }

  const result = computeKpiFresh({ cwd, period, from, to, scope });
  kpiResultCache.set(cacheKey, { at: Date.now(), data: result });
  while (kpiResultCache.size > KPI_RESULT_CACHE_MAX) {
    const oldest = kpiResultCache.keys().next().value;
    kpiResultCache.delete(oldest);
  }
  return result;
}

function computeKpiFresh({ cwd = process.cwd(), period = 'week', from, to, scope = 'quarry' } = {}) {
  const { start, end } = parsePeriodBounds(period, from, to);
  const windowHours = (end - start) / 3600000;

  const vehicles = loadVehicles(cwd);
  // Scope filter determines which trips we even load from SQLite.
  const assetIds = new Set();
  if (scope === 'quarry') {
    vehicles.forEach((v, id) => { if (QUARRY_ZONES.has(v.zone)) assetIds.add(id); });
  } else {
    vehicles.forEach((_, id) => assetIds.add(id));
  }

  const trips = getTripsInRange(
    new Date(start).toISOString(),
    new Date(end + 1).toISOString(),
    assetIds.size ? [...assetIds] : null,
  );
  const kpiEvents = getKpiEvents({
    fromIso: new Date(start - MAX_LOADED_INTERVAL_MS).toISOString(),
    toIso: new Date(end).toISOString(),
  });
  // Merge harsh braking / overspeeding from both logs, dedupe by eventId
  const seenEventIds = new Set();
  const behaviourEvents = [];
  const pushBehaviour = (e, category) => {
    const id = e.eventId?.toString();
    if (id && seenEventIds.has(id)) return;
    if (id) seenEventIds.add(id);
    const t = eventMs(e);
    if (t == null || t < start || t > end) return;
    behaviourEvents.push({ ...e, category, ms: t });
  };

  kpiEvents.forEach(e => {
    if (e.category === KPI_CATEGORY.HARSH_BRAKING) pushBehaviour(e, KPI_CATEGORY.HARSH_BRAKING);
    else if (e.category === KPI_CATEGORY.OVERSPEED) {
      if (!qualifiesAsOverspeed(e.label || e.category, e.speed, { requireSpeed: true })) return;
      pushBehaviour(e, KPI_CATEGORY.OVERSPEED);
    }
  });
  getAllEvents({
    from: new Date(start).toISOString(),
    to: new Date(end).toISOString(),
    limit: null,
  }).forEach(row => {
    const e = {
      eventId: row.event_id,
      label: row.label,
      eventTime: row.event_time,
      timestamp: row.timestamp,
      assetId: row.asset_id,
      driverId: row.driver_id,
      speed: row.speed,
    };
    if (e.label === 'Harsh Braking') pushBehaviour(e, KPI_CATEGORY.HARSH_BRAKING);
    else if (e.label === 'Overspeeding' || e.label === 'Overspeed Tiered') {
      if (!qualifiesAsOverspeed(e.label, e.speed, { requireSpeed: true })) return;
      pushBehaviour(e, KPI_CATEGORY.OVERSPEED);
    }
  });

  const fatigueCategories = new Set([
    KPI_CATEGORY.FATIGUE_YAWNING,
    KPI_CATEGORY.FATIGUE_EYE_CLOSING,
    KPI_CATEGORY.DISTRACTION,
    KPI_CATEGORY.PHONE_DISTRACTION,
  ]);
  const fatigueEvents = kpiEvents.filter(e => {
    if (!fatigueCategories.has(e.category)) return false;
    const t = eventMs(e);
    return t != null && t >= start && t <= end;
  });

  const loadedByAsset = computeLoadedDurations(kpiEvents, start, end);
  const runtimeByAsset = computeEngineRuntime(trips, start, end);

  const inScope = (id) => assetIds.has(id);

  const assetRows = new Map();
  const ensureRow = (assetId) => {
    if (!assetRows.has(assetId)) {
      const info = vehicles.get(assetId) || {};
      assetRows.set(assetId, {
        assetId,
        regNo: info.regNo || assetId,
        assetName: info.assetName || '',
        transporter: info.transporter || '',
        zone: info.zone || '',
        assetClass: info.assetClass || 'other',
        engineHours: 0,
        tripCount: 0,
        distanceKm: 0,
        loadedHours: 0,
        loadCount: 0,
        utilizationPct: null,
        availabilityPct: null,
        harshBrakingCount: 0,
        harshBrakingScore: 0,
        harshBrakingSharePct: null,
        overspeedCount: 0,
        overspeedHours: 0,
        overspeedScore: 0,
        overspeedRatio: null,
        yawningCount: 0,
        eyeClosingCount: 0,
        distractionCount: 0,
        phoneDistractionCount: 0,
      });
    }
    return assetRows.get(assetId);
  };

  assetIds.forEach(id => {
    if (runtimeByAsset.has(id) || loadedByAsset.has(id)) ensureRow(id);
  });

  runtimeByAsset.forEach((r, id) => {
    if (!inScope(id)) return;
    const row = ensureRow(id);
    row.engineHours = r.engineSeconds / 3600;
    row.tripCount = r.tripCount;
    row.distanceKm = r.distanceKm;
  });

  loadedByAsset.forEach((l, id) => {
    if (!inScope(id)) return;
    const row = ensureRow(id);
    row.loadedHours = l.loadedSeconds / 3600;
    row.loadCount = l.loadCount;
  });

  behaviourEvents.forEach(e => {
    const id = e.assetId?.toString();
    if (!id || !inScope(id)) return;
    const row = ensureRow(id);
    if (e.category === KPI_CATEGORY.HARSH_BRAKING) {
      row.harshBrakingCount += 1;
    } else {
      row.overspeedCount += 1;
      row.overspeedHours += overspeedSeconds(e) / 3600;
    }
  });

  const fatigueByDriver = new Map();
  fatigueEvents.forEach(e => {
    const id = e.assetId?.toString();
    if (id && inScope(id)) {
      const row = ensureRow(id);
      if (e.category === KPI_CATEGORY.FATIGUE_YAWNING) row.yawningCount += 1;
      else if (e.category === KPI_CATEGORY.FATIGUE_EYE_CLOSING) row.eyeClosingCount += 1;
      else if (e.category === KPI_CATEGORY.DISTRACTION) row.distractionCount += 1;
      else if (e.category === KPI_CATEGORY.PHONE_DISTRACTION) row.phoneDistractionCount += 1;
    }
    const dKey = e.driverId || `asset:${id || 'unknown'}`;
    if (!fatigueByDriver.has(dKey)) {
      fatigueByDriver.set(dKey, {
        driverId: e.driverId || null,
        driverName: e.driverName || 'N/A',
        yawningCount: 0,
        eyeClosingCount: 0,
        distractionCount: 0,
        phoneDistractionCount: 0,
        lastEventTime: null,
        vehicles: new Set(),
      });
    }
    const d = fatigueByDriver.get(dKey);
    if (e.category === KPI_CATEGORY.FATIGUE_YAWNING) d.yawningCount += 1;
    else if (e.category === KPI_CATEGORY.FATIGUE_EYE_CLOSING) d.eyeClosingCount += 1;
    else if (e.category === KPI_CATEGORY.DISTRACTION) d.distractionCount += 1;
    else if (e.category === KPI_CATEGORY.PHONE_DISTRACTION) d.phoneDistractionCount += 1;
    const t = e.eventTime || e.timestamp;
    if (t && (!d.lastEventTime || t > d.lastEventTime)) d.lastEventTime = t;
    const reg = vehicles.get(id)?.regNo;
    if (reg) d.vehicles.add(reg);
  });

  const totalHarsh = [...assetRows.values()].reduce((s, r) => s + r.harshBrakingCount, 0);

  const assets = [...assetRows.values()].map(row => {
    const engineH = row.engineHours;
    const loadedH = row.loadedHours;
    // No load telemetry in period → unknown rather than 0%
    row.utilizationPct = engineH > 0 && row.loadCount > 0
      ? Math.min(100, (loadedH * 2 / engineH) * 100)
      : null;
    row.availabilityPct = windowHours > 0 ? Math.min(100, (engineH / windowHours) * 100) : null;
    row.harshBrakingScore = row.harshBrakingCount / 3;
    row.harshBrakingSharePct = totalHarsh > 0 ? (row.harshBrakingCount / totalHarsh) * 100 : null;
    row.overspeedScore = row.overspeedCount / 1;
    row.overspeedRatio = loadedH > 0 ? row.overspeedHours / (2 * loadedH) : null;
    return row;
  }).sort((a, b) => (a.regNo || '').localeCompare(b.regNo || ''));

  const fatigueDrivers = [...fatigueByDriver.values()]
    .map(d => ({
      ...d,
      totalEvents: d.yawningCount + d.eyeClosingCount + d.distractionCount + d.phoneDistractionCount,
      vehicles: [...d.vehicles],
    }))
    .sort((a, b) => b.totalEvents - a.totalEvents);

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
      totalEngineHours: sum(a => a.engineHours),
      totalLoadedHours: sum(a => a.loadedHours),
      totalDistanceKm: sum(a => a.distanceKm),
      avgUtilizationPct: withUtil.length ? withUtil.reduce((s, a) => s + a.utilizationPct, 0) / withUtil.length : null,
      avgAvailabilityPct: withAvail.length ? withAvail.reduce((s, a) => s + a.availabilityPct, 0) / withAvail.length : null,
      harshBrakingTotal: totalHarsh,
      overspeedTotal: sum(a => a.overspeedCount),
      overspeedHoursTotal: sum(a => a.overspeedHours),
      fatigueEventTotal: fatigueEvents.length,
      yawningTotal: fatigueEvents.filter(e => e.category === KPI_CATEGORY.FATIGUE_YAWNING).length,
    },
    assets,
    fatigue: {
      drivers: fatigueDrivers,
      events: fatigueEvents
        .map(e => ({
          eventId: e.eventId,
          category: e.category,
          label: e.label,
          assetId: e.assetId,
          regNo: vehicles.get(e.assetId?.toString())?.regNo || e.assetId,
          driverName: e.driverName || 'N/A',
          eventTime: e.eventTime || e.timestamp,
          speed: e.speed ?? null,
        }))
        .sort((a, b) => new Date(b.eventTime).getTime() - new Date(a.eventTime).getTime())
        .slice(0, 200),
    },
  };
}
