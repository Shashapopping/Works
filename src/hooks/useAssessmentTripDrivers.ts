import { useState, useEffect } from 'react';
import { authFetch } from '../context/FleetContext';
import type { TripDriver } from '../context/FleetContext';
import { authCachedJson, cachedFetchJson, cachePeek, CACHE_KEYS, CACHE_TTL } from '../lib/apiCache';
import {
  mergeAssessmentTripDrivers,
  periodDistanceSpec,
  type DriverPeriod,
} from '../lib/driverAssessment';
import { appendUrlScope, normalizeScopeKeys } from '../lib/siteScope';

function scopedQuery(assetIds: string[] = [], siteScope: string[] = []) {
  return appendUrlScope('', {
    siteScope: normalizeScopeKeys(siteScope),
    assetIds: normalizeScopeKeys(assetIds),
  }).replace(/^\?/, '&');
}

/** Mirror appendUrlScope: assetIds first so cache keys match request URLs. */
function scopedCacheSuffix(assetIds: string[] = [], siteScope: string[] = []) {
  const scoped = normalizeScopeKeys(assetIds);
  if (scoped.length) return ':assets:' + scoped.join(',');
  const sites = normalizeScopeKeys(siteScope);
  return sites.length ? ':sites:' + sites.join(',') : '';
}

/** v4: trip drivers carry roster siteId for HOS-style site scoping. */
const ASSESSMENT_TRIPS_CACHE = `${CACHE_KEYS.driverAssessment}:v4`;

async function loadAssessmentTrips(assetIds: string[] = [], siteScope: string[] = []): Promise<TripDriver[] | null> {
  return cachedFetchJson<TripDriver[]>(
    ASSESSMENT_TRIPS_CACHE + scopedCacheSuffix(assetIds, siteScope),
    CACHE_TTL.driverAssessment,
    async () => {
      const q = scopedQuery(assetIds, siteScope);
      const [cur, last] = await Promise.all([
        authCachedJson<any>('/api/driver-distance?range=30d&trips=0' + q, authFetch, { ttlMs: CACHE_TTL.driverAssessment }),
        authCachedJson<any>('/api/driver-distance?range=prev30d&trips=0' + q, authFetch, { ttlMs: CACHE_TTL.driverAssessment }),
      ]);
      const batches: TripDriver[][] = [];
      for (const data of [cur, last]) {
        if (!data) continue;
        batches.push((Array.isArray(data.drivers) ? data.drivers : []) as TripDriver[]);
      }
      return mergeAssessmentTripDrivers(batches);
    },
  );
}

async function loadPeriodTrips(
  period: DriverPeriod,
  custom: { from: string; to: string } | undefined,
  force = false,
  assetIds: string[] = [],
  siteScope: string[] = [],
): Promise<TripDriver[] | null> {
  const spec = periodDistanceSpec(period, custom);
  return cachedFetchJson<TripDriver[]>(
    `driver:period:v4:${spec.url}${scopedCacheSuffix(assetIds, siteScope)}`,
    CACHE_TTL.driverAssessment,
    async () => {
      const scopedUrl = appendUrlScope(spec.url, {
        siteScope: normalizeScopeKeys(siteScope),
        assetIds: normalizeScopeKeys(assetIds),
      });
      const data = await authCachedJson<any>(scopedUrl, authFetch, {
        ttlMs: CACHE_TTL.driverAssessment,
      });
      return mergeAssessmentTripDrivers([(Array.isArray(data?.drivers) ? data.drivers : []) as TripDriver[]]);
    },
    { force },
  );
}

export function useAssessmentTripDrivers(
  assetIds: string[] = [],
  enabled = true,
  siteScope: string[] = [],
) {
  const cacheKey = ASSESSMENT_TRIPS_CACHE + scopedCacheSuffix(assetIds, siteScope);
  const [tripDrivers, setTripDrivers] = useState<TripDriver[]>(
    () => (enabled ? cachePeek<TripDriver[]>(cacheKey) : null) ?? [],
  );
  const [loading, setLoading] = useState(() => enabled && !cachePeek<TripDriver[]>(cacheKey)?.length);

  useEffect(() => {
    if (!enabled) {
      setTripDrivers([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const key = ASSESSMENT_TRIPS_CACHE + scopedCacheSuffix(assetIds, siteScope);
    const cached = cachePeek<TripDriver[]>(key);
    setTripDrivers(cached ?? []);
    setLoading(!cached);
    (async () => {
      try {
        const next = await loadAssessmentTrips(assetIds, siteScope);
        if (!cancelled && next) setTripDrivers(next);
      } catch { /* keep prior for this scope only */ }
      finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [assetIds.join(','), siteScope.join(','), enabled]);

  return { tripDrivers, loading: enabled && loading };
}

export function usePeriodTripDrivers(
  period: DriverPeriod,
  custom?: { from: string; to: string },
  assetIds: string[] = [],
  enabled = true,
  siteScope: string[] = [],
) {
  const spec = periodDistanceSpec(period, custom);
  const cacheKey = spec.kind === 'assessment'
    ? ASSESSMENT_TRIPS_CACHE + scopedCacheSuffix(assetIds, siteScope)
    : `driver:period:v4:${spec.url}${scopedCacheSuffix(assetIds, siteScope)}`;
  const [tripDrivers, setTripDrivers] = useState<TripDriver[]>(
    () => (enabled ? cachePeek<TripDriver[]>(cacheKey) : null) ?? [],
  );
  const [loading, setLoading] = useState(() => enabled && !cachePeek<TripDriver[]>(cacheKey));

  useEffect(() => {
    if (!enabled) {
      setTripDrivers([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const nextSpec = periodDistanceSpec(period, custom);
    const key = nextSpec.kind === 'assessment'
      ? ASSESSMENT_TRIPS_CACHE + scopedCacheSuffix(assetIds, siteScope)
      : `driver:period:v4:${nextSpec.url}${scopedCacheSuffix(assetIds, siteScope)}`;
    const cached = cachePeek<TripDriver[]>(key);
    setTripDrivers(cached ?? []);
    setLoading(!cached);
    (async () => {
      try {
        const next = await loadPeriodTrips(period, custom, false, assetIds, siteScope);
        if (!cancelled && next) setTripDrivers(next);
      } catch { /* keep prior for this scope only */ }
      finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [period, custom?.from, custom?.to, assetIds.join(','), siteScope.join(','), enabled]);

  return { tripDrivers, loading: enabled && loading };
}
