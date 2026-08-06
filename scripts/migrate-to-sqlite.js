/**
 * One-shot: stream JSONL logs into fleet.db (events / panic / ack / trips).
 *   node scripts/migrate-to-sqlite.js
 */
import fs from 'fs';
import path from 'path';
import {
  getDb,
  closeDb,
  insertEvent,
  insertPanic,
  addAcknowledged,
  upsertTrip,
  withTransaction,
  countTrips,
  insertFuelReading,
  insertKpiEvent,
} from './db.js';
import { iterateJsonLines } from './jsonl-stream.js';
import { FUEL_EVENT_TYPE } from './fuel-constants.js';

const ROOT = process.cwd();

function migrateEvents() {
  const p = path.join(ROOT, 'events.log');
  if (!fs.existsSync(p)) {
    console.log('events.log — skip (missing)');
    return { inserted: 0, failed: 0 };
  }
  let inserted = 0;
  let failed = 0;
  withTransaction(() => {
    for (const e of iterateJsonLines(p)) {
      try {
        const eventId = e.eventId?.toString();
        if (!eventId) { failed += 1; continue; }
        insertEvent({
          eventId,
          timestamp: e.timestamp || null,
          assetId: e.assetId,
          driverId: e.driverId,
          driverName: e.driverName,
          driverPhone: e.driverPhone,
          eventType: e.eventType,
          label: e.label,
          eventTime: e.eventTime,
          receivedAt: e.receivedAt,
          latitude: e.latitude,
          longitude: e.longitude,
          address: e.address,
        });
        inserted += 1;
      } catch {
        failed += 1;
      }
    }
  });
  console.log(`events.log — inserted/attempted: ${inserted}, failed: ${failed}`);
  return { inserted, failed };
}

function migratePanic() {
  const p = path.join(ROOT, 'panic.log');
  if (!fs.existsSync(p)) {
    console.log('panic.log — skip (missing)');
    return { inserted: 0, failed: 0 };
  }
  let inserted = 0;
  let failed = 0;
  withTransaction(() => {
    for (const e of iterateJsonLines(p)) {
      try {
        const eventId = e.eventId?.toString();
        if (!eventId) { failed += 1; continue; }
        insertPanic({
          eventId,
          timestamp: e.timestamp || null,
          assetId: e.assetId,
          driverId: e.driverId,
          driverName: e.driverName,
          driverPhone: e.driverPhone,
          eventTime: e.eventTime,
          receivedAt: e.receivedAt,
          latitude: e.latitude,
          longitude: e.longitude,
          address: e.address,
        });
        inserted += 1;
      } catch {
        failed += 1;
      }
    }
  });
  console.log(`panic.log — inserted/attempted: ${inserted}, failed: ${failed}`);
  return { inserted, failed };
}

function migrateAcknowledged() {
  const p = path.join(ROOT, 'public', 'acknowledged.json');
  if (!fs.existsSync(p)) {
    console.log('acknowledged.json — skip (missing)');
    return 0;
  }
  let ids = [];
  try {
    ids = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    console.log('acknowledged.json — parse failed');
    return 0;
  }
  if (!Array.isArray(ids)) return 0;
  withTransaction(() => {
    for (const id of ids) addAcknowledged(id);
  });
  console.log(`acknowledged.json — ${ids.length} id(s)`);
  return ids.length;
}

function migrateTrips() {
  const p = path.join(ROOT, 'public', 'trips.log');
  if (!fs.existsSync(p)) {
    console.log('trips.log — skip (missing)');
    return { inserted: 0, failed: 0 };
  }
  let inserted = 0;
  let failed = 0;
  const batch = [];
  const flush = () => {
    if (!batch.length) return;
    upsertTripsBatch(batch);
    inserted += batch.length;
    batch.length = 0;
  };

  for (const trip of iterateJsonLines(p)) {
    try {
      const tripId = (trip.TripId ?? trip.tripId ?? trip.Id)?.toString();
      if (!tripId) { failed += 1; continue; }
      batch.push(trip);
      if (batch.length >= 500) flush();
    } catch {
      failed += 1;
    }
  }
  flush();
  console.log(`trips.log — upserted: ${inserted}, failed: ${failed}, db count: ${countTrips()}`);
  return { inserted, failed };
}

function upsertTripsBatch(batch) {
  withTransaction(() => {
    for (const trip of batch) upsertTrip(trip, 'migrate');
  });
}

function migrateFuel() {
  const p = path.join(ROOT, 'fuel-history.log');
  if (!fs.existsSync(p)) {
    console.log('fuel-history.log — skip (missing)');
    return { inserted: 0, failed: 0 };
  }
  let inserted = 0;
  let failed = 0;
  withTransaction(() => {
    for (const row of iterateJsonLines(p)) {
      try {
        if (!row.assetId || row.timestamp == null || row.level == null) { failed += 1; continue; }
        insertFuelReading({
          assetId: row.assetId,
          timestamp: row.timestamp,
          level: row.level,
          eventType: row.eventType || FUEL_EVENT_TYPE.FIVE_MIN,
          eventId: row.eventId || null,
          driverId: row.driverId || null,
        });
        inserted += 1;
      } catch {
        failed += 1;
      }
    }
  });
  console.log(`fuel-history.log — attempted: ${inserted}, failed: ${failed}`);
  return { inserted, failed };
}

function migrateKpi() {
  const p = path.join(ROOT, 'kpi-events.log');
  if (!fs.existsSync(p)) {
    console.log('kpi-events.log — skip (missing)');
    return { inserted: 0, failed: 0 };
  }
  let inserted = 0;
  let failed = 0;
  withTransaction(() => {
    for (const e of iterateJsonLines(p)) {
      try {
        if (!e.eventId) { failed += 1; continue; }
        insertKpiEvent({
          eventId: e.eventId,
          timestamp: e.timestamp,
          assetId: e.assetId,
          driverId: e.driverId,
          driverName: e.driverName,
          eventTypeId: e.eventTypeId,
          category: e.category,
          label: e.label,
          eventTime: e.eventTime,
          endTime: e.endTime,
          value: e.value,
          speed: e.speed,
          latitude: e.latitude ?? e.lat ?? null,
          longitude: e.longitude ?? e.lon ?? null,
        });
        inserted += 1;
      } catch {
        failed += 1;
      }
    }
  });
  console.log(`kpi-events.log — attempted: ${inserted}, failed: ${failed}`);
  return { inserted, failed };
}

getDb();
console.log('Migrating into', path.join(ROOT, 'fleet.db'));
migrateEvents();
migratePanic();
migrateAcknowledged();
migrateTrips();
migrateFuel();
migrateKpi();
closeDb();
console.log('Done.');
