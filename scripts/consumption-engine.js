/**
 * Compute fuel consumption metrics from fleet.db (fuel_history + trips)
 */
import fs from 'fs';
import path from 'path';
import {
  FUEL_EVENT_TYPE,
  QUARRY_ZONES,
} from './fuel-constants.js';
import { getFuelHistory, getTripsInRange, loadTripRollupsByAsset } from './db.js';
import {
  detectRefuelsFromAssets,
  periodBucketMinutes,
  periodFuelDropFromStable,
} from './fuel-signal.js';

const FUEL_MATCH_MS = 15 * 60 * 1000;
// Stale-while-revalidate: serve instantly, refresh in background.
const RESULT_CACHE_FRESH_TTL_MS = 90_000;   // instant "fresh" window
const RESULT_CACHE_STALE_TTL_MS = 300_000;   // serve stale instantly + refresh
const resultCache = new Map();
const inflightRefresh = new Set();

// mtime-guarded cache for rarely-changing lookups.
let vehicleLookupCache = null;
let vehicleLookupMtimeMs = 0;
let driverLookupCache = null;
let driverLookupMtimeMs = 0;

function parsePeriodBounds(period, fromQ, toQ) {
  const now = Date.now();
  if (fromQ && toQ) {
    const start = new Date(fromQ).getTime();
    const endDate = new Date(toQ);
    endDate.setHours(23, 59, 59, 999);
    return { start, end: endDate.getTime() };
  }
  const cutoffs = { day: 86400000, week: 604800000, month: 2592000000 };
  const ms = cutoffs[period] || cutoffs.week;
  return { start: now - ms, end: now };
}

function loadFuelEntries(start, end) {
  return getFuelHistory({
    fromIso: new Date(start).toISOString(),
    toIso: new Date(end).toISOString(),
  }).filter(e => e.assetId);
}

function loadVehicleLookup(cwd) {
  const dataPath = path.join(cwd, 'public', 'data.json');
  if (!fs.existsSync(dataPath)) return new Map();
  try {
    const mtimeMs = fs.statSync(dataPath).mtimeMs;
    if (vehicleLookupCache && mtimeMs === vehicleLookupMtimeMs) return vehicleLookupCache;

    const map = new Map();
    JSON.parse(fs.readFileSync(dataPath, 'utf8')).forEach(v => {
      map.set(v.id?.toString(), {
        regNo: v.regNo,
        assetName: v.assetName,
        zone: (v.zone || '').toUpperCase(),
      });
    });

    vehicleLookupCache = map;
    vehicleLookupMtimeMs = mtimeMs;
    return map;
  } catch {
    return vehicleLookupCache ?? new Map();
  }
}

function loadDriverLookup(cwd) {
  const p = path.join(cwd, 'public', 'drivers.json');
  if (!fs.existsSync(p)) return new Map();
  try {
    const mtimeMs = fs.statSync(p).mtimeMs;
    if (driverLookupCache && mtimeMs === driverLookupMtimeMs) return driverLookupCache;

    const map = new Map();
    JSON.parse(fs.readFileSync(p, 'utf8')).forEach(d => {
      map.set(d.DriverId?.toString(), d.Name || 'N/A');
    });

    driverLookupCache = map;
    driverLookupMtimeMs = mtimeMs;
    return map;
  } catch {
    return driverLookupCache ?? new Map();
  }
}

function nearestFuelReading(indexedRows, targetMs, preferTypes, direction) {
  if (!indexedRows?.length) return null;
  const typeSet = preferTypes instanceof Set ? preferTypes : new Set(preferTypes);

  // Binary search: first index with ms >= targetMs
  let lo = 0;
  let hi = indexedRows.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (indexedRows[mid].ms < targetMs) lo = mid + 1;
    else hi = mid;
  }

  let best = null;
  let bestDist = Infinity;

  const consider = (row) => {
    if (!row || !typeSet.has(row.eventType)) return;
    if (direction === 'before' && row.ms > targetMs) return;
    if (direction === 'after' && row.ms < targetMs) return;
    const dist = Math.abs(row.ms - targetMs);
    if (dist > FUEL_MATCH_MS || dist >= bestDist) return;
    best = row;
    bestDist = dist;
  };

  if (direction === 'before') {
    for (let i = lo - 1; i >= 0; i--) {
      const row = indexedRows[i];
      if (targetMs - row.ms > FUEL_MATCH_MS) break;
      consider(row);
    }
  } else {
    for (let i = lo; i < indexedRows.length; i++) {
      const row = indexedRows[i];
      if (row.ms - targetMs > FUEL_MATCH_MS) break;
      consider(row);
    }
  }

  return best;
}

function indexFuelByAsset(entries) {
  const byAsset = new Map();
  for (const e of entries) {
    if (!e.assetId) continue;
    const ms = new Date(e.timestamp).getTime();
    if (Number.isNaN(ms)) continue;
    let rows = byAsset.get(e.assetId);
    if (!rows) {
      rows = [];
      byAsset.set(e.assetId, rows);
    }
    rows.push({ ...e, ms });
  }
  for (const rows of byAsset.values()) {
    rows.sort((a, b) => a.ms - b.ms);
  }
  return byAsset;
}

function groupByAssetId(rows) {
  const map = new Map();
  for (const row of rows) {
    let list = map.get(row.assetId);
    if (!list) {
      list = [];
      map.set(row.assetId, list);
    }
    list.push(row);
  }
  return map;
}

export function computeConsumption({
  cwd = process.cwd(),
  period = 'week',
  from,
  to,
  siteFilter = null,
  includeTrips = true,
  _bypassCache = false,
}) {
  const cacheKey = `${period}|${from || ''}|${to || ''}|${siteFilter || ''}|trips=${includeTrips ? 1 : 0}`;

  if (!_bypassCache) {
    const cached = resultCache.get(cacheKey);
    if (cached) {
      const ageMs = Date.now() - cached.at;
      if (ageMs < RESULT_CACHE_FRESH_TTL_MS) return cached.data;

      if (ageMs < RESULT_CACHE_STALE_TTL_MS) {
        if (!inflightRefresh.has(cacheKey)) {
          inflightRefresh.add(cacheKey);
          setImmediate(() => {
            try {
              computeConsumption({
                cwd,
                period,
                from,
                to,
                siteFilter,
                includeTrips,
                _bypassCache: true,
              });
            } catch {
              // Keep stale value if refresh fails.
            } finally {
              inflightRefresh.delete(cacheKey);
            }
          });
        }
        return cached.data;
      }
      // else: expired beyond stale window → fall through to recompute synchronously
    }
  }

  const { start, end } = parsePeriodBounds(period, from, to);
  const vehicles = loadVehicleLookup(cwd);
  const drivers = loadDriverLookup(cwd);

  const quarryAssetIds = [...vehicles.entries()]
    .filter(([, v]) => QUARRY_ZONES.has(v.zone))
    .filter(([, v]) => !siteFilter || v.zone === siteFilter.toUpperCase())
    .map(([id]) => id);

  const quarryAssetIdSet = new Set(quarryAssetIds);

  // Slight lookback so trip-edge fuel matching still works near window start
  const fuelEntries = loadFuelEntries(start - FUEL_MATCH_MS, end);
  const fuelByAsset = indexFuelByAsset(fuelEntries);

  const bucketMinutes = periodBucketMinutes(period);
  const refuels = detectRefuelsFromAssets(fuelByAsset, start, end, bucketMinutes);
  const refuelsByAsset = groupByAssetId(refuels);

  const fromIso = new Date(start).toISOString();
  const toIso = new Date(end + 1).toISOString();

  let tripRows = [];

  if (includeTrips) {
    const trips = getTripsInRange(fromIso, toIso, quarryAssetIds);
    const startFuelTypes = new Set([FUEL_EVENT_TYPE.TRIP_START, FUEL_EVENT_TYPE.FIVE_MIN]);
    const endFuelTypes = new Set([FUEL_EVENT_TYPE.TRIP_END, FUEL_EVENT_TYPE.FIVE_MIN]);

    tripRows = trips
      .filter(t => quarryAssetIdSet.has(t.AssetId?.toString()))
      .filter(t => {
        const ts = new Date(t.TripEnd || t.TripStart).getTime();
        return ts >= start && ts <= end;
      })
      .map(t => {
        const assetId = t.AssetId?.toString();
        const tripStartMs = new Date(t.TripStart).getTime();
        const tripEndMs = new Date(t.TripEnd).getTime();
        const assetFuel = fuelByAsset.get(assetId);
        const startFuel = nearestFuelReading(assetFuel, tripStartMs, startFuelTypes, 'before');
        const endFuel = nearestFuelReading(assetFuel, tripEndMs, endFuelTypes, 'after');
        const fuelUsed = (startFuel && endFuel && startFuel.level > endFuel.level)
          ? startFuel.level - endFuel.level
          : null;
        const distanceKm = t.DistanceKilometers ?? 0;
        const drivingHours = (t.DrivingTime ?? t.Duration ?? 0) / 3600;
        const info = vehicles.get(assetId) || {};
        const driverId = t.DriverId?.toString() || null;
        return {
          tripId: t.TripId?.toString(),
          assetId,
          regNo: info.regNo || assetId,
          assetName: info.assetName || '',
          zone: info.zone || '',
          driverId,
          driverName: driverId ? (drivers.get(driverId) || 'N/A') : 'N/A',
          tripStart: t.TripStart,
          tripEnd: t.TripEnd,
          distanceKm,
          drivingHours,
          durationHours: (t.Duration ?? 0) / 3600,
          fuelUsedLiters: fuelUsed,
          litersPerKm: fuelUsed != null && distanceKm > 0 ? fuelUsed / distanceKm : null,
          litersPerHour: fuelUsed != null && drivingHours > 0 ? fuelUsed / drivingHours : null,
          startAddress: t.StartPosition?.FormattedAddress || null,
          endAddress: t.EndPosition?.FormattedAddress || null,
          maxSpeedKmh: t.MaxSpeedKilometersPerHour ?? null,
        };
      });
  }

  const rollupByAsset = new Map();
  if (!includeTrips) {
    loadTripRollupsByAsset(fromIso, toIso).forEach(row => {
      if (row.assetId != null) rollupByAsset.set(String(row.assetId), row);
    });
  }

  const assetMap = new Map();
  quarryAssetIds.forEach(assetId => {
    const info = vehicles.get(assetId) || {};
    const assetRefuels = refuelsByAsset.get(assetId) || [];
    const periodFuelLiters = periodFuelDropFromStable(fuelByAsset.get(assetId), start, end, bucketMinutes);
    const rollup = rollupByAsset.get(assetId);
    assetMap.set(assetId, {
      assetId,
      regNo: info.regNo || assetId,
      assetName: info.assetName || '',
      zone: info.zone || '',
      tripCount: rollup ? Number(rollup.tripCount) || 0 : 0,
      totalFuelLiters: includeTrips ? 0 : periodFuelLiters,
      totalDistanceKm: rollup ? Number(rollup.totalDistanceKm) || 0 : 0,
      totalDrivingHours: rollup ? Number(rollup.totalDrivingHours) || 0 : 0,
      periodFuelLiters,
      refuelCount: assetRefuels.length,
      refuelLiters: assetRefuels.reduce((sum, r) => sum + r.deltaLiters, 0),
    });
  });

  if (includeTrips) {
    tripRows.forEach(t => {
      const row = assetMap.get(t.assetId);
      if (!row) return;
      row.tripCount += 1;
      row.totalDistanceKm += t.distanceKm || 0;
      row.totalDrivingHours += t.drivingHours || 0;
      if (t.fuelUsedLiters != null) row.totalFuelLiters += t.fuelUsedLiters;
    });
  }

  const assets = [...assetMap.values()].map(a => ({
    ...a,
    litersPerKm: a.totalFuelLiters > 0 && a.totalDistanceKm > 0 ? a.totalFuelLiters / a.totalDistanceKm : null,
    litersPerHour: a.totalFuelLiters > 0 && a.totalDrivingHours > 0 ? a.totalFuelLiters / a.totalDrivingHours : null,
    periodLitersPerHour: a.periodFuelLiters > 0 && a.totalDrivingHours > 0
      ? a.periodFuelLiters / a.totalDrivingHours
      : null,
  })).sort((a, b) => a.regNo.localeCompare(b.regNo));

  const siteTotals = {};
  assets.forEach(a => {
    const z = a.zone || 'Unknown';
    if (!siteTotals[z]) {
      siteTotals[z] = { zone: z, assets: 0, tripCount: 0, fuelLiters: 0, distanceKm: 0, drivingHours: 0, refuels: 0 };
    }
    siteTotals[z].assets += 1;
    siteTotals[z].tripCount += a.tripCount;
    siteTotals[z].fuelLiters += a.totalFuelLiters;
    siteTotals[z].distanceKm += a.totalDistanceKm;
    siteTotals[z].drivingHours += a.totalDrivingHours;
    siteTotals[z].refuels += a.refuelCount;
  });

  Object.values(siteTotals).forEach(s => {
    s.litersPerKm = s.fuelLiters > 0 && s.distanceKm > 0 ? s.fuelLiters / s.distanceKm : null;
    s.litersPerHour = s.fuelLiters > 0 && s.drivingHours > 0 ? s.fuelLiters / s.drivingHours : null;
  });

  const totalFuelLiters = assets.reduce((s, a) => s + a.totalFuelLiters, 0);
  const totalDistanceKm = assets.reduce((s, a) => s + a.totalDistanceKm, 0);
  const totalDrivingHours = assets.reduce((s, a) => s + a.totalDrivingHours, 0);
  const tripCount = includeTrips
    ? tripRows.length
    : assets.reduce((s, a) => s + a.tripCount, 0);
  const dailySeries = includeTrips
    ? buildDailySeries(tripRows, start, end, period)
    : buildDailySeriesFromFuel(fuelByAsset, quarryAssetIds, start, end, period);

  const data = {
    period: { start: new Date(start).toISOString(), end: new Date(end).toISOString() },
    summary: {
      totalFuelLiters,
      totalDistanceKm,
      totalDrivingHours,
      tripCount,
      refuelCount: refuels.length,
    },
    dailySeries,
    assets,
    trips: includeTrips
      ? tripRows.sort((a, b) => new Date(b.tripEnd).getTime() - new Date(a.tripEnd).getTime())
      : [],
    refuels: refuels.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
    siteTotals: Object.values(siteTotals).sort((a, b) => a.zone.localeCompare(b.zone)),
  };

  resultCache.set(cacheKey, { at: Date.now(), data });
  if (resultCache.size > 40) {
    const oldest = [...resultCache.entries()].sort((a, b) => a[1].at - b[1].at)[0]?.[0];
    if (oldest) resultCache.delete(oldest);
  }

  return data;
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEK_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function buildDailySeries(tripRows, start, end, period) {
  const buckets = new Map();
  tripRows.forEach(t => {
    if (t.fuelUsedLiters == null || t.fuelUsedLiters <= 0) return;
    const d = new Date(t.tripEnd || t.tripStart);
    const key = d.toISOString().slice(0, 10);
    buckets.set(key, (buckets.get(key) || 0) + t.fuelUsedLiters);
  });

  const series = [];
  const cur = new Date(start);
  cur.setHours(0, 0, 0, 0);
  const endD = new Date(end);
  endD.setHours(0, 0, 0, 0);

  while (cur <= endD) {
    const key = cur.toISOString().slice(0, 10);
    const liters = Math.round((buckets.get(key) || 0) * 10) / 10;
    const day = WEEKDAY_LABELS[cur.getDay()];
    const label = period === 'month'
      ? cur.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
      : day;
    series.push({ date: key, day, label, liters });
    cur.setDate(cur.getDate() + 1);
  }

  if (period === 'week' && series.length <= 7) {
    const byDay = new Map(series.map(row => [row.day, row]));
    return WEEK_ORDER.map(day => byDay.get(day) || { date: '', day, label: day, liters: 0 });
  }

  return series;
}

/** Probe-based daily fuel drops when trip detail is omitted (trips=0). */
function buildDailySeriesFromFuel(fuelByAsset, assetIds, start, end, period) {
  const buckets = new Map();
  for (const assetId of assetIds) {
    const rows = fuelByAsset.get(assetId);
    if (!rows?.length) continue;
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1];
      const cur = rows[i];
      if (cur.ms < start || cur.ms > end) continue;
      if (prev.level > cur.level) {
        const key = new Date(cur.ms).toISOString().slice(0, 10);
        buckets.set(key, (buckets.get(key) || 0) + (prev.level - cur.level));
      }
    }
  }

  const series = [];
  const cur = new Date(start);
  cur.setHours(0, 0, 0, 0);
  const endD = new Date(end);
  endD.setHours(0, 0, 0, 0);

  while (cur <= endD) {
    const key = cur.toISOString().slice(0, 10);
    const liters = Math.round((buckets.get(key) || 0) * 10) / 10;
    const day = WEEKDAY_LABELS[cur.getDay()];
    const label = period === 'month'
      ? cur.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
      : day;
    series.push({ date: key, day, label, liters });
    cur.setDate(cur.getDate() + 1);
  }

  if (period === 'week' && series.length <= 7) {
    const byDay = new Map(series.map(row => [row.day, row]));
    return WEEK_ORDER.map(day => byDay.get(day) || { date: '', day, label: day, liters: 0 });
  }

  return series;
}
