/**
 * Start API warm as soon as we have a session — before FleetContext boot timers.
 * Deduped so login + FleetProvider don't double-fetch.
 */
import { authFetchInit } from './authApi';
import {
  BOOT_PREFETCH_URLS,
  BOOT_PRIORITY_URLS,
  warmApiUrlsSequentially,
} from './apiCache';

const API_SECRET = import.meta.env.VITE_API_SECRET as string | undefined;

function warmAuthFetch(url: string, options: RequestInit = {}) {
  const init = authFetchInit(options);
  const headers = new Headers(init.headers);
  if (API_SECRET) headers.set('x-api-secret', API_SECRET);
  return fetch(url, { ...init, headers });
}

let priorityWarmStarted = false;
let bootPrefetchStarted = false;

/** Warm Assets / Drivers / HOS / Safety URLs immediately after auth. */
export function warmPriorityApisOnce() {
  if (priorityWarmStarted) return;
  priorityWarmStarted = true;
  void warmApiUrlsSequentially(BOOT_PRIORITY_URLS, warmAuthFetch, 50).catch(() => {
    priorityWarmStarted = false;
  });
}

/** Full boot list — runs once, after priority warm has had a head start. */
export function warmBootPrefetchOnce() {
  if (bootPrefetchStarted) return;
  bootPrefetchStarted = true;
  void warmApiUrlsSequentially(BOOT_PREFETCH_URLS, warmAuthFetch, 80).catch(() => {
    bootPrefetchStarted = false;
  });
}

export function resetApiWarmState() {
  priorityWarmStarted = false;
  bootPrefetchStarted = false;
}
