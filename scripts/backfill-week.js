/**
 * Backfill ~6 days of MiX history (API max lookback is <7 days) into:
 *   events.log, kpi-events.log, fuel-history.log, public/trips.log
 * Also writes a git-friendly copy under seed/week/ for DigitalOcean deploy.
 *
 * Usage: node scripts/backfill-week.js
 */
import * as dotenv from 'dotenv';
dotenv.config();

import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { KPI_EVENT_IDS, serializeKpiLogEntry } from './kpi-constants.js';
import {
  FUEL_PROBE_KNOWN_IDS,
  FUEL_PROBE_LOG_IDS,
  extractFuelLevel,
  extractEventTimestamp,
  serializeFuelLogEntry,
  fuelEventTypeFromId,
  safeParseJsonBigInt,
  getSinceTokenDaysAgo,
} from './fuel-constants.js';
import {
  extractMixEventSpeedKph,
  isOverspeedLabel,
  qualifiesAsOverspeed,
} from './overspeed-filter.js';

const IDENTITY_URL = 'https://identity.za.mixtelematics.com/core/connect/token';
const API_BASE = 'https://integrate.za.mixtelematics.com/api';
const ORG_ID = process.env.LAFARGE_ORG_ID;
const LOOKBACK_DAYS = 6; // MiX rejects older than 7 days
const MAX_PAGES = 400;

const WARNING_EVENT_TYPES = {
  '4750800303282680186': 'Harsh Braking',
  '6454149451280645233': 'Harsh Acceleration',
  '-3890646499157906515': 'Overspeeding',
  '-4596269900191457380': 'Overspeed Tiered',
  '4291175374538259638': 'Harsh Cornering',
};

const ROOT = process.cwd();
const SEED_DIR = path.join(ROOT, 'seed', 'week');
const PATHS = {
  events: path.join(ROOT, 'events.log'),
  kpi: path.join(ROOT, 'kpi-events.log'),
  fuel: path.join(ROOT, 'fuel-history.log'),
  trips: path.join(ROOT, 'public', 'trips.log'),
  tripsSession: path.join(ROOT, 'public', 'trips-session.json'),
  seedEvents: path.join(SEED_DIR, 'events.jsonl'),
  seedKpi: path.join(SEED_DIR, 'kpi-events.jsonl'),
  seedFuel: path.join(SEED_DIR, 'fuel-history.jsonl'),
  seedTrips: path.join(SEED_DIR, 'trips.jsonl'),
  seedMeta: path.join(SEED_DIR, 'meta.json'),
};

function sinceTokenFromDate(date) {
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}000`;
}

async function authenticate() {
  const params = new URLSearchParams({
    grant_type: 'password',
    username: process.env.MIX_USERNAME,
    password: process.env.MIX_PASSWORD,
    client_id: process.env.MIX_CLIENT_ID,
    client_secret: process.env.MIX_CLIENT_SECRET,
    scope: 'offline_access MiX.Integrate',
  });
  const response = await fetch(IDENTITY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });
  const contentType = response.headers.get('content-type') || '';
  const text = await response.text();
  if (!contentType.includes('application/json')) {
    throw new Error(`Authentication returned non-JSON (${response.status}): ${text.slice(0, 120)}`);
  }
  const data = JSON.parse(text);
  if (!data.access_token) {
    console.error('Auth failed:', JSON.stringify(data));
    process.exit(1);
  }
  return data.access_token;
}

async function fetchDrivers(token) {
  const map = new Map();
  try {
    const url = `${API_BASE}/drivers/organisation/${ORG_ID}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    if (!res.ok) return map;
    const drivers = safeParseJsonBigInt(await res.text());
    (Array.isArray(drivers) ? drivers : []).forEach(d => {
      map.set(d.DriverId?.toString(), { name: d.Name || 'N/A', phone: d.MobileNumber || 'N/A' });
    });
  } catch { /* ignore */ }
  return map;
}

function driverInfo(drivers, driverId) {
  return drivers.get(driverId?.toString()) || { name: 'N/A', phone: 'N/A' };
}

async function fetchEventsPage(token, sinceToken) {
  const url = `${API_BASE}/activeevents/groups/createdsince/entitytype/Asset/sincetoken/${sinceToken}/quantity/1000`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: `[${ORG_ID}]`,
  });
  const next = res.headers.get('GetSinceToken');
  if (res.status === 204) return { events: [], nextToken: next, status: 204 };
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`events ${res.status}: ${err.slice(0, 300)}`);
  }
  const events = safeParseJsonBigInt(await res.text());
  return { events: Array.isArray(events) ? events : [], nextToken: next, status: res.status };
}

async function fetchTripsPage(token, sinceToken) {
  const url = `${API_BASE}/trips/groups/createdsince/organisation/${ORG_ID}/sincetoken/${sinceToken}/quantity/1000`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  const next = res.headers.get('GetSinceToken');
  if (res.status === 204) return { trips: [], nextToken: next, status: 204 };
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`trips ${res.status}: ${err.slice(0, 300)}`);
  }
  const trips = safeParseJsonBigInt(await res.text());
  return { trips: Array.isArray(trips) ? trips : [], nextToken: next, status: res.status };
}

function ensureDirs() {
  fs.mkdirSync(path.join(ROOT, 'public'), { recursive: true });
  fs.mkdirSync(SEED_DIR, { recursive: true });
}

function writeLines(filePath, lines) {
  if (!lines.length) {
    fs.writeFileSync(filePath, '');
    return;
  }
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`);
}

async function backfillEvents(token, drivers) {
  let since = getSinceTokenDaysAgo(LOOKBACK_DAYS + 1);
  // Prefer midnight lookback helper; fall back to exact 6d stamp if needed
  if (!since) since = sinceTokenFromDate(new Date(Date.now() - LOOKBACK_DAYS * 86400000));

  const warningById = new Map();
  const kpiById = new Map();
  const fuelByKey = new Map();
  let pages = 0;
  let totalRaw = 0;

  console.log(`\n📡 Events backfill from sinceToken=${since}`);

  while (pages < MAX_PAGES) {
    pages++;
    const { events, nextToken, status } = await fetchEventsPage(token, since);
    totalRaw += events.length;
    console.log(`  page ${pages}: status=${status} events=${events.length} next=${nextToken || '(none)'}`);

    for (const e of events) {
      const typeId = e.EventTypeId?.toString();
      const eventId = e.EventId?.toString();

      if (WARNING_EVENT_TYPES[typeId]) {
        const key = eventId || `${typeId}:${e.AssetId}:${e.EventDateTime}`;
        if (!warningById.has(key)) {
          const driver = driverInfo(drivers, e.DriverId);
          const label = WARNING_EVENT_TYPES[typeId];
          const speed = extractMixEventSpeedKph(e, null, { allowLiveFallback: false });
          if (isOverspeedLabel(label) && !qualifiesAsOverspeed(label, speed, { requireSpeed: true })) {
            continue;
          }
          warningById.set(key, JSON.stringify({
            timestamp: new Date().toISOString(),
            assetId: e.AssetId?.toString(),
            driverId: e.DriverId?.toString(),
            driverName: driver.name,
            driverPhone: driver.phone,
            eventId,
            eventType: typeId,
            label,
            eventTime: e.EventDateTime,
            receivedAt: e.ReceivedDateTime,
            latitude: e.Position?.Latitude || null,
            longitude: e.Position?.Longitude || null,
            address: e.Position?.FormattedAddress || null,
            speed,
            speedLimit: e.SpeedLimit ?? e.ZoneSpeedLimit ?? e.SpeedLimitKilometresPerHour ?? null,
          }));
        }
      }

      if (KPI_EVENT_IDS.has(typeId)) {
        const key = eventId || `${typeId}:${e.AssetId}:${e.EventDateTime}`;
        if (!kpiById.has(key)) {
          const line = serializeKpiLogEntry(e, driverInfo(drivers, e.DriverId));
          if (line) {
            try {
              const row = JSON.parse(line);
              if (row.category === 'overspeed') {
                const speed = row.speed ?? extractMixEventSpeedKph(e, null, { allowLiveFallback: false });
                row.speed = speed;
                if (!qualifiesAsOverspeed(row.label || row.category, speed, { requireSpeed: true })) {
                  continue;
                }
                kpiById.set(key, JSON.stringify(row));
              } else {
                kpiById.set(key, line);
              }
            } catch {
              kpiById.set(key, line);
            }
          }
        }
      }

      if (FUEL_PROBE_KNOWN_IDS.has(typeId) && FUEL_PROBE_LOG_IDS.has(typeId)) {
        const assetId = e.AssetId?.toString();
        const level = extractFuelLevel(e);
        const ts = extractEventTimestamp(e);
        if (assetId && level != null && ts) {
          const key = eventId || `${assetId}:${ts}:${typeId}`;
          if (!fuelByKey.has(key)) {
            fuelByKey.set(key, serializeFuelLogEntry({
              assetId,
              level,
              timestamp: ts,
              eventType: fuelEventTypeFromId(typeId) || '5min_ticker',
              eventId,
              driverId: e.DriverId?.toString(),
            }));
          }
        }
      }
    }

    if (!nextToken || nextToken === since) break;
    since = nextToken;
    if (events.length === 0 && status === 204) {
      // advance through empty windows until near "now"
      const tokenAge = Date.now() - Date.UTC(
        +since.slice(0, 4), +since.slice(4, 6) - 1, +since.slice(6, 8),
        +since.slice(8, 10), +since.slice(10, 12), +since.slice(12, 14),
      );
      if (tokenAge < 15 * 60_000) break;
    }
  }

  return {
    warnings: [...warningById.values()],
    kpi: [...kpiById.values()],
    fuel: [...fuelByKey.values()],
    pages,
    totalRaw,
    finalToken: since,
  };
}

async function backfillTrips(token) {
  let since = getSinceTokenDaysAgo(LOOKBACK_DAYS + 1);
  const tripsByKey = new Map();
  let pages = 0;
  let totalRaw = 0;

  console.log(`\n🛣️  Trips backfill from sinceToken=${since}`);

  while (pages < MAX_PAGES) {
    pages++;
    const { trips, nextToken, status } = await fetchTripsPage(token, since);
    totalRaw += trips.length;
    console.log(`  page ${pages}: status=${status} trips=${trips.length} next=${nextToken || '(none)'}`);

    for (const trip of trips) {
      const tripId = trip.TripId ?? trip.TripID ?? trip.Id ?? trip.tripId;
      const key = tripId != null
        ? String(tripId)
        : `${trip.AssetId || 'x'}-${trip.TripStart || trip.TripEnd || trip.CreatedDate}`;
      tripsByKey.set(key, JSON.stringify(trip));
    }

    if (!nextToken || nextToken === since) break;
    since = nextToken;
    if (trips.length === 0 && status === 204) {
      const tokenAge = Date.now() - Date.UTC(
        +since.slice(0, 4), +since.slice(4, 6) - 1, +since.slice(6, 8),
        +since.slice(8, 10), +since.slice(10, 12), +since.slice(12, 14),
      );
      if (tokenAge < 15 * 60_000) break;
    }
  }

  return { trips: [...tripsByKey.values()], pages, totalRaw, finalToken: since };
}

async function main() {
  if (!ORG_ID || !process.env.MIX_USERNAME) {
    console.error('Missing MiX env (.env) — MIX_* and LAFARGE_ORG_ID required');
    process.exit(1);
  }

  ensureDirs();
  console.log(`🔐 Authenticating (lookback ≤${LOOKBACK_DAYS}d)…`);
  const token = await authenticate();
  console.log('✅ Authenticated');

  const drivers = await fetchDrivers(token);
  console.log(`👥 Drivers: ${drivers.size}`);

  const events = await backfillEvents(token, drivers);
  const trips = await backfillTrips(token);

  // Runtime paths (local / droplet after import)
  writeLines(PATHS.events, events.warnings);
  writeLines(PATHS.kpi, events.kpi);
  writeLines(PATHS.fuel, events.fuel);
  writeLines(PATHS.trips, trips.trips);
  fs.writeFileSync(PATHS.tripsSession, JSON.stringify({
    sinceToken: trips.finalToken,
    lastUpdate: new Date().toISOString(),
    count: trips.trips.length,
    source: 'backfill-week',
  }, null, 2));

  // Git-friendly seed for DigitalOcean
  writeLines(PATHS.seedEvents, events.warnings);
  writeLines(PATHS.seedKpi, events.kpi);
  writeLines(PATHS.seedFuel, events.fuel);
  writeLines(PATHS.seedTrips, trips.trips);
  fs.writeFileSync(PATHS.seedMeta, JSON.stringify({
    createdAt: new Date().toISOString(),
    lookbackDays: LOOKBACK_DAYS,
    counts: {
      warnings: events.warnings.length,
      kpi: events.kpi.length,
      fuel: events.fuel.length,
      trips: trips.trips.length,
      eventPages: events.pages,
      tripPages: trips.pages,
      rawEvents: events.totalRaw,
      rawTrips: trips.totalRaw,
    },
  }, null, 2));

  console.log('\n✅ Backfill complete');
  console.log(`   events.log (warnings): ${events.warnings.length}`);
  console.log(`   kpi-events.log:        ${events.kpi.length}`);
  console.log(`   fuel-history.log:      ${events.fuel.length}`);
  console.log(`   public/trips.log:      ${trips.trips.length}`);
  console.log(`   seed/week/             ready to commit & push`);
}

main().catch(err => {
  console.error('❌ Backfill failed:', err);
  process.exit(1);
});
