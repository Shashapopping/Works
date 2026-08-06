/**
 * Compute fuel consumption metrics from fleet.db (fuel_history + trips)
 */
import fs from 'fs';
import path from 'path';
import {
  FUEL_EVENT_TYPE,
  QUARRY_ZONES,
} from './fuel-constants.js';
import { getFuelHistory, getTripsInRange } from './db.js';

const REFUEL_LITERS = 50;
const REFUEL_WINDOW_MS = 30 * 60 * 1000;
const SUSPECT_DROP_LITERS = 30;
const SUSPECT_DROP_WINDOW_MS = 30 * 60 * 1000;
const FUEL_MATCH_MS = 15 * 60 * 1000;
const RESULT_CACHE_TTL_MS = 30_000;
const resultCache = new Map();

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
  const map = new Map();
  const dataPath = path.join(cwd, 'public', 'data.json');
  if (!fs.existsSync(dataPath)) return map;
  JSON.parse(fs.readFileSync(dataPath, 'utf8')).forEach(v => {
    map.set(v.id?.toString(), {
      regNo: v.regNo,
      assetName: v.assetName,
      zone: (v.zone || '').toUpperCase(),
    });
  });
  return map;
}

function loadDriverLookup(cwd) {
  const map = new Map();
  const p = path.join(cwd, 'public', 'drivers.json');
  if (!fs.existsSync(p)) return map;
  JSON.parse(fs.readFileSync(p, 'utf8')).forEach(d => {
    map.set(d.DriverId?.toString(), d.Name || 'N/A');
  });
  return map;
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

function detectRefuels(byAsset, start, end) {
  const refuels = [];

  byAsset.forEach((sorted, assetId) => {
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const cur = sorted[i];
      if (cur.ms < start || prev.ms > end) continue;
      const delta = cur.level - prev.level;
      const dt = cur.ms - prev.ms;
      if (delta >= REFUEL_LITERS && dt <= REFUEL_WINDOW_MS) {
        refuels.push({
          assetId,
          timestamp: cur.timestamp,
          startTime: prev.timestamp,
          endTime: cur.timestamp,
          durationMinutes: Math.round(dt / 60_000),
          beforeLevel: prev.level,
          afterLevel: cur.level,
          deltaLiters: delta,
        });
      }
    }
  });
  return refuels;
}

function detectSuspectDrops(byAsset, start, end) {
  const drops = [];

  byAsset.forEach((rows, assetId) => {
    const sorted = rows.filter(e => e.eventType === FUEL_EVENT_TYPE.FIVE_MIN);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const cur = sorted[i];
      if (cur.ms < start || prev.ms > end) continue;
      const delta = prev.level - cur.level;
      const dt = cur.ms - prev.ms;
      if (!(delta >= SUSPECT_DROP_LITERS && dt > 0 && dt <= SUSPECT_DROP_WINDOW_MS)) continue;

      // Probe noise / slosh heuristics (not a sustained siphon):
      // 1) next tick rebounds ≥35% of the drop
      // 2) prior tick was an upward spike, then level returns near the pre-spike baseline
      // 3) sub‑2‑minute cliff (single bad sample between ticks)
      const next = sorted[i + 1];
      const prev2 = sorted[i - 2];
      let likelyNoise = false;
      if (dt < 2 * 60 * 1000) {
        likelyNoise = true;
      }
      if (!likelyNoise && next) {
        const t2 = next.ms;
        const rebound = next.level - cur.level;
        if (t2 - cur.ms > 0 && t2 - cur.ms <= SUSPECT_DROP_WINDOW_MS && rebound >= delta * 0.35) {
          likelyNoise = true;
        }
      }
      if (!likelyNoise && prev2) {
        const spike = prev.level - prev2.level;
        const backToBaseline = Math.abs(prev2.level - cur.level);
        if (spike >= SUSPECT_DROP_LITERS * 0.5 && backToBaseline <= delta * 0.4) {
          likelyNoise = true;
        }
      }

      // Skip noise entirely — only confirmed suspects leave the engine
      if (likelyNoise) continue;

      drops.push({
        assetId,
        timestamp: cur.timestamp,
        startTime: prev.timestamp,
        endTime: cur.timestamp,
        durationMinutes: Math.max(1, Math.round(dt / 60_000)),
        beforeLevel: prev.level,
        afterLevel: cur.level,
        deltaLiters: delta,
      });
    }
  });
  return drops;
}

function periodFuelDrop(rows, start, end) {
  if (!rows?.length) return 0;
  const inWindow = rows.filter(e => e.ms >= start && e.ms <= end);
  if (inWindow.length < 2) return 0;

  let used = 0;
  for (let i = 1; i < inWindow.length; i++) {
    const prev = inWindow[i - 1];
    const cur = inWindow[i];
    const delta = prev.level - cur.level;
    const dt = cur.ms - prev.ms;
    if (cur.level - prev.level >= REFUEL_LITERS && dt <= REFUEL_WINDOW_MS) continue;
    if (delta > 0) used += delta;
  }
  return used;
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
}) {
  const cacheKey = `${period}|${from || ''}|${to || ''}|${siteFilter || ''}`;
  const cached = resultCache.get(cacheKey);
  if (cached && Date.now() - cached.at < RESULT_CACHE_TTL_MS) {
    return cached.data;
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

  const trips = getTripsInRange(
    new Date(start).toISOString(),
    new Date(end + 1).toISOString(),
    quarryAssetIds,
  );

  const refuels = detectRefuels(fuelByAsset, start, end);
  const suspectDrops = detectSuspectDrops(fuelByAsset, start, end);
  const refuelsByAsset = groupByAssetId(refuels);
  const dropsByAsset = groupByAssetId(suspectDrops);

  const startFuelTypes = new Set([FUEL_EVENT_TYPE.TRIP_START, FUEL_EVENT_TYPE.FIVE_MIN]);
  const endFuelTypes = new Set([FUEL_EVENT_TYPE.TRIP_END, FUEL_EVENT_TYPE.FIVE_MIN]);

  const tripRows = trips
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

  const assetMap = new Map();
  quarryAssetIds.forEach(assetId => {
    const info = vehicles.get(assetId) || {};
    const assetRefuels = refuelsByAsset.get(assetId) || [];
    const assetDrops = dropsByAsset.get(assetId) || [];
    assetMap.set(assetId, {
      assetId,
      regNo: info.regNo || assetId,
      assetName: info.assetName || '',
      zone: info.zone || '',
      tripCount: 0,
      totalFuelLiters: 0,
      totalDistanceKm: 0,
      totalDrivingHours: 0,
      periodFuelLiters: periodFuelDrop(fuelByAsset.get(assetId), start, end),
      refuelCount: assetRefuels.length,
      refuelLiters: assetRefuels.reduce((sum, r) => sum + r.deltaLiters, 0),
      suspectDropCount: assetDrops.length,
      suspectDropLiters: assetDrops.reduce((sum, r) => sum + r.deltaLiters, 0),
    });
  });

  tripRows.forEach(t => {
    const row = assetMap.get(t.assetId);
    if (!row) return;
    row.tripCount += 1;
    row.totalDistanceKm += t.distanceKm || 0;
    row.totalDrivingHours += t.drivingHours || 0;
    if (t.fuelUsedLiters != null) row.totalFuelLiters += t.fuelUsedLiters;
  });

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
  const dailySeries = buildDailySeries(tripRows, start, end, period);

  const data = {
    period: { start: new Date(start).toISOString(), end: new Date(end).toISOString() },
    summary: {
      totalFuelLiters,
      totalDistanceKm,
      totalDrivingHours,
      tripCount: tripRows.length,
      refuelCount: refuels.length,
      suspectDropCount: suspectDrops.length,
    },
    dailySeries,
    assets,
    trips: tripRows.sort((a, b) => new Date(b.tripEnd).getTime() - new Date(a.tripEnd).getTime()),
    refuels: refuels.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
    suspectDrops: suspectDrops.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
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
