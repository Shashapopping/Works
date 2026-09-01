/**
 * HBM fleet SQLite — own fleet.db (separate from Chevron/JMG).
 * Trips are queried from disk; do not keep a full trip Map in RAM.
 */
import Database from 'better-sqlite3';
import path from 'path';
import { qualifiesAsOverspeed, isOverspeedLabel, OVERSPEED_MIN_KPH } from './overspeed-filter.js';

let db;

export function getDb() {
  if (!db) {
    db = new Database(path.join(process.cwd(), 'fleet.db'));
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('foreign_keys = ON');
    // Cap page cache (~8MB) so heavy domains do not balloon RSS on small VMs
    db.pragma('cache_size = -8000');
    db.pragma('temp_store = MEMORY');
    // 128MB mmap is a conservative sweet spot for read-heavy dashboards.
    db.pragma('mmap_size = 134217728');
    // Retry briefly instead of instantly throwing SQLITE_BUSY.
    db.pragma('busy_timeout = 5000');
    initSchema();
  }
  return db;
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      event_id TEXT PRIMARY KEY,
      timestamp TEXT,
      asset_id TEXT,
      driver_id TEXT,
      driver_name TEXT,
      driver_phone TEXT,
      event_type TEXT,
      label TEXT,
      event_time TEXT,
      received_at TEXT,
      latitude REAL,
      longitude REAL,
      address TEXT,
      speed REAL,
      speed_limit REAL,
      type TEXT DEFAULT 'warning'
    );

    CREATE TABLE IF NOT EXISTS panic (
      event_id TEXT PRIMARY KEY,
      timestamp TEXT,
      asset_id TEXT,
      driver_id TEXT,
      driver_name TEXT,
      driver_phone TEXT,
      event_time TEXT,
      received_at TEXT,
      latitude REAL,
      longitude REAL,
      address TEXT,
      type TEXT DEFAULT 'panic'
    );

    CREATE TABLE IF NOT EXISTS acknowledged (
      id TEXT PRIMARY KEY
    );

    CREATE TABLE IF NOT EXISTS trips (
      trip_id TEXT PRIMARY KEY,
      asset_id TEXT,
      driver_id TEXT,
      trip_start TEXT,
      trip_end TEXT,
      distance_km REAL,
      driving_time REAL,
      duration REAL,
      max_speed_kph REAL,
      source TEXT NOT NULL DEFAULT 'mix'
    );

    CREATE TABLE IF NOT EXISTS fuel_history (
      dedupe_key TEXT PRIMARY KEY,
      asset_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      level REAL,
      event_type TEXT,
      event_id TEXT,
      driver_id TEXT
    );

    CREATE TABLE IF NOT EXISTS kpi_events (
      event_id TEXT PRIMARY KEY,
      timestamp TEXT,
      asset_id TEXT,
      driver_id TEXT,
      driver_name TEXT,
      event_type_id TEXT,
      category TEXT,
      label TEXT,
      event_time TEXT,
      end_time TEXT,
      value REAL,
      speed REAL,
      latitude REAL,
      longitude REAL
    );

    CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
    CREATE INDEX IF NOT EXISTS idx_events_event_time ON events(event_time);
    CREATE INDEX IF NOT EXISTS idx_events_asset_id ON events(asset_id);
    CREATE INDEX IF NOT EXISTS idx_events_label ON events(label);
    CREATE INDEX IF NOT EXISTS idx_panic_timestamp ON panic(timestamp);
    CREATE INDEX IF NOT EXISTS idx_panic_event_time ON panic(event_time);
    CREATE INDEX IF NOT EXISTS idx_panic_asset_id ON panic(asset_id);
    CREATE INDEX IF NOT EXISTS idx_trips_end ON trips(trip_end);
    CREATE INDEX IF NOT EXISTS idx_trips_asset ON trips(asset_id);
    CREATE INDEX IF NOT EXISTS idx_trips_asset_end ON trips(asset_id, trip_end);
    -- Open trips (trip_end IS NULL) should be scanned via trip_start ranges.
    CREATE INDEX IF NOT EXISTS idx_trips_start_open ON trips(trip_start) WHERE trip_end IS NULL;
    CREATE INDEX IF NOT EXISTS idx_trips_asset_start_open ON trips(asset_id, trip_start) WHERE trip_end IS NULL;
    CREATE INDEX IF NOT EXISTS idx_trips_driver ON trips(driver_id);
    CREATE INDEX IF NOT EXISTS idx_fuel_asset_ts ON fuel_history(asset_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_fuel_ts ON fuel_history(timestamp);
    CREATE INDEX IF NOT EXISTS idx_kpi_event_time ON kpi_events(event_time);
    CREATE INDEX IF NOT EXISTS idx_kpi_category ON kpi_events(category);
    CREATE INDEX IF NOT EXISTS idx_kpi_asset ON kpi_events(asset_id);

    CREATE TABLE IF NOT EXISTS roles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS role_permissions (
      role_id TEXT NOT NULL,
      permission_id TEXT NOT NULL,
      PRIMARY KEY (role_id, permission_id),
      FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      must_change_password INTEGER NOT NULL DEFAULT 0,
      is_organisational INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      last_login_at TEXT,
      FOREIGN KEY (role_id) REFERENCES roles(id)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS auth_audit (
      id TEXT PRIMARY KEY,
      actor_id TEXT,
      action TEXT NOT NULL,
      target_id TEXT,
      meta TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

    CREATE TABLE IF NOT EXISTS report_automations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      frequency TEXT NOT NULL,
      packs TEXT NOT NULL,
      recipients TEXT NOT NULL,
      send_hour INTEGER NOT NULL DEFAULT 7,
      day_of_week INTEGER,
      day_of_month INTEGER,
      timezone TEXT NOT NULL DEFAULT 'Africa/Lagos',
      last_sent_at TEXT,
      next_send_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_report_automations_user ON report_automations(user_id);
    CREATE INDEX IF NOT EXISTS idx_report_automations_next ON report_automations(next_send_at);

    CREATE TABLE IF NOT EXISTS document_folders (
      id TEXT PRIMARY KEY,
      parent_id TEXT,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      FOREIGN KEY (parent_id) REFERENCES document_folders(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS document_files (
      id TEXT PRIMARY KEY,
      folder_id TEXT NOT NULL,
      name TEXT NOT NULL,
      mime TEXT,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      storage_path TEXT NOT NULL,
      source TEXT,
      meta_json TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (folder_id) REFERENCES document_folders(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_document_folders_parent ON document_folders(parent_id);
    CREATE INDEX IF NOT EXISTS idx_document_folders_path ON document_folders(path);
    CREATE INDEX IF NOT EXISTS idx_document_files_folder ON document_files(folder_id);
    CREATE INDEX IF NOT EXISTS idx_document_files_created ON document_files(created_at);

    CREATE TABLE IF NOT EXISTS driver_warnings (
      id TEXT PRIMARY KEY,
      driver_key TEXT NOT NULL,
      driver_name TEXT NOT NULL,
      comment TEXT NOT NULL,
      discipline_band TEXT,
      issued_by_user_id TEXT NOT NULL,
      issued_by_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (issued_by_user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS user_notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'driver_warning',
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      link TEXT,
      warning_id TEXT,
      read_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS warning_recipients (
      warning_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      email_sent INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (warning_id, user_id),
      FOREIGN KEY (warning_id) REFERENCES driver_warnings(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_user_notifications_user ON user_notifications(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_user_notifications_unread ON user_notifications(user_id, read_at);
  `);

  function ensureColumn(table, column, typeSql) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
    if (!cols.includes(column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${typeSql}`);
    }
  }

  // Migrations for existing DBs
  const userCols = db.prepare(`PRAGMA table_info(users)`).all().map(c => c.name);
  if (!userCols.includes('is_organisational')) {
    db.exec(`ALTER TABLE users ADD COLUMN is_organisational INTEGER NOT NULL DEFAULT 0`);
  }
  ensureColumn('users', 'transporter', 'TEXT');
  const eventCols = db.prepare(`PRAGMA table_info(events)`).all().map(c => c.name);
  if (!eventCols.includes('speed')) {
    db.exec(`ALTER TABLE events ADD COLUMN speed REAL`);
  }
  if (!eventCols.includes('speed_limit')) {
    db.exec(`ALTER TABLE events ADD COLUMN speed_limit REAL`);
  }

  // Trip rollup metrics (Chevron-style) — column store, no JSON payload required
  ensureColumn('trips', 'fuel_litres', 'REAL');
  ensureColumn('trips', 'drive_fuel_litres', 'REAL');
  ensureColumn('trips', 'idle_fuel_litres', 'REAL');
  ensureColumn('trips', 'driving_hours', 'REAL');
  ensureColumn('trips', 'standing_hours', 'REAL');
  ensureColumn('trips', 'idle_hours', 'REAL');
  ensureColumn('trips', 'engine_hours', 'REAL');
  ensureColumn('trips', 'has_subtrips', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('report_automations', 'title', 'TEXT');
  ensureColumn('report_automations', 'report_config', 'TEXT');
  ensureColumn('report_automations', 'format', "TEXT NOT NULL DEFAULT 'csv'");
  ensureColumn('report_automations', 'last_offline_snapshot', 'TEXT');

  // Keep known BPL / bootstrap accounts organisational (idempotent)
  db.prepare(`
    UPDATE users SET is_organisational = 1
    WHERE COALESCE(is_organisational, 0) = 0
      AND (
        lower(email) LIKE '%bestpracticesltd.com%'
        OR lower(email) = 'admin@hbm.local'
      )
  `).run();
}

export function withTransaction(fn) {
  return getDb().transaction(fn)();
}

export function insertEvent(entry) {
  getDb().prepare(`
    INSERT OR IGNORE INTO events
    (event_id, timestamp, asset_id, driver_id, driver_name, driver_phone, event_type, label, event_time, received_at, latitude, longitude, address, speed, speed_limit, type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    entry.eventId?.toString(),
    entry.timestamp,
    entry.assetId?.toString(),
    entry.driverId?.toString() || null,
    entry.driverName || null,
    entry.driverPhone || null,
    entry.eventType?.toString() || null,
    entry.label || null,
    entry.eventTime || null,
    entry.receivedAt || null,
    entry.latitude ?? null,
    entry.longitude ?? null,
    entry.address || null,
    entry.speed ?? null,
    entry.speedLimit ?? entry.speed_limit ?? null,
    'warning',
  );
}

export function insertPanic(entry) {
  getDb().prepare(`
    INSERT OR IGNORE INTO panic
    (event_id, timestamp, asset_id, driver_id, driver_name, driver_phone, event_time, received_at, latitude, longitude, address, type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    entry.eventId?.toString(),
    entry.timestamp,
    entry.assetId?.toString(),
    entry.driverId?.toString() || null,
    entry.driverName || null,
    entry.driverPhone || null,
    entry.eventTime || null,
    entry.receivedAt || null,
    entry.latitude ?? null,
    entry.longitude ?? null,
    entry.address || null,
    'panic',
  );
}

export function updateEventAddress(eventId, address) {
  const id = eventId?.toString();
  if (!id || !address) return;
  const database = getDb();
  database.prepare('UPDATE events SET address = ? WHERE event_id = ?').run(address, id);
  database.prepare('UPDATE panic SET address = ? WHERE event_id = ?').run(address, id);
}

export function isEventKnown(eventId) {
  const id = eventId?.toString();
  const database = getDb();
  return !!(
    database.prepare('SELECT 1 FROM events WHERE event_id = ?').get(id) ||
    database.prepare('SELECT 1 FROM panic WHERE event_id = ?').get(id)
  );
}

export function getAcknowledged() {
  return getDb().prepare('SELECT id FROM acknowledged').all().map(r => r.id);
}

export function addAcknowledged(id) {
  getDb().prepare('INSERT OR IGNORE INTO acknowledged (id) VALUES (?)').run(id);
}

export function clearAcknowledged() {
  getDb().prepare('DELETE FROM acknowledged').run();
}

/**
 * Safety UI reads `events`, while Road Speed / Tiered often land only in `kpi_events`.
 * Promote qualifying rows (≥60 kph) into `events` so Behaviour Profile can see them.
 */
let lastOverspeedPromoteMs = 0;
export function promoteKpiOverspeedVariantsToEvents() {
  const now = Date.now();
  if (now - lastOverspeedPromoteMs < 60_000) return 0;
  lastOverspeedPromoteMs = now;
  const database = getDb();
  const result = database.prepare(`
    INSERT OR IGNORE INTO events
      (event_id, timestamp, asset_id, driver_id, driver_name, driver_phone, event_type, label,
       event_time, received_at, latitude, longitude, address, speed, speed_limit, type)
    SELECT
      event_id, timestamp, asset_id, driver_id, driver_name, NULL, event_type_id, label,
      event_time, timestamp, latitude, longitude, NULL, speed, NULL, 'warning'
    FROM kpi_events
    WHERE label IN ('Road Speed Overspeeding', 'Overspeed Tiered')
      AND speed IS NOT NULL
      AND speed >= 60
  `).run();
  return result.changes || 0;
}

export function getAllEvents(filters = {}) {
  promoteKpiOverspeedVariantsToEvents();
  const database = getDb();
  const { from, to, types, limit } = filters;
  const unbounded = limit === null;
  const parsedLimit = unbounded
    ? ((from || to) ? null : 500)
    : Math.min(Math.max(Number.isFinite(Number(limit)) ? Number(limit) : 5000, 1), 20000);
  const offset = Math.max(Number(filters.offset) || 0, 0);
  const driver = filters.driver || null;

  const conditions = [];
  const params = [];
  if (from) { conditions.push('event_time >= ?'); params.push(from); }
  if (to) { conditions.push('event_time <= ?'); params.push(to); }
  if (types && types.length > 0) {
    conditions.push(`label IN (${types.map(() => '?').join(', ')})`);
    params.push(...types);
  }
  if (driver) { conditions.push('driver_name = ?'); params.push(driver); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limitClause = parsedLimit == null
    ? ''
    : `LIMIT ${Math.floor(parsedLimit)} OFFSET ${Math.floor(offset)}`;

  const events = database.prepare(
    `SELECT * FROM events ${where} ORDER BY event_time DESC ${limitClause}`,
  ).all(...params);

  const panicConditions = [];
  const panicParams = [];
  if (from) { panicConditions.push('event_time >= ?'); panicParams.push(from); }
  if (to) { panicConditions.push('event_time <= ?'); panicParams.push(to); }
  if (driver) { panicConditions.push('driver_name = ?'); panicParams.push(driver); }
  const panicWhere = panicConditions.length ? `WHERE ${panicConditions.join(' AND ')}` : '';
  const includePanic = !types || types.length === 0 || types.includes('Panic');
  const panics = includePanic
    ? database.prepare(
      `SELECT * FROM panic ${panicWhere} ORDER BY event_time DESC ${limitClause}`,
    ).all(...panicParams)
    : [];

  // Backfill speed on older overspeed rows from kpi_events when events.speed is null
  const overspeedMissingSpeed = events.filter(
    e => isOverspeedLabel(e.label) && (e.speed == null || e.speed === ''),
  );
  if (overspeedMissingSpeed.length > 0) {
    const lookup = database.prepare('SELECT speed FROM kpi_events WHERE event_id = ?');
    for (const e of overspeedMissingSpeed) {
      const row = lookup.get(e.event_id?.toString());
      if (row && row.speed != null) e.speed = row.speed;
    }
  }

  const filteredEvents = events.filter(e => {
    if (!isOverspeedLabel(e.label)) return true;
    // After kpi speed backfill: only keep overspeeds with a verified ≥60 kph reading
    return qualifiesAsOverspeed(e.label, e.speed, { requireSpeed: false });
  });

  return [...filteredEvents, ...panics].sort((a, b) => {
    const aTime = a.event_time || a.timestamp || '';
    const bTime = b.event_time || b.timestamp || '';
    return bTime.localeCompare(aTime);
  });
}

/** Accept slim MiX trip or excel/db snake_case row. */
export function upsertTrip(row, source = 'mix') {
  const tripId = (row.trip_id ?? row.TripId ?? row.tripId)?.toString();
  if (!tripId) return false;

  const tripStart = row.trip_start ?? row.TripStart ?? row.tripStart ?? null;
  const tripEnd = row.trip_end ?? row.TripEnd ?? row.tripEnd ?? null;
  const drivingTime = row.driving_time ?? row.DrivingTime ?? row.drivingTimeSeconds ?? null;

  getDb().prepare(`
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
  `).run({
    trip_id: tripId,
    asset_id: (row.asset_id ?? row.AssetId ?? row.assetId)?.toString?.() ?? row.asset_id ?? null,
    driver_id: (row.driver_id ?? row.DriverId ?? row.driverId)?.toString?.() ?? row.driver_id ?? null,
    trip_start: tripStart,
    trip_end: tripEnd,
    distance_km: Number(row.distance_km ?? row.DistanceKilometers ?? row.distanceKm ?? 0) || 0,
    driving_time: drivingTime,
    duration: row.duration ?? row.Duration ?? row.durationSeconds ?? null,
    max_speed_kph: row.max_speed_kph ?? row.MaxSpeedKilometersPerHour ?? row.maxSpeedKph ?? null,
    source: row.source ?? source,
  });
  return true;
}

export function upsertTrips(rows, source = 'mix') {
  if (!rows?.length) return 0;
  const tx = getDb().transaction((list) => {
    let n = 0;
    for (const row of list) {
      if (upsertTrip(row, source)) n += 1;
    }
    return n;
  });
  return tx(rows);
}

export function isTripKnown(tripId) {
  return !!getDb().prepare('SELECT 1 FROM trips WHERE trip_id = ?').get(String(tripId));
}

export function countTrips() {
  return getDb().prepare('SELECT COUNT(*) AS n FROM trips').get().n;
}

function mapTripRow(row) {
  return {
    TripId: row.trip_id,
    AssetId: row.asset_id,
    DriverId: row.driver_id,
    TripStart: row.trip_start,
    TripEnd: row.trip_end,
    DistanceKilometers: row.distance_km,
    DrivingTime: row.driving_time,
    Duration: row.duration,
    MaxSpeedKilometersPerHour: row.max_speed_kph,
  };
}

/**
 * Date-range query. Prefer trip_end; fall back to trip_start.
 * Returns slim MiX-shaped objects for existing distance helpers.
 * Optional assetIds limits to those assets (chunked IN lists).
 */
export function getTripsInRange(startIso, endIso, assetIds = null) {
  const db = getDb();
  const ids = Array.isArray(assetIds)
    ? [...new Set(assetIds.map(id => id?.toString()).filter(Boolean))]
    : null;

  if (ids && ids.length === 0) return [];

  if (!ids) {
    return db.prepare(`
      SELECT trip_id, asset_id, driver_id, trip_start, trip_end,
             distance_km, driving_time, duration, max_speed_kph
      FROM trips
      WHERE (
        (trip_end IS NOT NULL AND trip_end >= ? AND trip_end < ?)
        OR
        (trip_end IS NULL AND trip_start >= ? AND trip_start < ?)
      )
    `).all(startIso, endIso, startIso, endIso).map(mapTripRow);
  }

  const CHUNK = 80;
  const out = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => '?').join(',');
    const rows = db.prepare(`
      SELECT trip_id, asset_id, driver_id, trip_start, trip_end,
             distance_km, driving_time, duration, max_speed_kph
      FROM trips
      WHERE asset_id IN (${placeholders})
        AND (
          (trip_end IS NOT NULL AND trip_end >= ? AND trip_end < ?)
          OR
          (trip_end IS NULL AND trip_start >= ? AND trip_start < ?)
        )
    `).all(...chunk, startIso, endIso, startIso, endIso);
    for (const row of rows) out.push(mapTripRow(row));
  }
  return out;
}

function fuelDedupeKey({ assetId, timestamp, level, eventType, eventId }) {
  if (eventId) return `id:${eventId}`;
  return `ts:${assetId}:${timestamp}:${level}:${eventType || ''}`;
}

export function insertFuelReading(entry) {
  const assetId = entry.assetId?.toString();
  const timestamp = entry.timestamp;
  if (!assetId || timestamp == null || entry.level == null) return false;
  const eventType = entry.eventType || null;
  const eventId = entry.eventId?.toString() || null;
  getDb().prepare(`
    INSERT OR IGNORE INTO fuel_history
    (dedupe_key, asset_id, timestamp, level, event_type, event_id, driver_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    fuelDedupeKey({ assetId, timestamp, level: entry.level, eventType, eventId }),
    assetId,
    timestamp,
    Number(entry.level),
    eventType,
    eventId,
    entry.driverId?.toString() || null,
  );
  return true;
}

export function insertFuelReadings(entries) {
  if (!entries?.length) return 0;
  const tx = getDb().transaction((list) => {
    let n = 0;
    for (const e of list) {
      if (insertFuelReading(e)) n += 1;
    }
    return n;
  });
  return tx(entries);
}

/** CamelCase rows for existing fuel APIs / consumption engine. */
export function getFuelHistory({ fromIso = null, toIso = null, eventType = null } = {}) {
  const conditions = [];
  const params = [];
  if (fromIso) { conditions.push('timestamp >= ?'); params.push(fromIso); }
  if (toIso) { conditions.push('timestamp <= ?'); params.push(toIso); }
  if (eventType) {
    if (eventType === '5min_ticker') {
      conditions.push("(event_type = ? OR event_type IS NULL OR event_type = '')");
      params.push(eventType);
    } else {
      conditions.push('event_type = ?');
      params.push(eventType);
    }
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = getDb().prepare(
    `SELECT asset_id, timestamp, level, event_type, event_id, driver_id
     FROM fuel_history ${where} ORDER BY timestamp ASC`,
  ).all(...params);
  return rows.map(r => ({
    assetId: r.asset_id,
    timestamp: r.timestamp,
    level: r.level,
    eventType: r.event_type || '5min_ticker',
    eventId: r.event_id,
    driverId: r.driver_id,
  }));
}

export function insertKpiEvent(entry) {
  const eventId = entry.eventId?.toString();
  if (!eventId) return false;
  getDb().prepare(`
    INSERT OR IGNORE INTO kpi_events
    (event_id, timestamp, asset_id, driver_id, driver_name, event_type_id, category, label, event_time, end_time, value, speed, latitude, longitude)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    eventId,
    entry.timestamp || null,
    entry.assetId?.toString() || null,
    entry.driverId?.toString() || null,
    entry.driverName || null,
    entry.eventTypeId?.toString() || null,
    entry.category || null,
    entry.label || null,
    entry.eventTime || null,
    entry.endTime || null,
    entry.value ?? null,
    entry.speed ?? null,
    entry.latitude ?? null,
    entry.longitude ?? null,
  );
  return true;
}

export function insertKpiEvents(entries) {
  if (!entries?.length) return 0;
  const tx = getDb().transaction((list) => {
    let n = 0;
    for (const e of list) {
      if (insertKpiEvent(e)) n += 1;
    }
    return n;
  });
  return tx(entries);
}

export function getKpiEvents({ fromIso = null, toIso = null } = {}) {
  const conditions = [];
  const params = [];
  if (fromIso) { conditions.push('COALESCE(event_time, timestamp) >= ?'); params.push(fromIso); }
  if (toIso) { conditions.push('COALESCE(event_time, timestamp) <= ?'); params.push(toIso); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = getDb().prepare(
    `SELECT * FROM kpi_events ${where} ORDER BY COALESCE(event_time, timestamp) ASC`,
  ).all(...params);
  return rows.map(r => ({
    eventId: r.event_id,
    timestamp: r.timestamp,
    assetId: r.asset_id,
    driverId: r.driver_id,
    driverName: r.driver_name,
    eventTypeId: r.event_type_id,
    category: r.category,
    label: r.label,
    eventTime: r.event_time,
    endTime: r.end_time,
    value: r.value,
    speed: r.speed,
    latitude: r.latitude,
    longitude: r.longitude,
  }));
}

/**
 * Drop old rows across heavy tables so SQLite stays lean on small VMs.
 * Days are inclusive lookback windows (e.g. 45 ≈ keep last ~1.5 months).
 */
export function pruneFleetHistory({
  trips = 45,
  events = 45,
  fuel = 45,
  kpi = 45,
} = {}) {
  const database = getDb();
  const cut = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const tripCut = cut(trips);
  const eventCut = cut(events);
  const fuelCut = cut(fuel);
  const kpiCut = cut(kpi);

  const tripsDeleted = database.prepare(`
    DELETE FROM trips
    WHERE COALESCE(source, 'mix') != 'excel'
      AND COALESCE(trip_end, trip_start) IS NOT NULL
      AND COALESCE(trip_end, trip_start) < ?
  `).run(tripCut).changes;

  const eventsDeleted = database.prepare(`
    DELETE FROM events
    WHERE COALESCE(event_time, timestamp) IS NOT NULL
      AND COALESCE(event_time, timestamp) < ?
  `).run(eventCut).changes;

  const panicDeleted = database.prepare(`
    DELETE FROM panic
    WHERE COALESCE(event_time, timestamp) IS NOT NULL
      AND COALESCE(event_time, timestamp) < ?
  `).run(eventCut).changes;

  const fuelDeleted = database.prepare(`
    DELETE FROM fuel_history WHERE timestamp < ?
  `).run(fuelCut).changes;

  const kpiDeleted = database.prepare(`
    DELETE FROM kpi_events
    WHERE COALESCE(event_time, timestamp) IS NOT NULL
      AND COALESCE(event_time, timestamp) < ?
  `).run(kpiCut).changes;

  try { database.pragma('wal_checkpoint(TRUNCATE)'); } catch { /* ignore */ }
  try { database.exec('PRAGMA optimize'); } catch { /* ignore */ }

  return {
    trips: tripsDeleted,
    events: eventsDeleted + panicDeleted,
    fuel: fuelDeleted,
    kpi: kpiDeleted,
  };
}

/** Lightweight trip rows for rollups — core columns only. */
export function loadTripMetricsInRange(fromIso, toIso) {
  const database = getDb();
  const conditions = [];
  const params = [];
  if (fromIso) {
    conditions.push('COALESCE(trip_end, trip_start) >= ?');
    params.push(fromIso);
  }
  if (toIso) {
    conditions.push('COALESCE(trip_end, trip_start) < ?');
    params.push(toIso);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return database.prepare(`
    SELECT trip_id AS tripId,
           asset_id AS assetId,
           driver_id AS driverId,
           trip_start AS tripStart,
           trip_end AS tripEnd,
           distance_km AS distanceKm,
           driving_time AS drivingTime,
           duration AS duration
    FROM trips
    ${where}
  `).all(...params);
}

function tripRangeWhere(fromIso, toIso) {
  const conditions = [];
  const params = [];
  if (fromIso && toIso) {
    conditions.push(`(
      (trip_end IS NOT NULL AND trip_end >= ? AND trip_end < ?)
      OR (trip_end IS NULL AND trip_start IS NOT NULL AND trip_start >= ? AND trip_start < ?)
    )`);
    params.push(fromIso, toIso, fromIso, toIso);
  } else if (fromIso) {
    conditions.push(`(
      (trip_end IS NOT NULL AND trip_end >= ?)
      OR (trip_end IS NULL AND trip_start IS NOT NULL AND trip_start >= ?)
    )`);
    params.push(fromIso, fromIso);
  } else if (toIso) {
    conditions.push(`(
      (trip_end IS NOT NULL AND trip_end < ?)
      OR (trip_end IS NULL AND trip_start IS NOT NULL AND trip_start < ?)
    )`);
    params.push(toIso, toIso);
  }
  return { conditions, params };
}

/** Last trip driver_id per asset in the window (for roster name lookup). */
export function loadLastDriverIdByAsset(fromIso, toIso) {
  const database = getDb();
  const { conditions, params } = tripRangeWhere(fromIso, toIso);
  conditions.push(`driver_id IS NOT NULL`);
  conditions.push(`driver_id != ''`);
  const where = `WHERE ${conditions.join(' AND ')}`;
  try {
    return database.prepare(`
      SELECT assetId, driverId FROM (
        SELECT asset_id AS assetId,
               driver_id AS driverId,
               ROW_NUMBER() OVER (
                 PARTITION BY asset_id
                 ORDER BY COALESCE(trip_end, trip_start) DESC
               ) AS rn
        FROM trips
        ${where}
      ) WHERE rn = 1
    `).all(...params);
  } catch {
    return [];
  }
}

/** Pre-aggregated trip rollups by asset (SQL GROUP BY). */
export function loadTripRollupsByAsset(fromIso, toIso) {
  const database = getDb();
  const { conditions, params } = tripRangeWhere(fromIso, toIso);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return database.prepare(`
    SELECT asset_id AS assetId,
           COUNT(*) AS tripCount,
           COALESCE(SUM(distance_km), 0) AS totalDistanceKm,
           COALESCE(SUM(COALESCE(driving_time, duration, 0)), 0) / 3600.0 AS totalDrivingHours,
           MAX(COALESCE(trip_end, trip_start)) AS lastEndedAt
    FROM trips
    ${where}
    GROUP BY asset_id
  `).all(...params);
}

/** Pre-aggregated trip rollups by driver. */
export function loadTripRollupsByDriver(fromIso, toIso) {
  const database = getDb();
  const { conditions, params } = tripRangeWhere(fromIso, toIso);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return database.prepare(`
    SELECT driver_id AS driverId,
           COUNT(*) AS tripCount,
           COALESCE(SUM(distance_km), 0) AS totalDistanceKm,
           COALESCE(SUM(COALESCE(driving_time, duration, 0)), 0) / 3600.0 AS totalDrivingHours
    FROM trips
    ${where}
    GROUP BY driver_id
  `).all(...params);
}

/** Distinct driver ↔ asset pairs (for site-scope vehicle matching on trips=0 path). */
export function loadTripDriverAssets(fromIso, toIso) {
  const database = getDb();
  const { conditions, params } = tripRangeWhere(fromIso, toIso);
  conditions.push(`driver_id IS NOT NULL`);
  conditions.push(`driver_id != ''`);
  conditions.push(`asset_id IS NOT NULL`);
  conditions.push(`asset_id != ''`);
  const where = `WHERE ${conditions.join(' AND ')}`;
  return database.prepare(`
    SELECT DISTINCT driver_id AS driverId, asset_id AS assetId
    FROM trips
    ${where}
  `).all(...params);
}

export function countTripsInRange(fromIso, toIso) {
  const database = getDb();
  const { conditions, params } = tripRangeWhere(fromIso, toIso);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return database.prepare(`SELECT COUNT(*) AS c FROM trips ${where}`).get(...params)?.c || 0;
}
