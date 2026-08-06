/**
 * Import HBM Availability CSVs (Trip + Fuel Usage) into fleet.db.
 *
 * Usage:
 *   node scripts/import-hbm-availability-csv.js
 *   node scripts/import-hbm-availability-csv.js --dry-run
 *   node scripts/import-hbm-availability-csv.js --trips-only
 *   node scripts/import-hbm-availability-csv.js --fuel-only
 *
 * Maps Asset / AssetName → public/data.json id (MiX AssetId).
 * Trips get source='excel'. Fuel start/end volumes go into fuel_history.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createRequire } from 'module';
import { getDb, closeDb, upsertTrips, insertFuelReadings } from './db.js';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const TRIP_CSV = path.join(ROOT, 'docs', 'HBM Availability (TRIP).csv');
const FUEL_CSV = path.join(ROOT, 'docs', 'HBM Availability (FUEL USAGE).csv');
const SOURCE = 'excel';
const BATCH = 1000;

function parseArgs(argv) {
  return {
    dryRun: argv.includes('--dry-run'),
    tripsOnly: argv.includes('--trips-only'),
    fuelOnly: argv.includes('--fuel-only'),
  };
}

/** Minimal CSV parser (handles quotes). */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (inQ && text[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
      continue;
    }
    if ((c === ',' && !inQ)) {
      row.push(cur);
      cur = '';
      continue;
    }
    if ((c === '\n' || c === '\r') && !inQ) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur);
      cur = '';
      if (row.some(cell => String(cell).trim() !== '')) rows.push(row);
      row = [];
      continue;
    }
    cur += c;
  }
  if (cur.length || row.length) {
    row.push(cur);
    if (row.some(cell => String(cell).trim() !== '')) rows.push(row);
  }
  return rows;
}

function loadCsv(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const rows = parseCsv(text);
  if (!rows.length) return { headers: [], rows: [] };
  const headers = rows[0].map(h => String(h ?? '').trim());
  return { headers, rows: rows.slice(1) };
}

function colIndex(headers) {
  const map = new Map();
  headers.forEach((h, i) => map.set(h, i));
  return (name) => {
    if (map.has(name)) return map.get(name);
    const want = name.toLowerCase().replace(/[\s_-]+/g, '');
    for (const [h, i] of map) {
      if (h.toLowerCase().replace(/[\s_-]+/g, '') === want) return i;
    }
    return -1;
  };
}

function cell(row, idx) {
  if (idx < 0 || idx >= row.length) return '';
  return String(row[idx] ?? '').trim();
}

function toNumber(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

/** Parse mixed US/EU date strings; return Date or null. */
function parseLooseDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;

  // Excel-ish "Wednesday, April 8, 2026"
  const named = Date.parse(s);
  if (Number.isFinite(named) && !/^\d{1,2}\/\d{1,2}\/\d{4}/.test(s)) {
    const d = new Date(named);
    if (!Number.isNaN(d.getTime())) return d;
  }

  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?/i);
  if (!m) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  let a = Number(m[1]);
  let b = Number(m[2]);
  const year = Number(m[3]);
  let hour = m[4] != null ? Number(m[4]) : 0;
  const min = m[5] != null ? Number(m[5]) : 0;
  const sec = m[6] != null ? Number(m[6]) : 0;
  const ampm = (m[7] || '').toUpperCase();
  if (ampm === 'PM' && hour < 12) hour += 12;
  if (ampm === 'AM' && hour === 12) hour = 0;

  const candidates = [];
  // D/M/Y when first > 12
  if (a > 12 && b <= 12) candidates.push(new Date(year, b - 1, a, hour, min, sec));
  // M/D/Y when second > 12
  else if (b > 12 && a <= 12) candidates.push(new Date(year, a - 1, b, hour, min, sec));
  else {
    // ambiguous — prefer M/D/Y (MiX US export common for Trip Start)
    candidates.push(new Date(year, a - 1, b, hour, min, sec));
    candidates.push(new Date(year, b - 1, a, hour, min, sec));
  }
  for (const d of candidates) {
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

function pickStartEnd(startRaw, endRaw) {
  const startCandidates = [];
  const endCandidates = [];

  const pushParsed = (raw, into) => {
    const s = String(raw || '').trim();
    if (!s) return;
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?/i);
    if (!m) {
      const d = parseLooseDate(s);
      if (d) into.push(d);
      return;
    }
    const a = Number(m[1]);
    const b = Number(m[2]);
    const year = Number(m[3]);
    let hour = m[4] != null ? Number(m[4]) : 0;
    const min = m[5] != null ? Number(m[5]) : 0;
    const sec = m[6] != null ? Number(m[6]) : 0;
    const ampm = (m[7] || '').toUpperCase();
    if (ampm === 'PM' && hour < 12) hour += 12;
    if (ampm === 'AM' && hour === 12) hour = 0;

    const opts = [];
    if (a > 12 && b <= 12) opts.push(new Date(year, b - 1, a, hour, min, sec));
    else if (b > 12 && a <= 12) opts.push(new Date(year, a - 1, b, hour, min, sec));
    else {
      opts.push(new Date(year, a - 1, b, hour, min, sec)); // M/D
      opts.push(new Date(year, b - 1, a, hour, min, sec)); // D/M
    }
    for (const d of opts) if (!Number.isNaN(d.getTime())) into.push(d);
  };

  pushParsed(startRaw, startCandidates);
  pushParsed(endRaw, endCandidates);

  let best = null;
  for (const s of startCandidates) {
    for (const e of endCandidates.length ? endCandidates : [new Date(s.getTime() + 60_000)]) {
      const dt = e.getTime() - s.getTime();
      if (dt >= 0 && dt <= 7 * 24 * 3600 * 1000) {
        if (!best || Math.abs(dt - (best.end - best.start)) < 0) { /* keep */ }
        if (!best) best = { start: s, end: e };
        else {
          // prefer longer positive span that's still plausible
          const cur = best.end - best.start;
          if (dt > cur && dt < 48 * 3600 * 1000) best = { start: s, end: e };
        }
      }
    }
  }
  if (best) return best;
  const s = startCandidates[0] || parseLooseDate(startRaw);
  if (!s) return null;
  const e = endCandidates[0] || new Date(s.getTime() + 60_000);
  if (e < s) return { start: s, end: new Date(s.getTime() + 60_000) };
  return { start: s, end: e };
}

/** "12:01:21 AM" clock-on-zero → seconds (duration-of-day style). */
function clockToSeconds(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  // Excel serial day fraction already numeric elsewhere
  const n = Number(s);
  if (Number.isFinite(n) && n > 0 && n < 2) return Math.round(n * 86400);

  const m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const sec = m[3] != null ? Number(m[3]) : 0;
  const ampm = (m[4] || '').toUpperCase();
  if (ampm === 'PM' && h < 12) h += 12;
  if (ampm === 'AM' && h === 12) h = 0;
  // if no AM/PM and h can be duration hours > 12, treat as H:M:S duration
  if (!ampm) return h * 3600 + min * 60 + sec;
  // with AM/PM on midnight base → absolute clock → duration from midnight
  return h * 3600 + min * 60 + sec;
}

function hoursToSeconds(raw) {
  const n = toNumber(raw);
  if (n == null) return null;
  return Math.round(n * 3600);
}

function normalizeKey(s) {
  return String(s || '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .replace(/[–—]/g, '-')
    .trim();
}

function loadVehicleIndex() {
  const dataPath = path.join(ROOT, 'public', 'data.json');
  const byKey = new Map();
  if (!fs.existsSync(dataPath)) return byKey;
  const vehicles = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  for (const v of vehicles) {
    const id = v.id?.toString();
    if (!id) continue;
    const keys = [
      v.regNo,
      v.assetName,
      normalizeKey(v.regNo),
      normalizeKey(v.assetName),
      normalizeKey(v.assetName).replace(/\s*-\s*/g, '-'),
      normalizeKey(v.assetName).replace(/\s+/g, ''),
    ];
    for (const k of keys) {
      if (!k) continue;
      const nk = normalizeKey(k);
      if (!byKey.has(nk)) byKey.set(nk, id);
    }
  }
  return byKey;
}

function resolveAssetId(byKey, ...names) {
  for (const name of names) {
    if (!name) continue;
    const variants = [
      normalizeKey(name),
      normalizeKey(name).replace(/\s*-\s*/g, '-'),
      normalizeKey(name).replace(/\s+/g, ''),
      normalizeKey(name).replace(/QUARRY\s*/i, 'QUARRY '),
    ];
    // Extra: "Quarry - DT13 - MFA" ↔ "Quarry - DT13 - MFA"
    for (const v of variants) {
      if (byKey.has(v)) return byKey.get(v);
    }
    // Try extracting reg token DT13 / D101 / EXC3
    const m = String(name).toUpperCase().match(/\b((?:DT|RD|EXC?|D)\s?\d+)\b/);
    if (m) {
      const reg = m[1].replace(/\s+/g, '');
      if (byKey.has(reg)) return byKey.get(reg);
    }
  }
  return null;
}

function tripIdHash(parts) {
  return `excel:${crypto.createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 24)}`;
}

function importFuelCsv(byKey, dryRun) {
  if (!fs.existsSync(FUEL_CSV)) {
    console.log('Skip fuel CSV — missing');
    return { trips: 0, fuel: 0, unmatched: 0 };
  }
  const { headers, rows } = loadCsv(FUEL_CSV);
  const ix = colIndex(headers);
  const iAsset = ix('Asset');
  const iDriver = ix('Driver');
  const iStart = ix('Trip Start');
  const iEnd = ix('Trip End');
  const iDist = ix('Distance (km)');
  const iFuel = ix('Fuel Used (Litres)');
  const iStartVol = ix('Start Volume (Litres)');
  const iEndVol = ix('End Volume (Litres)');
  const iDrive = ix('Driving Time (hh:mm:ss)');
  const iDur = ix('Duration (hh:mm:ss)');
  const iDurHrs = ix('Duration (hrs)');
  const iMax = ix('Max Speed (km/h)');

  const trips = [];
  const fuelRows = [];
  let unmatched = 0;

  for (const row of rows) {
    const assetName = cell(row, iAsset);
    const assetId = resolveAssetId(byKey, assetName);
    if (!assetId) { unmatched++; continue; }

    const se = pickStartEnd(cell(row, iStart), cell(row, iEnd));
    if (!se) continue;

    const distance = toNumber(cell(row, iDist)) || 0;
    const driving = clockToSeconds(cell(row, iDrive));
    const duration = clockToSeconds(cell(row, iDur)) ?? hoursToSeconds(cell(row, iDurHrs));
    const maxSpeed = toNumber(cell(row, iMax));
    const startVol = toNumber(cell(row, iStartVol));
    const endVol = toNumber(cell(row, iEndVol));
    const fuelUsed = toNumber(cell(row, iFuel));

    // Keep short/zero-distance rows if they have fuel or meaningful duration (quarry idle/engine)
    const durSec = duration || driving || Math.max(60, Math.round((se.end - se.start) / 1000));
    if (distance < 0.01 && (!fuelUsed || fuelUsed <= 0) && durSec < 60) continue;

    const trip_id = tripIdHash([
      'fuel',
      assetId,
      se.start.toISOString(),
      se.end.toISOString(),
      String(distance),
    ]);

    trips.push({
      trip_id,
      asset_id: assetId,
      driver_id: null,
      trip_start: se.start.toISOString(),
      trip_end: se.end.toISOString(),
      distance_km: distance,
      driving_time: driving ?? durSec,
      duration: durSec,
      max_speed_kph: maxSpeed,
      source: SOURCE,
    });

    if (startVol != null && startVol > 0) {
      fuelRows.push({
        assetId,
        timestamp: se.start.toISOString(),
        level: startVol,
        eventType: 'trip_start',
        eventId: `${trip_id}:start`,
      });
    }
    if (endVol != null && endVol > 0) {
      fuelRows.push({
        assetId,
        timestamp: se.end.toISOString(),
        level: endVol,
        eventType: 'trip_end',
        eventId: `${trip_id}:end`,
      });
    }
    // If volumes missing but fuel used known, synthesize a drop on trip_end for consumption engines
    if ((startVol == null || startVol <= 0) && fuelUsed != null && fuelUsed > 0) {
      fuelRows.push({
        assetId,
        timestamp: se.start.toISOString(),
        level: fuelUsed + 50,
        eventType: 'trip_start',
        eventId: `${trip_id}:syn-start`,
      });
      fuelRows.push({
        assetId,
        timestamp: se.end.toISOString(),
        level: 50,
        eventType: 'trip_end',
        eventId: `${trip_id}:syn-end`,
      });
    }
  }

  console.log(`Fuel CSV: ${rows.length} rows → ${trips.length} trips, ${fuelRows.length} fuel readings (${unmatched} unmatched assets)`);
  if (dryRun) return { trips: trips.length, fuel: fuelRows.length, unmatched };

  for (let i = 0; i < trips.length; i += BATCH) {
    upsertTrips(trips.slice(i, i + BATCH), SOURCE);
    if (trips.length > BATCH) console.log(`  trips ${Math.min(i + BATCH, trips.length)}/${trips.length}`);
  }
  for (let i = 0; i < fuelRows.length; i += BATCH) {
    insertFuelReadings(fuelRows.slice(i, i + BATCH));
  }
  return { trips: trips.length, fuel: fuelRows.length, unmatched };
}

function importTripDailyCsv(byKey, dryRun) {
  if (!fs.existsSync(TRIP_CSV)) {
    console.log('Skip trip CSV — missing');
    return { trips: 0, unmatched: 0 };
  }
  const { headers, rows } = loadCsv(TRIP_CSV);
  const ix = colIndex(headers);
  const iDate = ix('Date');
  const iName = ix('AssetName');
  const iExtra = ix('AssetExtra');
  const iDist = ix('TotalDistanceTravelled');
  const iDriveHrs = ix('Driving time (hrs)');
  const iDurHrs = ix('Duration (hrs)');
  const iEngHrs = ix('Engine (hr)');
  const iEngSec = ix('TotalEngineSeconds');
  const iMax = ix('MaxSpeed');

  const trips = [];
  let unmatched = 0;

  for (const row of rows) {
    const name = cell(row, iName);
    const extra = cell(row, iExtra);
    const assetId = resolveAssetId(byKey, name, extra);
    if (!assetId) { unmatched++; continue; }

    const day = parseLooseDate(cell(row, iDate));
    if (!day) continue;
    day.setHours(0, 0, 0, 0);

    const distance = toNumber(cell(row, iDist)) || 0;
    const driveSec = hoursToSeconds(cell(row, iDriveHrs)) || 0;
    const durSec = hoursToSeconds(cell(row, iDurHrs)) || 0;
    let engSec = hoursToSeconds(cell(row, iEngHrs));
    const engClock = clockToSeconds(cell(row, iEngSec));
    if (engSec == null && engClock != null) engSec = engClock;
    engSec = engSec || 0;

    const workSec = Math.max(driveSec, durSec, engSec);
    if (distance < 0.5 && workSec < 60) continue;

    const start = new Date(day);
    const end = new Date(day.getTime() + Math.max(workSec, 60) * 1000);
    const trip_id = tripIdHash(['daily', assetId, start.toISOString().slice(0, 10)]);

    trips.push({
      trip_id,
      asset_id: assetId,
      driver_id: null,
      trip_start: start.toISOString(),
      trip_end: end.toISOString(),
      distance_km: distance,
      driving_time: driveSec || workSec,
      duration: workSec || driveSec,
      max_speed_kph: toNumber(cell(row, iMax)),
      source: SOURCE,
    });
  }

  console.log(`Trip daily CSV: ${rows.length} rows → ${trips.length} trips (${unmatched} unmatched)`);
  if (dryRun) return { trips: trips.length, unmatched };

  for (let i = 0; i < trips.length; i += BATCH) {
    upsertTrips(trips.slice(i, i + BATCH), SOURCE);
    if (trips.length > BATCH) console.log(`  daily ${Math.min(i + BATCH, trips.length)}/${trips.length}`);
  }
  return { trips: trips.length, unmatched };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  getDb(); // ensure schema
  const byKey = loadVehicleIndex();
  console.log(`Vehicle index keys: ${byKey.size}`);

  const summary = { fuel: null, daily: null };
  if (!args.tripsOnly) summary.fuel = importFuelCsv(byKey, args.dryRun);
  if (!args.fuelOnly) summary.daily = importTripDailyCsv(byKey, args.dryRun);

  if (!args.dryRun) {
    const Database = require('better-sqlite3');
    const db = new Database(path.join(ROOT, 'fleet.db'), { readonly: true });
    console.log('\ntrips by source:', db.prepare('SELECT source, COUNT(*) AS n FROM trips GROUP BY source').all());
    console.log('excel date span:', db.prepare(`
      SELECT MIN(trip_start) AS first, MAX(trip_end) AS last, COUNT(*) AS n
      FROM trips WHERE source = 'excel'
    `).get());
    db.close();
  } else {
    console.log('\nDry-run summary:', summary);
  }

  closeDb();
  console.log(args.dryRun ? 'Dry-run done.' : 'Import done.');
}

main();
