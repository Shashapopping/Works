/**
 * Short-lived in-memory cache for heavy API rollups (per Node process).
 * Complements client TTL cache — speeds cold revisits and parallel page opens.
 * Supports stale-while-revalidate: serve last value while a refresh runs.
 */

const stores = new Map();
const refreshing = new Map();

function storeFor(namespace) {
  if (!stores.has(namespace)) stores.set(namespace, new Map());
  return stores.get(namespace);
}

function refreshKey(namespace, key) {
  return `${namespace}::${key}`;
}

/**
 * @param {string} namespace
 * @param {number} ttlMs
 * @param {string} key
 * @param {() => unknown} compute
 * @param {{ swrMs?: number }} [opts] — serve stale up to ttlMs+swrMs while refreshing (default 60s)
 */
export function memoApiResponse(namespace, ttlMs, key, compute, opts = {}) {
  const store = storeFor(namespace);
  const hit = store.get(key);
  const now = Date.now();
  const swrMs = opts.swrMs ?? 60_000;
  // Fuel series payloads are large — keep fewer sticky copies in RSS.
  const maxEntries = opts.maxEntries
    ?? (namespace === 'fuel-history' ? 8 : 64);

  if (hit && now - hit.at < ttlMs) return hit.value;

  // Stale-while-revalidate: return previous value and refresh in background once.
  if (hit && now - hit.at < ttlMs + swrMs) {
    const rk = refreshKey(namespace, key);
    if (!refreshing.has(rk)) {
      refreshing.set(rk, true);
      setImmediate(() => {
        try {
          const value = compute();
          store.set(key, { at: Date.now(), value });
          if (store.size > maxEntries) {
            const oldest = [...store.entries()].sort((a, b) => a[1].at - b[1].at)[0]?.[0];
            if (oldest != null) store.delete(oldest);
          }
        } catch { /* keep stale */ }
        finally {
          refreshing.delete(rk);
        }
      });
    }
    return hit.value;
  }

  const value = compute();
  store.set(key, { at: now, value });
  if (store.size > maxEntries) {
    const oldest = [...store.entries()].sort((a, b) => a[1].at - b[1].at)[0]?.[0];
    if (oldest != null) store.delete(oldest);
  }
  return value;
}

export function apiCacheKey(parts) {
  return JSON.stringify(parts);
}
