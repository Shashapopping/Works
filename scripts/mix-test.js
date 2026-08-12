import * as dotenv from 'dotenv';
dotenv.config();

import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { KPI_EVENT_IDS, serializeKpiLogEntry } from "./kpi-constants.js";
import {
  getDb,
  insertEvent,
  insertPanic,
  updateEventAddress,
  upsertTrips,
  getTripsInRange,
  countTrips,
  insertFuelReadings,
  insertKpiEvents,
  pruneFleetHistory,
} from "./db.js";
import { fuelEventTypeFromId } from "./fuel-constants.js";

const IDENTITY_URL = "https://identity.za.mixtelematics.com/core/connect/token";
const API_BASE = "https://integrate.za.mixtelematics.com/api";

const CREDENTIALS = {
  username: process.env.MIX_USERNAME,
  password: process.env.MIX_PASSWORD,
  client_id: process.env.MIX_CLIENT_ID,
  client_secret: process.env.MIX_CLIENT_SECRET,
};

const LAFARGE_ORG_ID = process.env.LAFARGE_ORG_ID;

/** 30s poll — positions + active events. Trips are on a slower cadence below. */
const POLL_INTERVAL_MS = 30 * 1000;
/** Trips cadence — keep reasonably fresh for HOS / distance. */
const TRIPS_POLL_INTERVAL_MS = 5 * 60 * 1000;
/** While the sinceToken is >2h behind (within the live window), poll more often. */
const TRIPS_CATCHUP_POLL_MS = 30 * 1000;
const TRIPS_PAGE_SIZE = 1000;
/** Keep trip sync light — only a few pages per cycle (no multi-day backfill drain). */
const TRIPS_MAX_PAGES_PER_CYCLE = 8;
const TRIPS_CATCHUP_BUDGET_MS = 20_000;
/** Only sync recent trips for live HOS/distance. Older history stays in SQLite as-is. */
const TRIPS_LIVE_LOOKBACK_HOURS = 24;
const MAX_RUNS = 1200;
const DRIVER_REFRESH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const VEHICLE_REFRESH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const SITE_REFRESH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
/** SQLite retention — keep history bounded on 1GB droplets.
 *  Trips/fuel retain ~Jan–Jun window (≥7 months); events/KPI stay short (RAM). */
const DB_RETENTION_DAYS = {
  trips: 220,
  events: 45,
  fuel: 220,
  kpi: 45,
};
const DB_PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000;

let runCount = 0;
let inFlight = null;
let pollingInterval = null;
let pollingMaxRuns = MAX_RUNS;
let lastDriverFetch = 0;
let lastVehicleFetch = 0;
let lastSiteFetch = 0;
let lastTripsFetch = 0;
let lastDbPrune = 0;

// Trips state — history lives in fleet.db (not RAM)
const TRIPS_SESSION_FILE = path.join(process.cwd(), 'public', 'trips-session.json');
const TRIP_MERGE_GAP_MS  = 5 * 60 * 1000;
/** MiX rejects sinceTokens older than ~7 days — validity ceiling only. */
const TRIPS_MAX_LOOKBACK_DAYS = 6;

/** Unknown EventTypeIds already sampled this process — avoid unbounded unknown-events.log growth. */
const unknownEventTypesLogged = new Set();

/** Keep only fields needed for KPI / distance / fuel — drop fat position blobs. */
function slimTrip(trip) {
  if (!trip || typeof trip !== 'object') return trip;
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

function getSinceToken(date) {
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}000`;
}

function getTripsLiveSinceToken() {
  return getSinceToken(new Date(Date.now() - TRIPS_LIVE_LOOKBACK_HOURS * 60 * 60 * 1000));
}

function getTripsInitialSinceToken() {
  // Cold start / reset: only the live window — do not backfill multi-day fleets.
  return getTripsLiveSinceToken();
}

function parseSinceToken(token) {
  if (!token || String(token).length < 14) return null;
  const t = String(token);
  return new Date(Date.UTC(
    +t.slice(0, 4), +t.slice(4, 6) - 1, +t.slice(6, 8),
    +t.slice(8, 10), +t.slice(10, 12), +t.slice(12, 14),
  ));
}

function isTripSinceTokenValid(token) {
  const date = parseSinceToken(token);
  if (!date || isNaN(date.getTime())) return false;
  const ageMs = Date.now() - date.getTime();
  return ageMs >= 0 && ageMs < TRIPS_MAX_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
}

function isTripSinceTokenInLiveWindow(token) {
  const date = parseSinceToken(token);
  if (!date || isNaN(date.getTime())) return false;
  const ageMs = Date.now() - date.getTime();
  return ageMs >= 0 && ageMs <= TRIPS_LIVE_LOOKBACK_HOURS * 60 * 60 * 1000;
}

function resetTripSinceToken(reason) {
  tripSinceToken = getTripsLiveSinceToken();
  console.log(`🛣️ Trip sinceToken reset (${reason}): ${tripSinceToken}`);
}

let tripSinceToken = getTripsInitialSinceToken();

function getTripKey(trip) {
  const tripId = trip.TripId ?? trip.TripID ?? trip.Id ?? trip.tripId;
  if (tripId != null) return String(tripId);
  return (
    `${trip.AssetId || trip.AssetID || trip.assetId || 'unknown'}-${
      trip.TripStart || trip.tripStart || trip.StartDateTime ||
      trip.TripEnd || trip.tripEnd || trip.EndDateTime ||
      trip.CreatedDate || 'unknown'
    }`
  );
}

function getTripTime(trip) {
  const raw = trip.TripEnd || trip.tripEnd || trip.EndDateTime
           || trip.TripStart || trip.tripStart || trip.StartDateTime
           || trip.CreatedDate;
  const time = raw ? new Date(raw).getTime() : NaN;
  return Number.isFinite(time) ? time : 0;
}

function normalizeTripForDistance(trip) {
  const driverId = (trip.DriverId ?? trip.driverId)?.toString() || null;
  const assetId  = (trip.AssetId  ?? trip.AssetID ?? trip.assetId)?.toString() || null;
  const driver   = driverLookup.get(driverId);
  const vehicle  = vehicleLookup.get(assetId);
  return {
    tripId:             getTripKey(trip),
    driverId,
    driverName:         driver?.name          || trip.DriverName       || trip.driverName  || 'N/A',
    driverPhone:        driver?.phone         || trip.driverPhone      || 'N/A',
    assetId,
    regNo:              vehicle?.RegistrationNumber || trip.RegistrationNumber || trip.regNo || 'N/A',
    assetName:          vehicle?.Description  || trip.AssetDescription || trip.assetName   || 'N/A',
    distanceKm:         Number(trip.DistanceKilometers ?? trip.distanceKm ?? 0),
    tripStart:          trip.TripStart  || trip.tripStart  || trip.StartDateTime || null,
    tripEnd:            trip.TripEnd    || trip.tripEnd    || trip.EndDateTime   || null,
    drivingTimeSeconds: trip.DrivingTime ?? trip.drivingTimeSeconds ?? null,
    durationSeconds:    trip.Duration   ?? trip.durationSeconds    ?? null,
    maxSpeedKph:        trip.MaxSpeedKilometersPerHour ?? trip.maxSpeedKph ?? null,
  };
}

function mergeTrips(sortedTrips) {
  if (!sortedTrips.length) return [];
  const journeys = [];
  let current = { ...sortedTrips[0], mergedCount: 1 };
  for (let i = 1; i < sortedTrips.length; i++) {
    const trip         = sortedTrips[i];
    const currentEndMs = current.tripEnd ? new Date(current.tripEnd).getTime() : 0;
    const nextStartMs  = trip.tripStart  ? new Date(trip.tripStart).getTime()  : Infinity;
    if (nextStartMs - currentEndMs <= TRIP_MERGE_GAP_MS) {
      current = {
        ...current,
        tripEnd:            trip.tripEnd || current.tripEnd,
        distanceKm:         current.distanceKm + trip.distanceKm,
        drivingTimeSeconds: (current.drivingTimeSeconds || 0) + (trip.drivingTimeSeconds || 0),
        durationSeconds:    (current.durationSeconds    || 0) + (trip.durationSeconds    || 0),
        maxSpeedKph:        Math.max(current.maxSpeedKph || 0, trip.maxSpeedKph || 0),
        mergedCount:        current.mergedCount + 1,
      };
    } else {
      journeys.push(current);
      current = { ...trip, mergedCount: 1 };
    }
  }
  journeys.push(current);
  return journeys;
}

function loadTripSession() {
  getDb(); // ensure fleet.db schema exists
  try {
    if (fs.existsSync(TRIPS_SESSION_FILE)) {
      const session = JSON.parse(fs.readFileSync(TRIPS_SESSION_FILE, 'utf8'));
      if (session?.sinceToken && isTripSinceTokenValid(session.sinceToken)) {
        if (isTripSinceTokenInLiveWindow(session.sinceToken)) {
          tripSinceToken = session.sinceToken;
          console.log(`🛣️ Trip sinceToken restored from session: ${tripSinceToken}`);
        } else {
          // Skip multi-day backlog — jump to last 24h so live HOS can fill without crushing the box.
          resetTripSinceToken(
            `session cursor too old for live window (${session.sinceToken}); using last ${TRIPS_LIVE_LOOKBACK_HOURS}h`,
          );
          saveSessionTrips();
        }
      }
    }
  } catch {
    console.log('⚠️ Could not load trips-session.json — using fresh sinceToken');
  }
  console.log(`🛣️ Trips from SQLite — ${countTrips()} row(s) on disk (no RAM cache)`);
}

function getCurrentSinceToken() {
  const now = new Date();
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  return `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}000`;
}

let activeSinceToken = getCurrentSinceToken();
let activeParseRetryDone = false;
let cachedToken = null;
let tokenExpiresAt = 0;

const PANIC_EVENT_TYPE_ID = '-4444421556390778105';
const IDLE_EVENT_TYPE_ID = '-3393530750645328945';
const EXCESSIVE_IDLE_EVENT_TYPE_ID = '4650840888823746694';
const FUEL_PROBE_1MIN_TICKER_EVENT_TYPE_ID = '-6061736210584957932';
const FUEL_PROBE_5MIN_TICKER_EVENT_TYPE_ID = '7835540334200528539';
const FUEL_PROBE_TRIP_START_EVENT_TYPE_ID = '7732808521542418259';
const FUEL_PROBE_TRIP_END_EVENT_TYPE_ID = '-1651664568698074374';

const FUEL_PROBE_EVENT_IDS = new Set([
  FUEL_PROBE_1MIN_TICKER_EVENT_TYPE_ID,
  FUEL_PROBE_5MIN_TICKER_EVENT_TYPE_ID,
  FUEL_PROBE_TRIP_START_EVENT_TYPE_ID,
  FUEL_PROBE_TRIP_END_EVENT_TYPE_ID,
]);

const WARNING_EVENT_TYPES = {
  '4750800303282680186': 'Harsh Braking',
  '6454149451280645233': 'Harsh Acceleration',
  '-3890646499157906515': 'Overspeeding',
  '-4596269900191457380': 'Overspeed Tiered',
  '4291175374538259638': 'Harsh Cornering',
};

const triggeredEvents = new Map();
const triggeredWarningEvents = new Map();

const idleEventVehicles = new Set();
const excessiveIdleVehicles = new Set();

// assetId (string) → { level: number, timestamp: string } — smoothed live display level
const fuelLevels = new Map();
let fuelProbeRawLogged = false;

/** Live fuel display smoothing — probe tickers spike; history stays raw for refuel math. */
const FUEL_SMOOTH_ALPHA = 0.2;       // 0..1 — lower = steadier (more lag)
const FUEL_MAX_STEP_L = 8;           // max liters the live reading can move per sample
const FUEL_SNAP_REFUEL_L = 40;       // upward jump this large → treat as refill, snap through

function smoothLiveFuelLevel(prevLevel, rawLevel) {
  if (!Number.isFinite(rawLevel)) return prevLevel ?? 0;
  if (prevLevel == null || !Number.isFinite(prevLevel)) return rawLevel;
  const delta = rawLevel - prevLevel;
  // Clear refill: accept immediately so the UI doesn't crawl up over many minutes
  if (delta >= FUEL_SNAP_REFUEL_L) return rawLevel;
  // Cap one-step movement, then blend — kills single-tick spikes without freezing the gauge
  const capped = prevLevel + Math.sign(delta) * Math.min(Math.abs(delta), FUEL_MAX_STEP_L);
  return prevLevel * (1 - FUEL_SMOOTH_ALPHA) + capped * FUEL_SMOOTH_ALPHA;
}

let driverLookup = new Map();
let vehicleLookup = new Map();
let siteLookup = new Map(); // SiteId (string) → { siteName, zoneId, zoneName }

function loadDriverLookup() {
  try {
    const driversPath = path.join(process.cwd(), 'public', 'drivers.json');
    if (fs.existsSync(driversPath)) {
      const drivers = JSON.parse(fs.readFileSync(driversPath, 'utf8'));
      driverLookup.clear();
      drivers.forEach(d => {
        driverLookup.set(d.DriverId?.toString(), {
          name: d.Name || 'N/A',
          phone: d.MobileNumber || 'N/A',
        });
      });
      console.log(`👥 Driver lookup loaded — ${driverLookup.size} drivers`);
    }
  } catch {
    console.log('⚠️ Could not load drivers.json — driver details will show N/A');
  }
}

function loadVehicleLookup() {
  try {
    const vehiclesPath = path.join(process.cwd(), 'public', 'vehicles.json');
    if (fs.existsSync(vehiclesPath)) {
      const text = fs.readFileSync(vehiclesPath, 'utf8');
      const safe = text.replace(/:\s*(-?\d{16,})/g, ': "$1"');
      const vehicles = JSON.parse(safe);
      vehicleLookup.clear();
      vehicles.forEach(v => {
        vehicleLookup.set(v.AssetId?.toString(), v);
      });
      console.log(`🚗 Vehicle lookup loaded — ${vehicleLookup.size} vehicles`);
      return true;
    }
  } catch {
    console.log('⚠️ Could not load vehicles.json — will fetch from MiX');
  }
  return false;
}

function flattenGroups(node, zoneName = null, zoneId = null) {
  const entries = [];
  const type = node.Type;

  // OrganisationSubGroup acts as a zone container (e.g. "Light Fleet")
  // SiteGroup/DefaultSite with no parent zone is its own zone
  const isZoneContainer = type === 'OrganisationSubGroup';
  const isSite = type === 'SiteGroup' || type === 'DefaultSite';

  const currentZoneName = isZoneContainer ? node.Name : (zoneName || node.Name);
  const currentZoneId = isZoneContainer ? node.GroupId?.toString() : (zoneId || node.GroupId?.toString());

  if (isSite || isZoneContainer) {
    entries.push({
      id: node.GroupId?.toString(),
      name: node.Name,
      type: node.Type,
      zoneName: currentZoneName,
      zoneId: currentZoneId,
    });
  }

  if (Array.isArray(node.SubGroups)) {
    node.SubGroups.forEach(child => {
      entries.push(...flattenGroups(child, currentZoneName, currentZoneId));
    });
  }
  return entries;
}

function loadSiteLookup() {
  try {
    const sitesPath = path.join(process.cwd(), 'public', 'sites.json');
    if (fs.existsSync(sitesPath)) {
      const sites = JSON.parse(fs.readFileSync(sitesPath, 'utf8'));
      siteLookup.clear();
      sites.forEach(s => siteLookup.set(s.id, s));
      console.log(`🗺️ Site lookup loaded — ${siteLookup.size} entries`);
    }
  } catch {
    console.log('⚠️ Could not load sites.json — zone/site info will be N/A');
  }
}

async function fetchAndCacheSites(token) {
  try {
    console.log('🗺️ Fetching organisation groups from MiX...');
    const response = await fetch(`${API_BASE}/organisationgroups/subgroups/${LAFARGE_ORG_ID}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (response.status === 401) { console.log('⚠️ Token rejected by organisationgroups endpoint'); return; }
    if (!response.ok) { console.log(`⚠️ organisationgroups endpoint returned ${response.status}`); return; }
    const text = await response.text();
    const safe = text.replace(/:\s*(-?\d{16,})/g, ': "$1"');
    const root = JSON.parse(safe);
    const flat = flattenGroups(root);
    const sitesPath = path.join(process.cwd(), 'public', 'sites.json');
    fs.writeFileSync(sitesPath, JSON.stringify(flat, null, 2));
    siteLookup.clear();
    flat.forEach(s => siteLookup.set(s.id, s));
    lastSiteFetch = Date.now();
    console.log(`🗺️ Sites cached — ${flat.length} group entries saved to sites.json`);
  } catch (err) {
    console.log(`⚠️ Site fetch failed: ${err.message}`);
  }
}

async function fetchAndCacheDrivers(token) {
  try {
    console.log('👥 Fetching drivers from MiX...');
    const response = await fetch(`${API_BASE}/drivers/organisation/${LAFARGE_ORG_ID}`, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/json",
      },
    });
    if (response.status === 401) { console.log('⚠️ Token rejected by drivers endpoint'); return; }
    if (!response.ok) { console.log(`⚠️ Drivers endpoint returned ${response.status}`); return; }
    const text = await response.text();
    const safe = text.replace(/:\s*(-?\d{16,})/g, ': "$1"');
    const drivers = JSON.parse(safe);
    const driversPath = path.join(process.cwd(), 'public', 'drivers.json');
    fs.writeFileSync(driversPath, JSON.stringify(drivers, null, 2));
    driverLookup.clear();
    drivers.forEach(d => {
      driverLookup.set(d.DriverId?.toString(), { name: d.Name || 'N/A', phone: d.MobileNumber || 'N/A' });
    });
    lastDriverFetch = Date.now();
    console.log(`👥 Drivers cached — ${drivers.length} drivers saved to drivers.json`);
  } catch (err) {
    console.log(`⚠️ Driver fetch failed: ${err.message}`);
  }
}

async function fetchAndCacheVehicles(token) {
  try {
    console.log('🚗 Fetching vehicles from MiX...');
    const response = await fetch(`${API_BASE}/assets/group/${LAFARGE_ORG_ID}`, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/json",
      },
    });
    if (response.status === 401) { console.log('⚠️ Token rejected by vehicles endpoint'); return; }
    if (!response.ok) { console.log(`⚠️ Vehicles endpoint returned ${response.status}`); return; }
    const text = await response.text();
    const safe = text.replace(/:\s*(-?\d{16,})/g, ': "$1"');
    const vehicles = JSON.parse(safe);
    const vehiclesPath = path.join(process.cwd(), 'public', 'vehicles.json');
    fs.writeFileSync(vehiclesPath, JSON.stringify(vehicles, null, 2));
    vehicleLookup.clear();
    vehicles.forEach(v => {
      vehicleLookup.set(v.AssetId?.toString(), v);
    });
    lastVehicleFetch = Date.now();
    console.log(`🚗 Vehicles cached — ${vehicles.length} vehicles saved to vehicles.json`);
  } catch (err) {
    console.log(`⚠️ Vehicle fetch failed: ${err.message}`);
  }
}

function getDriverInfo(driverId) {
  if (!driverId) return { name: 'N/A', phone: 'N/A' };
  const id = driverId.toString();
  if (id === '-4331286019934761070') return { name: 'No Driver Assigned', phone: 'N/A' };
  return driverLookup.get(id) || { name: 'N/A', phone: 'N/A' };
}

async function reverseGeocode(lat, lon) {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`,
      { headers: { 'User-Agent': 'BPL-CNL-FleetDashboard/1.0', 'Accept-Language': 'en' } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.display_name || null;
  } catch {
    return null;
  }
}

async function enrichEntryWithAddress(_logPath, eventId, lat, lon) {
  try {
    const address = await reverseGeocode(lat, lon);
    if (address) updateEventAddress(eventId, address);
  } catch {
    // silent fail
  }
}

function cleanStaleWarnings() {
  const cutoff = Date.now() - 60_000;
  triggeredWarningEvents.forEach((events, assetId) => {
    const fresh = events.filter(e => new Date(e.timestamp).getTime() > cutoff);
    if (fresh.length === 0) {
      triggeredWarningEvents.delete(assetId);
    } else {
      triggeredWarningEvents.set(assetId, fresh);
    }
  });
}

export function clearTriggeredEvent(assetId) {
  triggeredEvents.delete(assetId);
}

export function getWarningEvents() {
  const result = {};
  triggeredWarningEvents.forEach((events, assetId) => {
    result[assetId] = events;
  });
  return result;
}

export function resetState() {
  triggeredEvents.clear();
  triggeredWarningEvents.clear();
  idleEventVehicles.clear();
  excessiveIdleVehicles.clear();
  activeSinceToken = getCurrentSinceToken();
  activeParseRetryDone = false;
  cachedToken = null;
  tokenExpiresAt = 0;
  lastSiteFetch = 0;
  console.log('🔄 State reset — triggeredEvents cleared, activeSinceToken reset to now');
}

async function authenticate() {
  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt - 60000) return cachedToken;

  const params = new URLSearchParams({
    grant_type: "password",
    username: CREDENTIALS.username,
    password: CREDENTIALS.password,
    client_id: CREDENTIALS.client_id,
    client_secret: CREDENTIALS.client_secret,
    scope: "offline_access MiX.Integrate",
  });

  console.log("🔐 Auth params:", { username: CREDENTIALS.username, client_id: CREDENTIALS.client_id, has_secret: !!CREDENTIALS.client_secret, has_password: !!CREDENTIALS.password });
  const response = await fetch(IDENTITY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });

  const contentType = response.headers.get("content-type");
  if (!contentType || !contentType.includes("application/json")) {
    cachedToken = null;
    tokenExpiresAt = 0;
    console.log("❌ Authentication failed - got HTML instead of JSON");
    throw new Error("Authentication server returned HTML, not JSON");
  }

  const data = await response.json();
  if (!data.access_token) {
    console.log("❌ Auth response:", JSON.stringify(data));
    throw new Error("No access token in response");
  }
  cachedToken = data.access_token;
  tokenExpiresAt = now + (data.expires_in * 1000);
  console.log(`🔑 New token cached, expires in ${data.expires_in}s`);
  return cachedToken;
}

async function getLatestPositions(token) {
  const response = await fetch(`${API_BASE}/positions/groups/latest/1`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/json",
      "Content-Type": "application/json",
    },
    body: `[${process.env.LAFARGE_ORG_ID}]`,
  });
  if (response.status === 401) {
    cachedToken = null; tokenExpiresAt = 0;
    console.log('⚠️ Token rejected by positions endpoint, will re-authenticate next poll');
    return [];
  }
  if (!response.ok) return [];
  const text = await response.text();
  const safe = text.replace(/:\s*(-?\d{16,})/g, ': "$1"');
  return JSON.parse(safe);
}

async function getActivePanicEvents(token) {
  const endpoint = `${API_BASE}/activeevents/groups/createdsince/organisation/${LAFARGE_ORG_ID}/sincetoken/NEW/quantity/1000`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/json",
      "Content-Type": "application/json",
    },
    body: `["-4444421556390778105"]`,
  });
  if (response.status === 401) {
    cachedToken = null; tokenExpiresAt = 0;
    console.log('⚠️ Token rejected by panic events endpoint, will re-authenticate next poll');
    return [];
  }
  if (response.status === 204 || !response.ok) return [];
  const text = await response.text();
  const safe = text.replace(/:\s*(-?\d{16,})/g, ': "$1"');
  return JSON.parse(safe);
}

async function getLatestActiveEvents(token, speedByAsset = new Map()) {
  const endpoint = `${API_BASE}/activeevents/groups/createdsince/entitytype/Asset/sincetoken/${activeSinceToken}/quantity/1000`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/json",
      "Content-Type": "application/json",
    },
    body: `[${LAFARGE_ORG_ID}]`,
  });
  if (response.status === 401) {
    cachedToken = null; tokenExpiresAt = 0;
    console.log('⚠️ Token rejected by latest active events endpoint, will re-authenticate next poll');
    return [];
  }
  if (response.status === 204 || !response.ok) return [];

  const newToken = response.headers.get('GetSinceToken');
  const text = await response.text();

  let parsed;
  try {
    const safe = text.replace(/:\s*(-?\d{16,})/g, ': "$1"');
    parsed = JSON.parse(safe);
  } catch (e) {
    if (!activeParseRetryDone) {
      console.log('⚠️ Active events parse failed, retrying once on next poll...');
      activeParseRetryDone = true;
      return [];
    }
    console.log('⚠️ Active events parse failed again, advancing activeSinceToken and moving on.');
    activeParseRetryDone = false;
    if (newToken) { activeSinceToken = newToken; console.log(`📌 Updated activeSinceToken: ${activeSinceToken}`); }
    return [];
  }

  activeParseRetryDone = false;
  if (newToken) { activeSinceToken = newToken; console.log(`📌 Updated activeSinceToken: ${activeSinceToken}`); }

  // Handle panic events
  const panicEvents = parsed.filter(e => e.EventTypeId === PANIC_EVENT_TYPE_ID);
  if (panicEvents.length > 0) {
    console.log(`🔎 Active Panic found: ${panicEvents.length}`);
    panicEvents.forEach(e => {
      console.log(`🔎 Active Panic - AssetId: ${e.AssetId} | EventTime: ${e.EventDateTime}`);
      const driver = getDriverInfo(e.DriverId);
      const formattedAddress = e.Position?.FormattedAddress;
      insertPanic({
        timestamp: new Date().toISOString(),
        assetId: e.AssetId,
        driverId: e.DriverId,
        driverName: driver.name,
        driverPhone: driver.phone,
        eventId: e.EventId,
        eventTime: e.EventDateTime,
        receivedAt: e.ReceivedDateTime,
        latitude: e.Position?.Latitude || null,
        longitude: e.Position?.Longitude || null,
        address: formattedAddress || null,
      });
      if (!formattedAddress && e.Position?.Latitude && e.Position?.Longitude) {
        enrichEntryWithAddress(null, e.EventId, e.Position.Latitude, e.Position.Longitude);
      }
    });
    console.log(`📝 Panic saved to SQLite`);
  }

  // Handle idle events
  idleEventVehicles.clear();
  const idleEvents = parsed.filter(e => e.EventTypeId === IDLE_EVENT_TYPE_ID);
  idleEvents.forEach(e => {
    const assetId = e.AssetId?.toString();
    if (assetId) {
      idleEventVehicles.add(assetId);
      console.log(`😴 Idle event - AssetId: ${assetId}`);
    }
  });

  // Handle excessive idle events
  excessiveIdleVehicles.clear();
  const excessiveIdleEvents = parsed.filter(e => e.EventTypeId === EXCESSIVE_IDLE_EVENT_TYPE_ID);
  excessiveIdleEvents.forEach(e => {
    const assetId = e.AssetId?.toString();
    if (assetId) {
      excessiveIdleVehicles.add(assetId);
      console.log(`🔴 Excessive idle - AssetId: ${assetId}`);
    }
  });

  // Handle warning events
  const warningEvents = parsed.filter(e => WARNING_EVENT_TYPES[e.EventTypeId]);
  if (warningEvents.length > 0) {
    console.log(`⚠️ Warning events found: ${warningEvents.length}`);
    warningEvents.forEach(e => {
      const driver = getDriverInfo(e.DriverId);
      const formattedAddress = e.Position?.FormattedAddress;
      insertEvent({
        timestamp: new Date().toISOString(),
        assetId: e.AssetId,
        driverId: e.DriverId,
        driverName: driver.name,
        driverPhone: driver.phone,
        eventId: e.EventId,
        eventType: e.EventTypeId,
        label: WARNING_EVENT_TYPES[e.EventTypeId],
        eventTime: e.EventDateTime,
        receivedAt: e.ReceivedDateTime,
        latitude: e.Position?.Latitude || null,
        longitude: e.Position?.Longitude || null,
        address: formattedAddress || null,
      });
      if (!formattedAddress && e.Position?.Latitude && e.Position?.Longitude) {
        enrichEntryWithAddress(null, e.EventId, e.Position.Latitude, e.Position.Longitude);
      }
    });
    console.log(`📝 Warning events saved to SQLite`);

    warningEvents.forEach(e => {
      const assetId = e.AssetId?.toString();
      const label = WARNING_EVENT_TYPES[e.EventTypeId];
      console.log(`⚠️ ${label} - AssetId: ${assetId} | EventTime: ${e.EventDateTime}`);
      if (assetId) {
        if (!triggeredWarningEvents.has(assetId)) triggeredWarningEvents.set(assetId, []);
        const existing = triggeredWarningEvents.get(assetId);
        const alreadyStored = existing.some(ev => ev.eventId === e.EventId);
        if (!alreadyStored) {
          existing.push({
            eventId: e.EventId,
            label,
            timestamp: new Date().toISOString(),
            eventTime: e.EventDateTime,
          });
        }
      }
    });
  }

  // Handle fuel probe events (1min ticker, 5min ticker, trip start/end fuel levels)
  const fuelProbeEvents = parsed.filter(e => FUEL_PROBE_EVENT_IDS.has(e.EventTypeId));
  if (fuelProbeEvents.length > 0) {
    const historyRows = [];
    fuelProbeEvents.forEach(e => {
      const assetId = e.AssetId?.toString();
      if (!assetId) return;
      const level = e.Value ?? e.EventValue ?? e.FuelLevel ?? e.FuelLevelPercentage ?? e.ValueNumber ?? null;
      const ts = e.EventDateTime ?? new Date().toISOString();
      if (level !== null && level !== undefined) {
        const parsedLevel = Math.max(0, parseFloat(level));
        if (!Number.isFinite(parsedLevel)) return;
        // Persist raw probe for consumption / refuel detection
        historyRows.push({
          assetId,
          level: parsedLevel,
          timestamp: ts,
          eventType: fuelEventTypeFromId(e.EventTypeId) || '5min_ticker',
          eventId: e.EventId?.toString() || null,
          driverId: e.DriverId?.toString() || null,
        });
        // Live fleet card / Fuel Monitoring uses a smoothed level so noisy probes don't spike
        const prev = fuelLevels.get(assetId)?.level;
        const smoothed = Math.round(smoothLiveFuelLevel(prev, parsedLevel) * 10) / 10;
        fuelLevels.set(assetId, { level: smoothed, timestamp: ts });
        console.log(`⛽ Fuel Probe — AssetId: ${assetId} | Raw: ${parsedLevel} | Live: ${smoothed}`);
      }
      if (!fuelProbeRawLogged) {
        fuelProbeRawLogged = true;
        const rawPath = path.join(process.cwd(), 'fuel-probe-raw.log');
        fs.writeFileSync(rawPath, JSON.stringify(e, null, 2));
        console.log(`📝 Raw fuel probe event saved to fuel-probe-raw.log`);
      }
    });
    if (historyRows.length > 0) {
      insertFuelReadings(historyRows);
    }
  }

  // Handle KPI events (loaded truck, load duration, fatigue/DMS, overspeed variants)
  const kpiEvents = parsed.filter(e => KPI_EVENT_IDS.has(e.EventTypeId));
  if (kpiEvents.length > 0) {
    const rows = [];
    for (const e of kpiEvents) {
      const line = serializeKpiLogEntry(e, getDriverInfo(e.DriverId));
      if (!line) continue;
      try {
        rows.push(JSON.parse(line));
      } catch { /* skip */ }
    }
    if (rows.length > 0) {
      insertKpiEvents(rows);
      console.log(`📈 KPI events saved to SQLite: ${rows.length}`);
    }
  }

  // Log all unknown event type IDs so we can discover new ones (e.g. Fuel Probe)
  const knownIds = new Set([
    PANIC_EVENT_TYPE_ID, IDLE_EVENT_TYPE_ID, EXCESSIVE_IDLE_EVENT_TYPE_ID,
    ...FUEL_PROBE_EVENT_IDS,
    ...Object.keys(WARNING_EVENT_TYPES),
    ...KPI_EVENT_IDS,
  ]);
  const unknownEvents = parsed.filter(e => e.EventTypeId && !knownIds.has(e.EventTypeId));
  if (unknownEvents.length > 0) {
    const unknownMap = new Map();
    unknownEvents.forEach(e => {
      const id = e.EventTypeId?.toString();
      const name = e.EventTypeName ?? e.EventType ?? e.Description ?? 'N/A';
      if (!unknownMap.has(id)) unknownMap.set(id, { name, count: 0, sample: e });
      unknownMap.get(id).count++;
    });
    const unknownLogPath = path.join(process.cwd(), 'unknown-events.log');
    unknownMap.forEach(({ name, count, sample }, id) => {
      console.log(`🔍 Unknown EventTypeId: ${id} | Name: ${name} | Count: ${count}`);
      if (unknownEventTypesLogged.has(id)) return;
      unknownEventTypesLogged.add(id);
      fs.appendFileSync(unknownLogPath, JSON.stringify({
        timestamp: new Date().toISOString(),
        eventTypeId: id,
        eventTypeName: name,
        count,
        sampleAssetId: sample.AssetId,
        sampleEventTime: sample.EventDateTime,
      }) + '\n');
    });
  }

  return parsed;
}

function mergeData(positions) {
  const positionsByAsset = new Map();
  positions.forEach(p => {
    positionsByAsset.set(p.AssetId?.toString(), p);
  });

  return Array.from(vehicleLookup.values()).filter(vehicle => {
    const siteInfo = siteLookup.get(vehicle.SiteId?.toString());
    return (siteInfo?.name || '') !== 'XN - Decommissioned';
  }).map(vehicle => {
    const assetId = vehicle.AssetId?.toString();
    const pos = positionsByAsset.get(assetId);

    const vehicleEvents = triggeredEvents.get(assetId) || [];
    const hasPanic = vehicleEvents.some(e => e.EventTypeId === PANIC_EVENT_TYPE_ID);
    const warningEvents = triggeredWarningEvents.get(assetId) || [];

    const hasExcessiveIdleEvent = excessiveIdleVehicles.has(assetId);
    const hasIdleEvent = idleEventVehicles.has(assetId);

    let status = 'Offline';

    if (pos) {
      const tsMs = new Date(pos.Timestamp).getTime();
      const posAge = isNaN(tsMs) ? 0 : Date.now() - tsMs;

      if (pos.SpeedKilometresPerHour > 5 && posAge < 5 * 60 * 1000) {
        status = 'Moving';
      } else if (hasExcessiveIdleEvent) {
        status = 'Excessive Idle';
      } else if (hasIdleEvent) {
        status = 'Idle';
      } else {
        const age = isNaN(tsMs) ? Infinity : Date.now() - tsMs;
        if (age < 60 * 60 * 1000) {
          status = 'Stationary';
        } else if (age < 24 * 60 * 60 * 1000) {
          status = 'Parked';
        } else if (age < 30 * 24 * 60 * 60 * 1000) {
          status = 'Offline';
        } else {
          status = 'Inactive';
        }
      }
    }

    const siteInfo = siteLookup.get(vehicle.SiteId?.toString());

    return {
      id: assetId || 'unknown',
      regNo: vehicle.RegistrationNumber || 'N/A',
      transporter: vehicle.SiteName || 'HBM',
      site: siteInfo?.name || 'Unknown Site',
      zone: siteInfo?.zoneName || 'Unknown Zone',
      siteId: vehicle.SiteId?.toString() || null,
      assetName: vehicle.Description || 'Unknown Vehicle',
      make: vehicle.Make || 'N/A',
      model: vehicle.Model || 'N/A',
      status,
      date: pos?.Timestamp || new Date().toISOString(),
      panic: hasPanic,
      warnings: warningEvents,
      fuelLevel: fuelLevels.get(assetId) ?? null,
      position: pos ? {
        latitude: pos.Latitude,
        longitude: pos.Longitude,
        speed: pos.SpeedKilometresPerHour,
        heading: pos.Heading,
        address: pos.FormattedAddress || 'Unknown'
      } : null,
      activeEvents: vehicleEvents.length,
    };
  });
}

function saveSessionTrips() {
  const payload = {
    sinceToken: tripSinceToken,
    lastUpdate: new Date().toISOString(),
    count: countTrips(),
  };
  fs.writeFileSync(TRIPS_SESSION_FILE, JSON.stringify(payload, null, 2));
}

async function getLatestTrips(token) {
  // If the cursor aged past MiX's lookback while the process stayed up, reset so we catch up.
  if (!isTripSinceTokenValid(tripSinceToken)) {
    resetTripSinceToken('sinceToken older than lookback window');
  } else if (!isTripSinceTokenInLiveWindow(tripSinceToken)) {
    // Never grind a multi-day backlog on the live poller — jump to last 24h.
    resetTripSinceToken(`cursor outside live ${TRIPS_LIVE_LOOKBACK_HOURS}h window`);
  }

  let totalReceived = 0;
  let totalInserted = 0;
  let pages = 0;
  const started = Date.now();
  let morePending = false;

  while (pages < TRIPS_MAX_PAGES_PER_CYCLE && (Date.now() - started) < TRIPS_CATCHUP_BUDGET_MS) {
    pages += 1;
    const url = `${API_BASE}/trips/groups/createdsince/organisation/${LAFARGE_ORG_ID}/sincetoken/${tripSinceToken}/quantity/${TRIPS_PAGE_SIZE}`;
    let res;
    try {
      res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
    } catch (e) {
      console.log(`⚠️ Trips fetch failed: ${e?.message || e}`);
      break;
    }

    if (res.status === 401) {
      cachedToken = null; tokenExpiresAt = 0;
      console.log('⚠️ Token rejected by trips endpoint — will re-auth next poll');
      break;
    }

    const newToken = res.headers.get('GetSinceToken');

    if (res.status === 204) {
      if (newToken) tripSinceToken = newToken;
      else {
        const tokenAgeMs = Date.now() - (parseSinceToken(tripSinceToken)?.getTime() || 0);
        if (tokenAgeMs > 24 * 60 * 60 * 1000) {
          resetTripSinceToken('204 with stale sinceToken and no GetSinceToken');
        }
      }
      break;
    }

    if (!res.ok) {
      const errText = await res.text();
      console.log(`⚠️ Trips endpoint ${res.status}: ${errText.slice(0, 200)}`);
      if (res.status === 400 && /SinceToken/i.test(errText)) {
        resetTripSinceToken('stale token rejected by MiX');
      }
      break;
    }

    const text = await res.text();
    const safe = text.replace(/:\s*(-?\d{16,})/g, ': "$1"');
    let trips;
    try { trips = JSON.parse(safe); } catch (e) {
      console.log(`⚠️ Failed to parse trips response: ${e.message}`);
      break;
    }

    if (newToken) tripSinceToken = newToken;

    if (!Array.isArray(trips) || trips.length === 0) {
      if (!newToken) {
        const tokenAgeMs = Date.now() - (parseSinceToken(tripSinceToken)?.getTime() || 0);
        if (tokenAgeMs > 24 * 60 * 60 * 1000) {
          resetTripSinceToken('empty trips body with stale sinceToken');
        }
      }
      break;
    }

    const slimList = trips.map(slimTrip);
    const inserted = upsertTrips(slimList, 'mix');
    totalReceived += slimList.length;
    totalInserted += inserted;

    // Full page usually means more backlog remains — keep draining.
    if (slimList.length >= TRIPS_PAGE_SIZE) {
      morePending = true;
      continue;
    }
    morePending = false;
    break;
  }

  saveSessionTrips();
  if (totalReceived > 0 || pages > 1) {
    console.log(
      `🛣️ Trips: ${pages} page(s), ${totalReceived} received, ${totalInserted} upserted — cursor ${tripSinceToken}`
      + (morePending && pages >= TRIPS_MAX_PAGES_PER_CYCLE ? ' (more pending next cycle)' : ''),
    );
  } else {
    console.log(`🛣️ Trips: caught up (no new) — cursor ${tripSinceToken}`);
  }
  return { fetched: totalReceived, inserted: totalInserted, morePending };
}

/** Session API — recent window only (avoid loading a full week into RAM). */
export function getSessionTrips() {
  const end = new Date();
  const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
  return getTripsInRange(start.toISOString(), end.toISOString());
}

function getMonthBounds(monthValue) {
  const now = new Date();
  const [year, month] = (monthValue || `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`)
    .split('-').map(Number);
  return {
    start: new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0)),
    end:   new Date(Date.UTC(year, month,     1, 0, 0, 0, 0)),
  };
}

function getDistanceRangeBounds(range = '24h', monthValue = null, fromIso = null, toIso = null) {
  if (fromIso && toIso) {
    const start = new Date(fromIso);
    const end = new Date(toIso);
    if (Number.isFinite(start.getTime()) && Number.isFinite(end.getTime()) && end > start) {
      return { start, end };
    }
  }
  const now = new Date();
  if (range === 'currentMonth') {
    const m = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    return getMonthBounds(m);
  }
  if (range === 'lastMonth') {
    const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const m = `${last.getUTCFullYear()}-${String(last.getUTCMonth() + 1).padStart(2, '0')}`;
    return getMonthBounds(m);
  }
  if (range === 'month') {
    return getMonthBounds(monthValue);
  }
  return { start: new Date(now.getTime() - 24 * 60 * 60 * 1000), end: now };
}

export function getDriverDistanceSummary({ range = '24h', month = null, from = null, to = null } = {}) {
  const { start, end } = getDistanceRangeBounds(range, month, from, to);

  const allTrips = getTripsInRange(start.toISOString(), end.toISOString())
    .map(normalizeTripForDistance)
    .filter(trip => {
      if (!(trip.distanceKm >= 0.5)) return false;
      if (!trip.tripStart && !trip.tripEnd) return false;
      const secs = trip.drivingTimeSeconds ?? trip.durationSeconds;
      if (secs !== null && secs !== undefined && secs < 60) return false;
      return true;
    });

  const byAsset = new Map();
  allTrips.forEach(trip => {
    const key = trip.assetId || 'unknown';
    if (!byAsset.has(key)) {
      byAsset.set(key, { assetId: trip.assetId, regNo: trip.regNo, assetName: trip.assetName, rawTrips: [], driverNames: new Set() });
    }
    const asset = byAsset.get(key);
    asset.rawTrips.push(trip);
    if (trip.driverName && trip.driverName !== 'N/A') asset.driverNames.add(trip.driverName);
  });

  const assets = Array.from(byAsset.values()).map(asset => {
    const sorted = [...asset.rawTrips].sort((a, b) =>
      (a.tripStart ? new Date(a.tripStart).getTime() : 0) -
      (b.tripStart ? new Date(b.tripStart).getTime() : 0)
    );
    const journeys = mergeTrips(sorted).filter(j => j.distanceKm >= 0.5);
    const totalDistanceKm = Number(journeys.reduce((s, j) => s + j.distanceKm, 0).toFixed(2));
    const totalDrivingTimeSeconds = journeys.reduce((s, j) => s + (j.drivingTimeSeconds || 0), 0);
    const avgSpeedKph = totalDrivingTimeSeconds > 0
      ? Number((totalDistanceKm / (totalDrivingTimeSeconds / 3600)).toFixed(1))
      : null;
    const longestJourneyKm = journeys.length > 0
      ? Number(Math.max(...journeys.map(j => j.distanceKm)).toFixed(2))
      : 0;
    return {
      assetId: asset.assetId,
      regNo: asset.regNo,
      assetName: asset.assetName,
      totalDistanceKm,
      rawTripCount: asset.rawTrips.length,
      journeyCount: journeys.length,
      totalDrivingTimeSeconds,
      avgSpeedKph,
      longestJourneyKm,
      drivers: Array.from(asset.driverNames),
      journeys,
    };
  }).sort((a, b) => b.totalDistanceKm - a.totalDistanceKm);

  const byDriver = new Map();
  assets.forEach(asset => {
    asset.journeys.forEach(journey => {
      const key = journey.driverId || `asset:${asset.assetId || 'unknown'}`;
      if (!byDriver.has(key)) {
        byDriver.set(key, {
          driverId: journey.driverId,
          driverName: journey.driverName,
          driverPhone: journey.driverPhone,
          totalDistanceKm: 0,
          journeyCount: 0,
          totalDrivingTimeSeconds: 0,
          vehicles: new Set(),
        });
      }
      const d = byDriver.get(key);
      d.totalDistanceKm += journey.distanceKm;
      d.journeyCount += 1;
      d.totalDrivingTimeSeconds += journey.drivingTimeSeconds || journey.durationSeconds || 0;
      if (asset.regNo && asset.regNo !== 'N/A') d.vehicles.add(asset.regNo);
    });
  });

  const drivers = Array.from(byDriver.values())
    .map(d => ({
      ...d,
      totalDistanceKm: Number(d.totalDistanceKm.toFixed(2)),
      totalDrivingTimeSeconds: Math.round(d.totalDrivingTimeSeconds),
      vehicles: Array.from(d.vehicles),
    }))
    .sort((a, b) => b.totalDistanceKm - a.totalDistanceKm);

  return {
    generatedAt: new Date().toISOString(),
    range, month,
    start: start.toISOString(),
    end: end.toISOString(),
    totalDistanceKm: Number(assets.reduce((s, a) => s + a.totalDistanceKm, 0).toFixed(2)),
    rawTripCount: allTrips.length,
    journeyCount: assets.reduce((s, a) => s + a.journeyCount, 0),
    driverCount: drivers.length,
    assetCount: assets.length,
    cachedTripCount: countTrips(),
    assets,
    drivers,
  };
}

/**
 * Walk one driver-day's trips (chronological). Rest = a >=30 min gap between trips
 * (vehicle parked / ignition off). Lafarge trips have no sub-trip telemetry, so — unlike
 * an ELD — a stop *within* a single trip (traffic, loading) can't be distinguished from a
 * genuine break; only inter-trip gaps reset the continuous-driving clock.
 */
function analyzeDriverTripBlocks(trips, { isToday, nowMs, driveLimitMin, restGapMin }) {
  if (!trips.length) {
    return { maxContinuousMin: 0, currentBlockMin: 0, breaches: 0, violationDriveMinutes: 0, violationTripMinutes: 0, violationHistory: [] };
  }

  const restSec = restGapMin * 60;
  const blocks = [];
  let cur = { driveMin: 0, breachAtMs: null };

  const flushBlock = (endMs) => {
    if (cur.driveMin <= 0) return;
    blocks.push({ driveMin: cur.driveMin, breachAtMs: cur.breachAtMs, endMs });
    cur = { driveMin: 0, breachAtMs: null };
  };

  for (let i = 0; i < trips.length; i++) {
    const t = trips[i];
    if (i > 0) {
      const gapSec = (t.startMs - trips[i - 1].endMs) / 1000;
      if (gapSec >= restSec) flushBlock(trips[i - 1].endMs);
    }

    const before = cur.driveMin;
    const pulseMin = t.driveSec / 60;
    cur.driveMin += pulseMin;

    if (before < driveLimitMin && cur.driveMin >= driveLimitMin) {
      const needMin = driveLimitMin - before;
      const frac = pulseMin > 0 ? needMin / pulseMin : 1;
      cur.breachAtMs = t.startMs + frac * (t.endMs - t.startMs);
    }
  }

  const lastTrip = trips[trips.length - 1];
  const gapSinceLastMin = isToday ? (nowMs - lastTrip.endMs) / 60000 : Infinity;
  if (isToday && gapSinceLastMin >= restGapMin) {
    flushBlock(lastTrip.endMs);
  } else if (cur.driveMin > 0) {
    flushBlock(isToday ? nowMs : lastTrip.endMs);
  }

  let maxContinuousMin = 0;
  let currentBlockMin = 0;
  let breaches = 0;
  let violationDriveMinutes = 0;
  let violationTripMinutes = 0;
  const violationHistory = [];

  blocks.forEach((b, idx) => {
    const rounded = Math.round(b.driveMin);
    if (rounded > maxContinuousMin) maxContinuousMin = rounded;
    if (idx === blocks.length - 1 && !(isToday && gapSinceLastMin >= restGapMin)) currentBlockMin = rounded;
    if (b.breachAtMs != null) {
      breaches++;
      const vDrive = Math.round(Math.max(0, b.driveMin - driveLimitMin));
      const vTrip = Math.max(0, Math.round((b.endMs - b.breachAtMs) / 60000));
      violationDriveMinutes += vDrive;
      violationTripMinutes += vTrip;
      violationHistory.push({
        breachAt: new Date(b.breachAtMs).toISOString(),
        violationDriveMinutes: vDrive,
        violationTripMinutes: vTrip,
      });
    }
  });

  if (isToday && gapSinceLastMin >= restGapMin) currentBlockMin = 0;

  return { maxContinuousMin, currentBlockMin, breaches, violationDriveMinutes, violationTripMinutes, violationHistory };
}

/**
 * Hours-of-Service — 4 hours continuous driving requires a >=30-minute rest.
 * A rest resets the continuous block; a rest is a >=30 min gap between trips (parked).
 * "Today" = since 00:00 Africa/Lagos (UTC+1, no DST).
 */
export function getHosRecords(dayStr) {
  // HOS can be called from the API without a poll cycle having run yet (or after HMR).
  if (driverLookup.size === 0) loadDriverLookup();
  if (vehicleLookup.size === 0) loadVehicleLookup();

  const liveZoneByAsset = new Map();
  try {
    const dataPath = path.join(process.cwd(), 'public', 'data.json');
    if (fs.existsSync(dataPath)) {
      const rows = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
      rows.forEach(v => {
        if (v.id && v.zone) liveZoneByAsset.set(String(v.id), v.zone);
      });
    }
  } catch { /* ignore */ }

  const DRIVE_LIMIT_MIN = 240; // 4 hours
  const DUTY_LIMIT_MIN = 720;  // 12 hours (display only)
  const REST_GAP_MIN = 30;     // a >=30m gap counts as a rest / break
  const WARN_MIN = 210;        // "approaching 4h" (within 30 min of the limit)

  const nowMs = Date.now();
  const LAGOS_OFFSET_MS = 60 * 60 * 1000; // UTC+1

  const todayStr = new Date(nowMs + LAGOS_OFFSET_MS).toISOString().slice(0, 10);
  const targetStr = /^\d{4}-\d{2}-\d{2}$/.test(dayStr || '') ? dayStr : todayStr;
  const isToday = targetStr === todayStr;

  const [ty, tm, td] = targetStr.split('-').map(Number);
  const startOfDay = Date.UTC(ty, tm - 1, td, 0, 0, 0) - LAGOS_OFFSET_MS;
  const endOfDay = startOfDay + 24 * 60 * 60 * 1000;

  let lastTripDay = null;
  try {
    const latest = getDb().prepare(`
      SELECT COALESCE(trip_end, trip_start) AS t
      FROM trips
      WHERE COALESCE(trip_end, trip_start) IS NOT NULL
      ORDER BY t DESC
      LIMIT 1
    `).get();
    if (latest?.t) {
      lastTripDay = new Date(new Date(latest.t).getTime() + LAGOS_OFFSET_MS).toISOString().slice(0, 10);
    }
  } catch { /* ignore */ }

  const byDriver = new Map();
  for (const raw of getTripsInRange(new Date(startOfDay).toISOString(), new Date(endOfDay).toISOString())) {
    const t = normalizeTripForDistance(raw);
    const startMs = t.tripStart ? new Date(t.tripStart).getTime() : NaN;
    const endMs = t.tripEnd ? new Date(t.tripEnd).getTime() : NaN;
    const anchor = Number.isFinite(endMs) ? endMs : startMs;
    if (!Number.isFinite(anchor) || anchor < startOfDay || anchor >= endOfDay) continue;
    if (!t.driverId && (!t.driverName || t.driverName === 'N/A')) continue;

    const key = t.driverId || t.driverName;
    const spanSec = Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs
      ? (endMs - startMs) / 1000
      : 0;
    const driveSecRaw = Number(t.drivingTimeSeconds);
    const driveSec = Number.isFinite(driveSecRaw) && driveSecRaw > 0 ? driveSecRaw : spanSec;
    const tStartMs = Number.isFinite(startMs) ? startMs : anchor;
    const tEndMs = Number.isFinite(endMs) ? endMs : anchor;
    if (tEndMs <= tStartMs) continue;

    if (!byDriver.has(key)) byDriver.set(key, []);
    byDriver.get(key).push({
      startMs: tStartMs,
      endMs: tEndMs,
      driveSec,
      driverName: t.driverName,
      assetId: t.assetId,
      regNo: t.regNo,
    });
  }

  const records = [];
  for (const [key, trips] of byDriver.entries()) {
    trips.sort((a, b) => a.startMs - b.startMs);

    const driveMinutesToday = Math.round(trips.reduce((s, t) => s + t.driveSec, 0) / 60);
    const firstStart = trips[0].startMs;
    const lastEnd = trips[trips.length - 1].endMs;
    const dutyMinutesToday = Math.max(driveMinutesToday, Math.round((lastEnd - firstStart) / 60000));

    const analysis = analyzeDriverTripBlocks(trips, {
      isToday, nowMs, driveLimitMin: DRIVE_LIMIT_MIN, restGapMin: REST_GAP_MIN,
    });
    const { maxContinuousMin, currentBlockMin, breaches, violationDriveMinutes, violationTripMinutes, violationHistory } = analysis;

    const continuousMin = isToday ? currentBlockMin : maxContinuousMin;

    let status = 'compliant';
    if (continuousMin >= DRIVE_LIMIT_MIN) status = 'violation';
    else if (continuousMin >= WARN_MIN) status = 'warning';

    const restMinutesRemaining = isToday ? Math.max(0, DRIVE_LIMIT_MIN - currentBlockMin) : 0;
    const restDueAt = isToday && restMinutesRemaining > 0
      ? new Date(nowMs + restMinutesRemaining * 60000).toISOString()
      : null;

    const lastTrip = trips[trips.length - 1];
    const resolvedName = (lastTrip.driverName && lastTrip.driverName !== 'N/A')
      ? lastTrip.driverName
      : (driverLookup.get(String(key))?.name || lastTrip.driverName || 'N/A');
    const site = (lastTrip.assetId && liveZoneByAsset.get(lastTrip.assetId)) || 'HBM';

    records.push({
      id: String(key),
      driverName: resolvedName,
      vehicleReg: lastTrip.regNo || 'N/A',
      site,
      driveMinutesToday,
      dutyMinutesToday,
      continuousMinutes: continuousMin,
      maxContinuousMinutes: maxContinuousMin,
      currentBlockMinutes: currentBlockMin,
      breaches,
      violationDriveMinutes,
      violationTripMinutes,
      violationHistory,
      driveLimitMinutes: DRIVE_LIMIT_MIN,
      dutyLimitMinutes: DUTY_LIMIT_MIN,
      restMinutesRemaining,
      status,
      restDueAt,
      lastUpdated: new Date(nowMs).toISOString(),
    });
  }

  const statusOrder = { violation: 0, warning: 1, compliant: 2 };
  records.sort((a, b) => {
    if (statusOrder[a.status] !== statusOrder[b.status]) return statusOrder[a.status] - statusOrder[b.status];
    return b.driveMinutesToday - a.driveMinutesToday;
  });

  return {
    updatedAt: new Date(nowMs).toISOString(),
    day: targetStr,
    isToday,
    lastTripDay,
    records,
  };
}

export async function pollOnce() {
  if (inFlight) return inFlight;

  inFlight = (async () => {
    runCount++;
    cleanStaleWarnings();

    console.log("\n" + "=".repeat(70));
    console.log(`RUN #${runCount} of ${pollingMaxRuns ?? "∞"} - ${new Date().toLocaleString('en-GB', { timeZone: 'Africa/Lagos' })}`);
    console.log("=".repeat(70));

    try {
      const token = await authenticate();
      console.log("✅ Authenticated");

      if (driverLookup.size === 0 || Date.now() - lastDriverFetch > DRIVER_REFRESH_INTERVAL_MS) {
        await fetchAndCacheDrivers(token);
      }

      if (vehicleLookup.size === 0 || Date.now() - lastVehicleFetch > VEHICLE_REFRESH_INTERVAL_MS) {
        await fetchAndCacheVehicles(token);
      }

      if (siteLookup.size === 0 || Date.now() - lastSiteFetch > SITE_REFRESH_INTERVAL_MS) {
        await fetchAndCacheSites(token);
      }

      // Positions every poll; trips on a slower cadence — accelerate while cursor is behind.
      const positions = await getLatestPositions(token);
      const tripTokenAgeMs = Date.now() - (parseSinceToken(tripSinceToken)?.getTime() || 0);
      const tripsDueMs = tripTokenAgeMs > 2 * 60 * 60 * 1000 ? TRIPS_CATCHUP_POLL_MS : TRIPS_POLL_INTERVAL_MS;
      if (Date.now() - lastTripsFetch >= tripsDueMs || lastTripsFetch === 0) {
        await getLatestTrips(token);
        lastTripsFetch = Date.now();
      }

      if (Date.now() - lastDbPrune >= DB_PRUNE_INTERVAL_MS || lastDbPrune === 0) {
        try {
          const pruned = pruneFleetHistory(DB_RETENTION_DAYS);
          console.log(`🧹 SQLite prune: trips−${pruned.trips} events−${pruned.events} fuel−${pruned.fuel} kpi−${pruned.kpi}`);
        } catch (e) {
          console.log('⚠️ SQLite prune skipped:', e?.message || e);
        }
        lastDbPrune = Date.now();
      }

      const speedByAsset = new Map(
        positions.map(p => [p.AssetId?.toString(), p.SpeedKilometresPerHour ?? null])
      );

      const latestActiveEvents = await getLatestActiveEvents(token, speedByAsset);

      console.log(`✅ Vehicles: ${vehicleLookup.size} | Active Events: ${latestActiveEvents.length} | Positions: ${positions.length}`);

      latestActiveEvents.forEach(event => {
        if (event.EventTypeId === PANIC_EVENT_TYPE_ID) {
          const assetId = event.AssetId?.toString();
          if (assetId) {
            if (!triggeredEvents.has(assetId)) triggeredEvents.set(assetId, []);
            const existing = triggeredEvents.get(assetId);
            const alreadyStored = existing.some(e => e.EventId === event.EventId);
            if (!alreadyStored) existing.push(event);
          }
        }
      });

      if (vehicleLookup.size === 0 || positions.length === 0) {
        console.log('⚠️ Empty response from MiX, skipping write to data.json');
        return { ok: true, stats: null, runCount };
      }

      const merged = mergeData(positions);

      const stats = {
        panic: merged.filter(v => v.panic).length,
        moving: merged.filter(v => v.status === 'Moving').length,
        idle: merged.filter(v => v.status === 'Idle').length,
        excessiveIdle: merged.filter(v => v.status === 'Excessive Idle').length,
        stationary: merged.filter(v => v.status === 'Stationary').length,
        parked: merged.filter(v => v.status === 'Parked').length,
        inactive: merged.filter(v => v.status === 'Inactive').length,
        offline: merged.filter(v => v.status === 'Offline').length,
        warnings: merged.filter(v => v.warnings && v.warnings.length > 0).length,
      };

      const dataPath = path.join(process.cwd(), 'public', 'data.json');
      const metadataPath = path.join(process.cwd(), 'public', 'metadata.json');
      // Compact JSON — pretty-print doubled disk IO every poll on ~2MB fleet dumps
      fs.writeFileSync(dataPath, JSON.stringify(merged));

      const metadata = {
        lastUpdate: new Date().toISOString(),
        runNumber: runCount,
        totalVehicles: merged.length,
        ...stats
      };
      fs.writeFileSync(metadataPath, JSON.stringify(metadata));

      console.log(`📊 Panic: ${stats.panic} | Warnings: ${stats.warnings} | Moving: ${stats.moving} | Idle: ${stats.idle} | Excessive Idle: ${stats.excessiveIdle} | Stationary: ${stats.stationary} | Parked: ${stats.parked} | Inactive: ${stats.inactive} | Offline: ${stats.offline}`);
      console.log("💾 Saved to data.json");

      if (stats.panic > 0) {
        console.log("\n🚨 PANIC ALERT DETECTED! 🚨");
        const panicVehicles = merged.filter(v => v.panic);
        panicVehicles.forEach(v => console.log(`   ${v.regNo} - ${v.assetName}`));
      }

      if (stats.warnings > 0) {
        console.log(`\n⚠️ ${stats.warnings} vehicle(s) with active warnings`);
      }

      return { ok: true, stats, runCount };
    } catch (error) {
      console.error("❌ Error:", error.message);
      return { ok: false, error: error.message ?? String(error), runCount };
    }
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

export function startPolling(options = {}) {
  if (pollingInterval) {
    console.log('⚠️ Polling already running, ignoring duplicate start');
    return;
  }
  const { intervalMs = POLL_INTERVAL_MS, maxRuns = MAX_RUNS } = options;
  pollingMaxRuns = maxRuns ?? null;

  loadDriverLookup();
  loadVehicleLookup();
  loadSiteLookup();
  loadTripSession();

  console.log("🚀 MiX Auto-Polling Started");
  console.log("=".repeat(70));
  console.log(`Polling interval: ${intervalMs / 1000} seconds (positions/events)`);
  console.log(`Trips cadence: every ${TRIPS_POLL_INTERVAL_MS / 60000} min (catch-up every ${TRIPS_CATCHUP_POLL_MS / 1000}s when behind) · live window ${TRIPS_LIVE_LOOKBACK_HOURS}h · page ${TRIPS_PAGE_SIZE} · up to ${TRIPS_MAX_PAGES_PER_CYCLE} pages/cycle`);
  console.log(`SQLite retention: ${DB_RETENTION_DAYS.trips}d · prune every ${DB_PRUNE_INTERVAL_MS / 3600000}h`);
  console.log(`Total runs: ${pollingMaxRuns ?? "∞"}`);
  if (pollingMaxRuns) {
    console.log(`Estimated duration: ${(pollingMaxRuns * intervalMs) / 1000}s (~${((pollingMaxRuns * intervalMs) / 60000).toFixed(1)} min)`);
  }
  console.log("=".repeat(70));
  console.log("\nPress Ctrl+C to stop early\n");

  pollOnce();

  if (pollingInterval) clearInterval(pollingInterval);
  pollingInterval = setInterval(async () => {
    await pollOnce();
    if (pollingMaxRuns && runCount >= pollingMaxRuns) {
      clearInterval(pollingInterval);
      pollingInterval = null;
    }
  }, intervalMs);
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  if (!global.__mixPollingStarted) {
    global.__mixPollingStarted = true;
    startPolling({ intervalMs: POLL_INTERVAL_MS, maxRuns: MAX_RUNS });
  }
}