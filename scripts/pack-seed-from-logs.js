/**
 * Pack existing runtime logs into seed/week/ (last N days only).
 * Streams trips.log so multi‑hundred‑MB files don't OOM.
 *
 * Usage: node scripts/pack-seed-from-logs.js
 */
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import zlib from 'zlib';
import { pipeline } from 'stream/promises';
import { createReadStream, createWriteStream } from 'fs';

const ROOT = process.cwd();
const SEED_DIR = path.join(ROOT, 'seed', 'week');
const LOOKBACK_DAYS = 6;
const CUTOFF = Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000;

function ensureDir() {
  fs.mkdirSync(SEED_DIR, { recursive: true });
}

function lineTime(obj, keys) {
  for (const k of keys) {
    if (!obj[k]) continue;
    const t = Date.parse(obj[k]);
    if (Number.isFinite(t)) return t;
  }
  return null;
}

function packJsonl(src, dest, timeKeys) {
  if (!fs.existsSync(src)) {
    fs.writeFileSync(dest, '');
    return { kept: 0, skipped: 0, missing: true };
  }
  const out = fs.createWriteStream(dest, { flags: 'w' });
  let kept = 0;
  let skipped = 0;
  const lines = fs.readFileSync(src, 'utf8').split('\n');
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    try {
      const o = JSON.parse(line);
      const t = lineTime(o, timeKeys);
      if (t != null && t < CUTOFF) { skipped++; continue; }
      out.write(`${line}\n`);
      kept++;
    } catch {
      skipped++;
    }
  }
  out.end();
  return { kept, skipped, missing: false };
}

function slimTrip(t) {
  return {
    TripId: t.TripId ?? t.TripID ?? t.Id ?? t.tripId ?? null,
    AssetId: t.AssetId ?? t.AssetID ?? t.assetId ?? null,
    DriverId: t.DriverId ?? t.driverId ?? null,
    DriverName: t.DriverName ?? t.driverName ?? null,
    RegistrationNumber: t.RegistrationNumber ?? t.regNo ?? null,
    AssetDescription: t.AssetDescription ?? t.assetName ?? null,
    TripStart: t.TripStart ?? t.tripStart ?? t.StartDateTime ?? null,
    TripEnd: t.TripEnd ?? t.tripEnd ?? t.EndDateTime ?? null,
    Duration: t.Duration ?? t.durationSeconds ?? null,
    DrivingTime: t.DrivingTime ?? t.drivingTimeSeconds ?? null,
    DistanceKilometers: t.DistanceKilometers ?? t.distanceKm ?? null,
    MaxSpeedKilometersPerHour: t.MaxSpeedKilometersPerHour ?? t.maxSpeedKph ?? null,
  };
}

async function packTripsStream(src, dest) {
  if (!fs.existsSync(src)) {
    fs.writeFileSync(dest, '');
    return { kept: 0, skipped: 0, missing: true };
  }
  const out = fs.createWriteStream(dest, { flags: 'w' });
  const rl = readline.createInterface({
    input: fs.createReadStream(src, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  let kept = 0;
  let skipped = 0;
  for await (const raw of rl) {
    const line = raw.trim();
    if (!line) continue;
    try {
      const o = JSON.parse(line);
      const t = lineTime(o, ['TripEnd', 'tripEnd', 'EndDateTime', 'TripStart', 'tripStart', 'StartDateTime', 'CreatedDate']);
      if (t != null && t < CUTOFF) { skipped++; continue; }
      out.write(`${JSON.stringify(slimTrip(o))}\n`);
      kept++;
    } catch {
      skipped++;
    }
  }
  await new Promise(resolve => out.end(resolve));
  return { kept, skipped, missing: false };
}

async function main() {
  ensureDir();
  console.log(`📦 Packing seed/week from local logs (last ${LOOKBACK_DAYS} days, cutoff ${new Date(CUTOFF).toISOString()})`);

  const events = packJsonl(
    path.join(ROOT, 'events.log'),
    path.join(SEED_DIR, 'events.jsonl'),
    ['eventTime', 'timestamp'],
  );
  const kpi = packJsonl(
    path.join(ROOT, 'kpi-events.log'),
    path.join(SEED_DIR, 'kpi-events.jsonl'),
    ['eventTime', 'timestamp'],
  );
  const fuel = packJsonl(
    path.join(ROOT, 'fuel-history.log'),
    path.join(SEED_DIR, 'fuel-history.jsonl'),
    ['timestamp'],
  );
  const trips = await packTripsStream(
    path.join(ROOT, 'public', 'trips.log'),
    path.join(SEED_DIR, 'trips.jsonl'),
  );

  // Compress trips for GitHub (<100MB soft-warn / push friendliness)
  const tripsPlain = path.join(SEED_DIR, 'trips.jsonl');
  const tripsGz = path.join(SEED_DIR, 'trips.jsonl.gz');
  if (fs.existsSync(tripsPlain) && fs.statSync(tripsPlain).size > 0) {
    await pipeline(createReadStream(tripsPlain), zlib.createGzip({ level: 9 }), createWriteStream(tripsGz));
    fs.unlinkSync(tripsPlain);
  }

  const meta = {
    createdAt: new Date().toISOString(),
    lookbackDays: LOOKBACK_DAYS,
    cutoff: new Date(CUTOFF).toISOString(),
    source: 'pack-seed-from-logs',
    counts: {
      warnings: events.kept,
      kpi: kpi.kept,
      fuel: fuel.kept,
      trips: trips.kept,
    },
    skipped: {
      warnings: events.skipped,
      kpi: kpi.skipped,
      fuel: fuel.skipped,
      trips: trips.skipped,
    },
    tripsCompressed: fs.existsSync(tripsGz),
  };
  fs.writeFileSync(path.join(SEED_DIR, 'meta.json'), JSON.stringify(meta, null, 2));

  console.log('✅ Seed packed');
  console.log(`   events: ${events.kept} (skipped ${events.skipped})`);
  console.log(`   kpi:    ${kpi.kept} (skipped ${kpi.skipped})`);
  console.log(`   fuel:   ${fuel.kept} (skipped ${fuel.skipped})`);
  console.log(`   trips:  ${trips.kept} (skipped ${trips.skipped})`);
  if (fs.existsSync(tripsGz)) {
    console.log(`   trips.jsonl.gz: ${(fs.statSync(tripsGz).size / 1024 / 1024).toFixed(1)} MB`);
  }
}

main().catch(err => {
  console.error('❌ Pack failed:', err);
  process.exit(1);
});
