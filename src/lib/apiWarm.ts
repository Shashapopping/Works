/**
 * Start API warm as soon as we have a session — before FleetContext boot timers.
 * Deduped so login + FleetProvider don't double-fetch.
 *
 * Home warm never includes /api/hos or /api/risk/drivers — those block Node
 * and stall distance/fuel/driver cards.
 */
import { authFetchInit } from './authApi';
import { ROUTE_WARM_URLS } from '../config/nav';
import {
  authCachedJson,
  BOOT_PREFETCH_URLS,
  cacheSet,
  CACHE_KEYS,
  warmApiUrlsSequentially,
} from './apiCache';
import { buildHomeAlertsUrl } from './homeWidgetData';
import { prefetchRouteChunk } from './routePrefetch';

const API_SECRET = import.meta.env.VITE_API_SECRET as string | undefined;

function warmAuthFetch(url: string, options: RequestInit = {}) {
  const init = authFetchInit(options);
  const headers = new Headers(init.headers);
  if (API_SECRET) headers.set('x-api-secret', API_SECRET);
  return fetch(url, { ...init, headers });
}

let homeWarmStarted = false;
let bootPrefetchStarted = false;
const warmedRoutes = new Set<string>();

/** Cheap Home APIs only — map, counts, distance, fuel, 12 incident alerts. */
export function getHomeWarmUrls(): string[] {
  return [
    '/api/metadata',
    '/api/data',
    '/api/driver-distance?range=7d&trips=0&summary=1',
    '/api/fuel/consumption?period=week&trips=0&summary=1',
    buildHomeAlertsUrl(),
  ];
}

async function warmHomeUrl(url: string) {
  const data = await authCachedJson(url, warmAuthFetch).catch(() => null);
  if (data == null) return null;
  if (url === '/api/data') cacheSet(CACHE_KEYS.fleetData, data);
  if (url === '/api/metadata') cacheSet(CACHE_KEYS.fleetMeta, data);
  return data;
}

/** Warm Home so the dashboard paints from cache after login. */
export function warmHomeApisOnce() {
  if (homeWarmStarted) return;
  homeWarmStarted = true;
  void (async () => {
    const results = [];
    for (const url of getHomeWarmUrls()) {
      results.push(await warmHomeUrl(url));
    }
    if (results.every(row => row == null)) homeWarmStarted = false;
  })().catch(() => {
    homeWarmStarted = false;
  });
}

/** @deprecated Use warmHomeApisOnce — must not warm HOS/risk at login. */
export function warmPriorityApisOnce() {
  warmHomeApisOnce();
}

/** Sidebar hover: sequential page APIs so the next click is already cached. */
export function warmRouteOnHover(path: string) {
  prefetchRouteChunk(path);
  if (warmedRoutes.has(path)) return;
  const urls = ROUTE_WARM_URLS[path];
  if (!urls?.length) {
    warmedRoutes.add(path);
    return;
  }
  warmedRoutes.add(path);
  void warmApiUrlsSequentially(urls, warmAuthFetch, 80).catch(() => {
    warmedRoutes.delete(path);
  });
}

/** Full boot list — optional, after Home has painted. Not started from login. */
export function warmBootPrefetchOnce() {
  if (bootPrefetchStarted) return;
  bootPrefetchStarted = true;
  void warmApiUrlsSequentially(BOOT_PREFETCH_URLS, warmAuthFetch, 80).catch(() => {
    bootPrefetchStarted = false;
  });
}

export function resetApiWarmState() {
  homeWarmStarted = false;
  bootPrefetchStarted = false;
  warmedRoutes.clear();
}
