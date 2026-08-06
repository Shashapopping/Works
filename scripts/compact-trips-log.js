/**
 * One-shot: compact public/trips.log to slim fields + retention window.
 * Safe to run on the droplet while PM2 is stopped (or it rewrites on next boot anyway).
 *
 *   node scripts/compact-trips-log.js
 */
import fs from 'fs';
import path from 'path';
import { iterateJsonLines } from './jsonl-stream.js';

const ROOT = process.cwd();
const TRIPS_LOG = path.join(ROOT, 'public', 'trips.log');
const RETENTION_DAYS = Number(process.env.TRIPS_RETENTION_DAYS || 8);

function getTripTime(trip) {
  const raw = trip.TripEnd || trip.tripEnd || trip.TripStart || trip.tripStart;
  const t = raw ? new Date(raw).getTime() : NaN;
  return Number.isFinite(t) ? t : 0;
}

function slimTrip(trip) {
  return {
    TripId: trip.TripId ?? trip.TripID ?? trip.Id ?? trip.tripId ?? null,
    AssetId: (trip.AssetId ?? trip.AssetID ?? trip.assetId)?.toString?.() ?? trip.AssetId ?? null,
    DriverId: (trip.DriverId ?? trip.driverId)?.toString?.() ?? trip.DriverId ?? null,
    TripStart: trip.TripStart || trip.tripStart || trip.StartDateTime || null,
    TripEnd: trip.TripEnd || trip.tripEnd || trip.EndDateTime || null,
    DistanceKilometers: Number(trip.DistanceKilometers ?? trip.distanceKm ?? 0),
    DrivingTime: trip.DrivingTime ?? trip.drivingTimeSeconds ?? null,
    Duration: trip.Duration ?? trip.durationSeconds ?? null,
    MaxSpeedKilometersPerHour: trip.MaxSpeedKilometersPerHour ?? trip.maxSpeedKph ?? null,
  };
}

function getKey(trip) {
  const id = trip.TripId ?? trip.tripId;
  if (id != null) return String(id);
  return `${trip.AssetId}-${trip.TripStart || trip.TripEnd}`;
}

if (!fs.existsSync(TRIPS_LOG)) {
  console.error('Missing', TRIPS_LOG);
  process.exit(1);
}

const before = fs.statSync(TRIPS_LOG).size;
const cutoff = Date.now() - RETENTION_DAYS * 86400000;
const map = new Map();
let scanned = 0;
for (const row of iterateJsonLines(TRIPS_LOG)) {
  scanned += 1;
  if (getTripTime(row) < cutoff) continue;
  const slim = slimTrip(row);
  map.set(getKey(slim), slim);
}

const bak = `${TRIPS_LOG}.bak-${new Date().toISOString().slice(0, 10)}`;
fs.copyFileSync(TRIPS_LOG, bak);
const lines = [...map.values()].map(t => JSON.stringify(t));
fs.writeFileSync(TRIPS_LOG, lines.length ? `${lines.join('\n')}\n` : '');
const after = fs.statSync(TRIPS_LOG).size;

console.log(JSON.stringify({
  scanned,
  kept: map.size,
  retentionDays: RETENTION_DAYS,
  beforeMB: +(before / 1024 / 1024).toFixed(1),
  afterMB: +(after / 1024 / 1024).toFixed(1),
  backup: bak,
}, null, 2));
