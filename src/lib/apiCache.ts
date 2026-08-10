/**
 * Frontend API cache — memory + sessionStorage, TTL, in-flight dedupe.
 * Used by Fleet polls and Utilization & KPIs so remounts / parallel views
 * don't spam the same endpoints.
 */

const PREFIX = 'bpl_api_cache:';

type CacheEntry = { data: unknown; at: number };

const memory = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<unknown>>();

export const CACHE_TTL = {
  fleetData: 8_000,
  fleetMeta: 8_000,
  fleetEvents: 12_000,
  kpi: 5 * 60_000,
  /** Heavy: scans fuel-history for refill + trip fuel. */
  fuelConsumption: 60_000,
  fuelHistory: 45_000,
} as const;

export const CACHE_KEYS = {
  fleetData: 'fleet:data',
  fleetMeta: 'fleet:metadata',
  fleetEvents: 'fleet:events',
  kpi: (url: string) => `kpi:${url}`,
  fuelConsumption: (url: string) => `fuel:consumption:${url}`,
  fuelHistory: (url: string) => `fuel:history:${url}`,
} as const;

function readSession(key: string): CacheEntry | null {
  try {
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

/** Sync read only if still within TTL. */
export function cacheGetFresh<T>(key: string, ttlMs: number): T | null {
  const entry = resolveEntry(key);
  if (!entry) return null;
  if (Date.now() - entry.at > ttlMs) return null;
  return entry.data as T;
}

export function cacheSet(key: string, data: unknown) {
  const entry: CacheEntry = { data, at: Date.now() };
  memory.set(key, entry);
  writeSession(key, entry);
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
