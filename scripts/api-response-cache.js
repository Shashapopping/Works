/**
 * Short-lived in-memory cache for heavy API rollups (per Node process).
 * Complements client TTL cache — speeds cold revisits and parallel page opens.
 */

const stores = new Map();

function storeFor(namespace) {
  if (!stores.has(namespace)) stores.set(namespace, new Map());
  return stores.get(namespace);
}

/**
 * @param {string} namespace
 * @param {number} ttlMs
 * @param {string} key
 * @param {() => unknown} compute
 */
export function memoApiResponse(namespace, ttlMs, key, compute) {
  const store = storeFor(namespace);
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = compute();
  store.set(key, { at: Date.now(), value });
  if (store.size > 48) {
    const oldest = [...store.entries()].sort((a, b) => a[1].at - b[1].at)[0]?.[0];
    if (oldest != null) store.delete(oldest);
  }
  return value;
}

export function apiCacheKey(parts) {
  return JSON.stringify(parts);
}
