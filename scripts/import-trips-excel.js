/**
 * Import historical trips from an Excel (.xlsx) workbook into fleet.db.
 *
 * Usage:
 *   node scripts/import-trips-excel.js <path-to.xlsx> [--dry-run] [--sheet=Name]
 *
 * Sample headers (edit HEADER_MAP below to match your export):
 *   TripId | AssetId | DriverId | TripStart | TripEnd | DistanceKilometers
 *   DrivingTime | Duration | MaxSpeedKilometersPerHour
 *
 * Excel fills gaps with source='excel'. Live MiX writes use source='mix'.
 */

import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import XLSX from 'xlsx-js-style';

const require = createRequire(import.meta.url);

/**
 * Canonical DB field → accepted Excel header aliases (case-insensitive).
 * Edit this object when your workbook uses different column names.
 */
const HEADER_MAP = {
  trip_id: ['TripId', 'Trip ID', 'TripID', 'Id', 'tripId'],
  asset_id: ['AssetId', 'Asset ID', 'AssetID', 'VehicleId', 'assetId'],
  driver_id: ['DriverId', 'Driver ID', 'DriverID', 'driverId'],
  trip_start: ['TripStart', 'Trip Start', 'Start', 'StartDateTime', 'tripStart'],
  trip_end: ['TripEnd', 'Trip End', 'End', 'EndDateTime', 'tripEnd'],
  distance_km: [
    'DistanceKilometers',
    'DistanceKm',
    'Distance (km)',
    'Distance',
    'distanceKm',
  ],
  driving_time: ['DrivingTime', 'Driving Time', 'drivingTimeSeconds', 'driving_time'],
  duration: ['Duration', 'durationSeconds', 'duration'],
  max_speed_kph: [
    'MaxSpeedKilometersPerHour',
    'MaxSpeedKph',
    'Max Speed',
    'MaxSpeed',
    'maxSpeedKph',
  ],
};

const BATCH_SIZE = 500;
const SOURCE = 'excel';
const SCHEMA_HINT = 'Run SQLite migrate / start app once so schema exists';

function parseArgs(argv) {
  const args = { file: null, dryRun: false, sheet: null };
  for (const a of argv) {
    if (a === '--dry-run') args.dryRun = true;
    else if (a.startsWith('--sheet=')) args.sheet = a.slice('--sheet='.length) || null;
    else if (!a.startsWith('-') && !args.file) args.file = a;
  }
  return args;
}

function normalizeHeader(h) {
  return String(h ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

/** Build lookup: normalized header → column index / original name. */
function resolveHeaderBinding(headers) {
  const byNorm = new Map();
  headers.forEach((h, i) => {
    const n = normalizeHeader(h);
    if (n && !byNorm.has(n)) byNorm.set(n, { index: i, header: h });
  });

  const binding = {};
  const unresolved = [];
  for (const [field, aliases] of Object.entries(HEADER_MAP)) {
    let hit = null;
    for (const alias of aliases) {
      const found = byNorm.get(normalizeHeader(alias));
      if (found) {
        hit = found;
        break;
      }
    }
    if (hit) binding[field] = hit;
    else unresolved.push(field);
  }
  return { binding, unresolved };
}

/**
 * Excel serial date (days since 1899-12-30) → ISO-8601 UTC string.
 * Also accepts Date instances and parseable date strings.
 */
function toIsoDate(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Likely an Excel serial (typical trip range ~40000–60000+); also allow fractions.
    if (value > 20000 && value < 120000) {
      const ms = Math.round((value - 25569) * 86400 * 1000);
      const d = new Date(ms);
      return Number.isNaN(d.getTime()) ? null : d.toISOString();
    }
  }
  const s = String(value).trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function toText(value) {
  if (value == null || value === '') return null;
  const s = String(value).trim();
  return s || null;
}

function toNumber(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const n = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

function cellAt(row, binding, field) {
  const b = binding[field];
  if (!b) return undefined;
  return row[b.index];
}

function mapRow(row, binding, rowNum) {
  const trip_id = toText(cellAt(row, binding, 'trip_id'));
  if (!trip_id) return null;

  return {
    trip_id,
    asset_id: toText(cellAt(row, binding, 'asset_id')),
    driver_id: toText(cellAt(row, binding, 'driver_id')),
    trip_start: toIsoDate(cellAt(row, binding, 'trip_start')),
    trip_end: toIsoDate(cellAt(row, binding, 'trip_end')),
    distance_km: toNumber(cellAt(row, binding, 'distance_km')),
    driving_time: toNumber(cellAt(row, binding, 'driving_time')),
    duration: toNumber(cellAt(row, binding, 'duration')),
    max_speed_kph: toNumber(cellAt(row, binding, 'max_speed_kph')),
    source: SOURCE,
    _row: rowNum,
  };
}

function loadWorkbookRows(filePath, sheetName) {
  const wb = XLSX.readFile(filePath, { cellDates: true, cellNF: false, cellText: false });
  const name = sheetName || wb.SheetNames[0];
  if (!name || !wb.Sheets[name]) {
    const available = wb.SheetNames.join(', ') || '(none)';
    throw new Error(`Sheet not found: ${sheetName || '(first)'}. Available: ${available}`);
  }
  const sheet = wb.Sheets[name];
  // header:1 → array-of-arrays so we control header matching ourselves
  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
  if (!aoa.length) return { sheetName: name, headers: [], rows: [] };

  const headers = (aoa[0] || []).map((h) => (h == null ? '' : String(h)));
  const rows = aoa.slice(1).filter((r) => Array.isArray(r) && r.some((c) => c != null && c !== ''));
  return { sheetName: name, headers, rows };
}

async function tryLoadDbModule() {
  try {
    const mod = await import('./db.js');
    if (mod && typeof mod.upsertTrip === 'function') return mod;
  } catch {
    /* db.js not landed yet — open Database directly */
  }
  return null;
}

function openDatabaseDirect() {
  let Database;
  try {
    Database = require('better-sqlite3');
  } catch {
    console.error('Missing dependency: better-sqlite3. Install it (or wait for SQLite agent) then retry.');
    process.exit(1);
  }

  const dbPath = path.join(process.cwd(), 'fleet.db');
  if (!fs.existsSync(dbPath)) {
    console.error(`Missing fleet.db at ${dbPath}`);
    console.error(SCHEMA_HINT);
    process.exit(1);
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  const table = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='trips'`)
    .get();
  if (!table) {
    console.error('trips table not found in fleet.db');
    console.error(SCHEMA_HINT);
    process.exit(1);
  }

  return db;
}

function upsertBatchDirect(db, batch) {
  const stmt = db.prepare(`
    INSERT INTO trips (
      trip_id, asset_id, driver_id, trip_start, trip_end,
      distance_km, driving_time, duration, max_speed_kph, source
    ) VALUES (
      @trip_id, @asset_id, @driver_id, @trip_start, @trip_end,
      @distance_km, @driving_time, @duration, @max_speed_kph, @source
    )
    ON CONFLICT(trip_id) DO UPDATE SET
      asset_id = excluded.asset_id,
      driver_id = excluded.driver_id,
      trip_start = excluded.trip_start,
      trip_end = excluded.trip_end,
      distance_km = excluded.distance_km,
      driving_time = excluded.driving_time,
      duration = excluded.duration,
      max_speed_kph = excluded.max_speed_kph,
      source = excluded.source
  `);

  const run = db.transaction((rows) => {
    for (const row of rows) {
      stmt.run({
        trip_id: row.trip_id,
        asset_id: row.asset_id,
        driver_id: row.driver_id,
        trip_start: row.trip_start,
        trip_end: row.trip_end,
        distance_km: row.distance_km,
        driving_time: row.driving_time,
        duration: row.duration,
        max_speed_kph: row.max_speed_kph,
        source: row.source,
      });
    }
  });
  run(batch);
}

async function upsertBatchViaHelper(dbMod, batch) {
  if (typeof dbMod.upsertTrips === 'function') {
    dbMod.upsertTrips(batch);
    return;
  }
  if (typeof dbMod.withTransaction === 'function') {
    dbMod.withTransaction(() => {
      for (const row of batch) dbMod.upsertTrip(row);
    });
    return;
  }
  for (const row of batch) dbMod.upsertTrip(row);
}

async function main() {
  const { file, dryRun, sheet } = parseArgs(process.argv.slice(2));

  if (!file) {
    console.error('Usage: node scripts/import-trips-excel.js <path-to.xlsx> [--dry-run] [--sheet=Name]');
    process.exit(1);
  }

  const filePath = path.resolve(process.cwd(), file);
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  let sheetName, headers, rows;
  try {
    ({ sheetName, headers, rows } = loadWorkbookRows(filePath, sheet));
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  }

  console.log(`Sheet: ${sheetName}`);
  console.log(`Detected headers (${headers.length}):`);
  headers.forEach((h, i) => console.log(`  [${i}] ${h || '(empty)'}`));

  const { binding, unresolved } = resolveHeaderBinding(headers);
  console.log('\nHeader binding:');
  for (const [field, b] of Object.entries(binding)) {
    console.log(`  ${field} ← "${b.header}"`);
  }
  if (!binding.trip_id) {
    console.error('\nRequired column trip_id could not be resolved from HEADER_MAP. Edit HEADER_MAP and retry.');
    process.exit(1);
  }
  if (unresolved.length) {
    console.log(`Unbound fields (will be null): ${unresolved.join(', ')}`);
  }

  const mapped = [];
  let skipped = 0;
  for (let i = 0; i < rows.length; i++) {
    const trip = mapRow(rows[i], binding, i + 2); // Excel row# (1-based + header)
    if (!trip) {
      skipped++;
      continue;
    }
    mapped.push(trip);
  }

  console.log(`\nRows: ${rows.length} data, ${mapped.length} mapped, ${skipped} skipped (no trip_id)`);

  if (mapped.length === 0) {
    console.error('Zero mapped rows — nothing to import.');
    process.exit(1);
  }

  const preview = mapped.slice(0, 5).map(({ _row, ...rest }) => rest);
  console.log('\nFirst mapped rows:');
  console.log(JSON.stringify(preview, null, 2));

  if (dryRun) {
    console.log(`\nDry-run complete — would upsert ${mapped.length} trip(s) with source='${SOURCE}'.`);
    return;
  }

  const dbMod = await tryLoadDbModule();
  let db = null;

  if (dbMod) {
    console.log('\nUsing scripts/db.js upsertTrip helper');
  } else {
    db = openDatabaseDirect();
    console.log('\nOpened fleet.db directly (no upsertTrip in db.js)');
  }

  let written = 0;
  try {
    for (let i = 0; i < mapped.length; i += BATCH_SIZE) {
      const batch = mapped.slice(i, i + BATCH_SIZE).map(({ _row, ...rest }) => rest);
      if (dbMod) await upsertBatchViaHelper(dbMod, batch);
      else upsertBatchDirect(db, batch);
      written += batch.length;
      if (mapped.length > BATCH_SIZE) {
        console.log(`  … upserted ${written}/${mapped.length}`);
      }
    }
  } finally {
    if (db) db.close();
    if (dbMod && typeof dbMod.close === 'function') dbMod.close();
  }

  console.log(`Done — upserted ${written} trip(s) (source='${SOURCE}').`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
