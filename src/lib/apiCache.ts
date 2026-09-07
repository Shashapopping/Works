/**
 * Frontend API cache — memory + sessionStorage, TTL, in-flight dedupe.
 * Used by Fleet polls and Utilization & KPIs so remounts / parallel views
 * don't spam the same endpoints.
 *
 * Also exposes URL-keyed helpers (Chevron-style) for page rollups.
 */

const PREFIX = 'bpl_api_cache:';

type CacheEntry = { data: unknown; at: number };

const memory = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<unknown>>();
const MAX_ENTRIES = 80;

// These payloads can contain thousands of rows. sessionStorage is synchronous,
// so serialising/parsing them during navigation stalls the browser main thread.
const MEMORY_ONLY_PREFIXES = [
  'fleet:data',
  'fleet:live',
  'fleet:events',
  '/api/driver-distance',
  '/api/risk/drivers',
  '/api/events/log',
  '/api/events/trends',
  '/api/safety/summary',
  '/api/kpi',
  'driver:period:',
  'driver:assessment-distance',
  'hos:',
  'fuel:consumption:',
  'fuel:history:',
];

function isMemoryOnlyKey(key: string) {
  return MEMORY_ONLY_PREFIXES.some(prefix => key.startsWith(prefix));
}

export const CACHE_TTL = {
  fleetData: 20_000,
  fleetMeta: 20_000,
  fleetEvents: 60_000,
  kpi: 5 * 60_000,
  /** Heavy: scans fuel-history for refill + trip fuel. */
  fuelConsumption: 5 * 60_000,
  fuelHistory: 5 * 60_000,
  /** Live continuous-driving clock — keep fairly fresh. */
  hos: 20_000,
  safetyExposure: 2 * 60_000,
  safetySummary: 2 * 60_000,
  riskDrivers: 2 * 60_000,
  /** Page rollups — align with ~60s jittered polls. */
  pageRollup: 5 * 60_000,
  /** Current + last month trip km for driver consequence scores. */
  driverAssessment: 5 * 60_000,
  /** Admin lists (roles, users, documents tree). */
  admin: 60_000,
} as const;

export const CACHE_KEYS = {
  fleetData: 'fleet:data',
  fleetLive: 'fleet:live',
  fleetMeta: 'fleet:metadata',
  /** Boot feed only (capped). Bump suffix when boot limit/shape changes. */
  fleetEvents: 'fleet:events:boot-v4',
  kpi: (url: string) => `kpi:${url}`,
  fuelConsumption: (url: string) => `fuel:consumption:${url}`,
  fuelHistory: (url: string) => `fuel:history:${url}`,
  hos: (url: string) => `hos:${url}`,
  safetyExposure: (range: string) => `safety-exposure:${range}`,
  /** @deprecated Prefer safetySummaryUrl — URL is the canonical cache key. */
  safetySummary: (range: string) => `safety-summary:${range}`,
  riskDrivers: (range: string) => `risk-drivers:${range}`,
  driverAssessment: 'driver:assessment-distance',
} as const;

/** Canonical cache key for /api/safety/summary (matches nav warm + authCachedJson). */
export function safetySummaryUrl(range: string): string {
  if (range.startsWith('/api/safety/summary')) return range;
  return `/api/safety/summary?range=${encodeURIComponent(range)}`;
}

export function peekSafetySummary<T>(range: string): T | null {
  const url = safetySummaryUrl(range);
  return cachePeek<T>(url) ?? cachePeek<T>(CACHE_KEYS.safetySummary(range));
}

/** Read cache whether warmed by URL or legacy prefixed key. */
export function peekUrlOrLegacy<T>(url: string, legacyKey: string): T | null {
  return cachePeek<T>(url) ?? cachePeek<T>(legacyKey);
}

function trimMemory() {
  if (memory.size <= MAX_ENTRIES) return;
  const sorted = [...memory.entries()].sort((a, b) => a[1].at - b[1].at);
  for (const [k] of sorted.slice(0, memory.size - MAX_ENTRIES)) memory.delete(k);
}

function readSession(key: string): CacheEntry | null {
  try {
    if (isMemoryOnlyKey(key)) {
      sessionStorage.removeItem(PREFIX + key);
      return null;
    }
    const raw = sessionStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry;
    if (!parsed || typeof parsed.at !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeSession(key: string, entry: CacheEntry) {
  try {
    if (isMemoryOnlyKey(key)) {
      sessionStorage.removeItem(PREFIX + key);
      return;
    }
    sessionStorage.setItem(PREFIX + key, JSON.stringify(entry));
  } catch {
    /* quota / private mode — memory still works */
  }
}

function resolveEntry(key: string): CacheEntry | null {
  const mem = memory.get(key);
  if (mem) return mem;
  const sess = readSession(key);
  if (sess) {
    memory.set(key, sess);
    return sess;
  }
  return null;
}

/** Sync read — ignores age (for instant hydrate). */
export function cachePeek<T>(key: string): T | null {
  const entry = resolveEntry(key);
  return entry ? (entry.data as T) : null;
}

/** Alias used by Chevron-style page loaders. */
export function peekQueryCache<T>(key: string): T | undefined {
  const v = cachePeek<T>(key);
  return v === null ? undefined : v;
}

/** Sync read only if still within TTL. */
export function cacheGetFresh<T>(key: string, ttlMs: number): T | null {
  const entry = resolveEntry(key);
  if (!entry) return null;
  if (Date.now() - entry.at > ttlMs) return null;
  return entry.data as T;
}

export function isQueryCacheFresh(key: string, ttlMs: number): boolean {
  return cacheGetFresh(key, ttlMs) != null;
}

export function cacheSet(key: string, data: unknown) {
  const entry: CacheEntry = { data, at: Date.now() };
  memory.set(key, entry);
  writeSession(key, entry);
  trimMemory();
}

export function setQueryCache(key: string, data: unknown) {
  cacheSet(key, data);
}

export function cacheInvalidate(key: string) {
  memory.delete(key);
  inflight.delete(key);
  try {
    sessionStorage.removeItem(PREFIX + key);
  } catch { /* ignore */ }
}

/**
 * Return fresh cache if available; otherwise run fetcher (deduped).
 * On failure, fall back to any stale cached value.
 */
export async function cachedFetchJson<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T | null>,
  opts?: { force?: boolean },
): Promise<T | null> {
  if (!opts?.force) {
    const fresh = cacheGetFresh<T>(key, ttlMs);
    if (fresh != null) return fresh;
  }

  const existing = inflight.get(key);
  if (existing) return existing as Promise<T | null>;

  const promise = (async () => {
    try {
      const data = await fetcher();
      if (data != null) cacheSet(key, data);
      return data;
    } catch {
      return cachePeek<T>(key);
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
  return promise;
}

/** Fetch JSON via authFetch; URL is the cache key. Dedupes in-flight same URL. */
export async function authCachedJson<T>(
  url: string,
  authFetch: (url: string, options?: RequestInit) => Promise<Response>,
  opts?: { force?: boolean; ttlMs?: number },
): Promise<T | null> {
  const ttlMs = opts?.ttlMs ?? CACHE_TTL.pageRollup;
  return cachedFetchJson<T>(
    url,
    ttlMs,
    async () => {
      const res = await authFetch(url);
      if (!res.ok) {
        const stale = cachePeek<T>(url);
        if (stale !== null) return stale;
        throw new Error(`HTTP ${res.status}`);
      }
      return (await res.json()) as T;
    },
    { force: opts?.force },
  );
}

/** Warm first so Assets / Drivers / Fatigue rarely show a skeleton. */
export const BOOT_PRIORITY_URLS = [
  '/api/risk/drivers?range=7d&groupBy=asset',
  '/api/risk/drivers?range=7d',
  '/api/hos',
  '/api/safety/summary?range=30d',
  '/api/driver-distance?range=7d&trips=0&summary=1',
] as const;

/** Warm shortly after login so common pages open from cache (Chevron-style). */
export const BOOT_PREFETCH_URLS = [
  ...BOOT_PRIORITY_URLS,
  '/api/driver-distance?range=30d&trips=0&summary=1',
  '/api/driver-distance?range=prev30d&trips=0&summary=1',
  '/api/driver-distance?range=today&trips=0&summary=1',
  '/api/fuel/consumption?period=week&trips=0&summary=1',
  '/api/kpi?period=week&scope=all&summary=1',
  '/api/safety/summary?range=prev30d',
  '/api/risk/drivers?range=30d',
] as const;

/** Warm heavy endpoints one at a time so opening a menu never creates a request burst. */
export async function warmApiUrlsSequentially(
  urls: readonly string[],
  authFetch: (url: string, options?: RequestInit) => Promise<Response>,
  pauseMs = 120,
) {
  for (const url of urls) {
    await authCachedJson(url, authFetch).catch(() => null);
    if (pauseMs > 0) await new Promise(resolve => window.setTimeout(resolve, pauseMs));
  }
}
