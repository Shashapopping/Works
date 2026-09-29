/**
 * Stored stats — heavy census values (safety summary, HOS) are served from RAM/SQLite and
 * refreshed by a low-priority child process (stats-worker.js). A request never computes:
 * it gets the stored copy, or waits for the worker only the first time a key is seen.
 */
import { fork, spawnSync } from 'child_process';
import crypto from 'crypto';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from './db.js';

const WORKER_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'stats-worker.js');
const CYCLE_MS = 10 * 60_000;
const ACTIVE_KEY_MS = 24 * 60 * 60_000;
const PRUNE_AFTER_MS = 3 * 24 * 60 * 60_000;
const FIRST_VALUE_WAIT_MS = 100_000;
const JOB_PAUSE_MS = 2_000;
const JOB_TIMEOUT_MS = 15 * 60_000;
const WORKER_RESPAWN_MS = 5_000;
const LAGOS_OFFSET_MS = 60 * 60_000;

/** key → { kind, params, json, computedAt, lastRequestedAt } */
const entries = new Map();
const queue = [];
const queued = new Set();
/** key → [{ resolve, reject, timer }] */
const waiters = new Map();
let worker = null;
let workerReady = false;
let current = null;
let jobSeq = 0;
let pumpTimer = null;
let started = false;

function ensureTable() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS stats_cache (
      key TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      params_json TEXT NOT NULL,
      value_json TEXT NOT NULL,
      computed_at INTEGER NOT NULL,
      last_requested_at INTEGER NOT NULL
    )
  `);
}

function floorToCycleIso(value) {
  if (!value) return null;
  const ms = new Date(value).getTime();
  if (!Number.isFinite(ms)) return String(value);
  return new Date(Math.floor(ms / CYCLE_MS) * CYCLE_MS).toISOString();
}

function normalizeAssetIds(raw) {
  if (raw == null || raw === '') return null;
  const ids = [...new Set(String(raw).split(',').map(id => id.trim()).filter(Boolean))].sort();
  return ids.length ? ids.join(',') : null;
}

function lagosToday() {
  return new Date(Date.now() + LAGOS_OFFSET_MS).toISOString().slice(0, 10);
}

function normalizeParams(kind, raw = {}) {
  if (kind === 'hos') {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(raw.date || '') && raw.date !== lagosToday() ? raw.date : null;
    return { date };
  }
  // "Now"-based custom windows would create a new key per request; one bucket per cycle.
  return {
    range: raw.range || '30d',
    from: floorToCycleIso(raw.from),
    to: floorToCycleIso(raw.to),
    assetIds: normalizeAssetIds(raw.assetIds),
  };
}

function keyFor(kind, params) {
  return `${kind}:${crypto.createHash('sha1').update(JSON.stringify(params)).digest('hex')}`;
}

/** cycle = every 10 min; nightly = first cycle after local midnight; on-demand = when requested and stale. */
function refreshPolicy(kind, params) {
  if (kind === 'hos') return params.date ? 'nightly' : 'cycle';
  if (params.from || params.to) return 'on-demand';
  if (params.range === 'prev30d' || params.range === 'prev30days') return 'nightly';
  return 'cycle';
}

function describe(entry) {
  const p = entry.params;
  if (entry.kind === 'hos') return `hos ${p.date || 'today'}`;
  const window = p.from || p.to ? `${p.from}..${p.to}` : p.range;
  const scope = p.assetIds ? ` scoped(${p.assetIds.split(',').length})` : '';
  return `safety-summary ${window}${scope}`;
}

function lastLocalMidnight() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function touch(kind, rawParams, now = Date.now()) {
  const params = normalizeParams(kind, rawParams);
  const key = keyFor(kind, params);
  let entry = entries.get(key);
  if (!entry) {
    entry = { kind, params, json: null, computedAt: 0, lastRequestedAt: now };
    entries.set(key, entry);
  }
  entry.lastRequestedAt = now;
  return { key, entry };
}

function enqueue(key, front = false) {
  if (current?.key === key) return;
  if (queued.has(key)) {
    if (!front) return;
    queue.splice(queue.indexOf(key), 1);
  } else {
    queued.add(key);
  }
  if (front) queue.unshift(key);
  else queue.push(key);
  schedulePump(0);
}

function schedulePump(delayMs) {
  if (pumpTimer) return;
  pumpTimer = setTimeout(() => {
    pumpTimer = null;
    pump();
  }, delayMs);
}

function pump() {
  if (!worker || !workerReady || current || queue.length === 0) return;
  const key = queue.shift();
  queued.delete(key);
  const entry = entries.get(key);
  if (!entry) return pump();
  const id = ++jobSeq;
  current = {
    key,
    id,
    timer: setTimeout(() => {
      console.log(`⚠️ Stats job ${describe(entry)} exceeded ${JOB_TIMEOUT_MS / 60_000} min — restarting worker`);
      worker?.kill('SIGKILL');
    }, JOB_TIMEOUT_MS),
  };
  worker.send({ id, kind: entry.kind, params: entry.params });
}

function settle(key, err) {
  const list = waiters.get(key);
  if (!list) return;
  waiters.delete(key);
  const json = entries.get(key)?.json;
  for (const w of list) {
    clearTimeout(w.timer);
    if (err) w.reject(err);
    else w.resolve(json);
  }
}

function waitFor(key) {
  return new Promise((resolve, reject) => {
    const w = { resolve, reject, timer: null };
    w.timer = setTimeout(() => {
      const list = waiters.get(key) || [];
      waiters.set(key, list.filter(x => x !== w));
      reject(Object.assign(new Error('Stats are still being prepared'), { code: 'STATS_WARMING' }));
    }, FIRST_VALUE_WAIT_MS);
    if (!waiters.has(key)) waiters.set(key, []);
    waiters.get(key).push(w);
  });
}

function persist(key, entry) {
  try {
    getDb().prepare(`
      INSERT INTO stats_cache (key, kind, params_json, value_json, computed_at, last_requested_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value_json = excluded.value_json,
        computed_at = excluded.computed_at,
        last_requested_at = excluded.last_requested_at
    `).run(key, entry.kind, JSON.stringify(entry.params), entry.json, entry.computedAt, entry.lastRequestedAt);
  } catch (err) {
    console.log('⚠️ Stats persist failed:', err?.message || err);
  }
}

function onWorkerMessage(msg) {
  if (msg?.ready) {
    workerReady = true;
    schedulePump(0);
    return;
  }
  if (!current || msg?.id !== current.id) return;
  clearTimeout(current.timer);
  const { key } = current;
  current = null;
  const entry = entries.get(key);
  if (msg.error) {
    console.log(`⚠️ Stats ${entry ? describe(entry) : key} failed after ${msg.ms} ms: ${msg.error}`);
    settle(key, new Error(msg.error));
  } else if (entry) {
    entry.json = JSON.stringify(msg.value);
    entry.computedAt = Date.now();
    persist(key, entry);
    console.log(`📊 Stats ${describe(entry)} refreshed in ${msg.ms} ms`);
    settle(key, null);
  }
  schedulePump(JOB_PAUSE_MS);
}

/** Linux: ionice idle + nice 19 wrap the node binary so every worker thread inherits the priority. */
function lowPriorityForkOptions() {
  const nodeArgs = ['--max-old-space-size=384'];
  if (process.platform !== 'linux') return { execArgv: nodeArgs, wrapped: false };
  const works = (cmd, args) => {
    try { return spawnSync(cmd, [...args, 'true'], { stdio: 'ignore' }).status === 0; } catch { return false; }
  };
  const prefix = [];
  if (works('ionice', ['-c3'])) prefix.push('ionice', '-c3');
  if (works('nice', ['-n', '19'])) prefix.push('nice', '-n', '19');
  if (!prefix.length) return { execArgv: nodeArgs, wrapped: false };
  const [execPath, ...rest] = prefix;
  return { execPath, execArgv: [...rest, process.execPath, ...nodeArgs], wrapped: true };
}

function spawnWorker() {
  const { execPath, execArgv, wrapped } = lowPriorityForkOptions();
  workerReady = false;
  worker = fork(WORKER_PATH, [], {
    cwd: process.cwd(),
    execArgv,
    ...(execPath ? { execPath } : {}),
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
  if (!wrapped) {
    try { os.setPriority(worker.pid, 19); } catch { /* best effort */ }
  }
  worker.on('message', onWorkerMessage);
  worker.on('error', err => console.log('⚠️ Stats worker error:', err?.message || err));
  worker.on('exit', (code, signal) => {
    console.log(`⚠️ Stats worker exited (code ${code}, signal ${signal}) — respawning`);
    if (current) {
      clearTimeout(current.timer);
      const { key } = current;
      current = null;
      enqueue(key, true);
    }
    worker = null;
    workerReady = false;
    setTimeout(spawnWorker, WORKER_RESPAWN_MS);
  });
  console.log(`📊 Stats worker started (pid ${worker.pid}, low priority${wrapped ? ': ionice/nice' : ''})`);
}

function loadStored() {
  const cutoff = Date.now() - PRUNE_AFTER_MS;
  const db = getDb();
  db.prepare('DELETE FROM stats_cache WHERE last_requested_at < ?').run(cutoff);
  for (const row of db.prepare('SELECT * FROM stats_cache').all()) {
    try {
      entries.set(row.key, {
        kind: row.kind,
        params: JSON.parse(row.params_json),
        json: row.value_json,
        computedAt: row.computed_at,
        lastRequestedAt: row.last_requested_at,
      });
    } catch { /* skip corrupt row */ }
  }
  console.log(`📊 Stats store loaded ${entries.size} stored value(s)`);
}

function persistRequestTimes() {
  try {
    const db = getDb();
    const stmt = db.prepare('UPDATE stats_cache SET last_requested_at = ? WHERE key = ?');
    db.transaction(() => {
      for (const [key, e] of entries) if (e.json != null) stmt.run(e.lastRequestedAt, key);
    })();
  } catch { /* ignore */ }
}

function runCycle() {
  const now = Date.now();
  // Unscoped defaults stay refreshed even when nobody is looking.
  touch('safety-summary', { range: '30d' }, now);
  touch('safety-summary', { range: 'prev30d' }, now);
  touch('hos', {}, now);
  persistRequestTimes();

  const midnight = lastLocalMidnight();
  for (const [key, e] of entries) {
    const idle = now - e.lastRequestedAt;
    if (idle > PRUNE_AFTER_MS) {
      entries.delete(key);
      continue;
    }
    if (idle > ACTIVE_KEY_MS) continue;
    const policy = refreshPolicy(e.kind, e.params);
    if (policy === 'cycle' && now - e.computedAt >= CYCLE_MS - 30_000) enqueue(key);
    else if (policy === 'nightly' && e.computedAt < midnight) enqueue(key);
  }
}

/**
 * Stored value as a JSON string. First request for an unseen key waits for the worker
 * (up to FIRST_VALUE_WAIT_MS, then rejects with code STATS_WARMING).
 */
export async function getServedStat(kind, rawParams = {}) {
  if (!started) startStatsScheduler();
  const { key, entry } = touch(kind, rawParams);
  if (entry.json != null) {
    if (refreshPolicy(kind, entry.params) === 'on-demand' && Date.now() - entry.computedAt >= CYCLE_MS) {
      enqueue(key);
    }
    return entry.json;
  }
  enqueue(key, true);
  return waitFor(key);
}

export function startStatsScheduler() {
  if (started) return;
  started = true;
  ensureTable();
  loadStored();
  spawnWorker();
  runCycle();
  setInterval(runCycle, CYCLE_MS);
}
