import { useState, useEffect } from 'react';
import { authFetch } from '../context/FleetContext';
import type { TripDriver } from '../context/FleetContext';
import { authCachedJson, cachedFetchJson, cachePeek, CACHE_KEYS, CACHE_TTL } from '../lib/apiCache';
import {
  mergeAssessmentTripDrivers,
  periodDistanceSpec,
  type DriverPeriod,
} from '../lib/driverAssessment';

/** v3: drop MiX Unknown from trips=0 vehicles[] (v2 payload crashed Drivers). */
const ASSESSMENT_TRIPS_CACHE = `${CACHE_KEYS.driverAssessment}:v3`;

async function loadAssessmentTrips(): Promise<TripDriver[] | null> {
  return cachedFetchJson<TripDriver[]>(
    ASSESSMENT_TRIPS_CACHE,
    CACHE_TTL.driverAssessment,
    async () => {
      const [cur, last] = await Promise.all([
        authCachedJson<any>('/api/driver-distance?range=30d&trips=0', authFetch, { ttlMs: CACHE_TTL.driverAssessment }),
        authCachedJson<any>('/api/driver-distance?range=prev30d&trips=0', authFetch, { ttlMs: CACHE_TTL.driverAssessment }),
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
  custom: { from: string; to: string },
  force = false,
): Promise<TripDriver[] | null> {
  const spec = periodDistanceSpec(period, custom);
  return cachedFetchJson<TripDriver[]>(
    `driver:period:v3:${spec.url}`,
    CACHE_TTL.driverAssessment,
    async () => {
      const data = await authCachedJson<any>(spec.url, authFetch, {
        ttlMs: CACHE_TTL.driverAssessment,
      });
      return mergeAssessmentTripDrivers([(Array.isArray(data?.drivers) ? data.drivers : []) as TripDriver[]]);
    },
    { force },
  );
}

export function useAssessmentTripDrivers() {
  const [tripDrivers, setTripDrivers] = useState<TripDriver[]>(
    () => cachePeek<TripDriver[]>(ASSESSMENT_TRIPS_CACHE) ?? [],
  );
  const [loading, setLoading] = useState(() => !cachePeek<TripDriver[]>(ASSESSMENT_TRIPS_CACHE)?.length);

  useEffect(() => {
    let cancelled = false;
    const cached = cachePeek<TripDriver[]>(ASSESSMENT_TRIPS_CACHE);
    if (cached?.length) {
      setTripDrivers(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }
    (async () => {
      try {
        const next = await loadAssessmentTrips();
        if (!cancelled && next) setTripDrivers(next);
      } catch { /* keep prior */ }
      finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return { tripDrivers, loading: loading && tripDrivers.length === 0 };
}

export function usePeriodTripDrivers(period: DriverPeriod, custom?: { from: string; to: string }) {
  const spec = periodDistanceSpec(period, custom);
  const cacheKey = spec.kind === 'assessment' ? ASSESSMENT_TRIPS_CACHE : `driver:period:v3:${spec.url}`;
  const [tripDrivers, setTripDrivers] = useState<TripDriver[]>(
    () => cachePeek<TripDriver[]>(cacheKey) ?? [],
  );
  const [loading, setLoading] = useState(() => !cachePeek<TripDriver[]>(cacheKey));

  useEffect(() => {
    let cancelled = false;
    const nextSpec = periodDistanceSpec(period, custom);
    const key = nextSpec.kind === 'assessment' ? ASSESSMENT_TRIPS_CACHE : `driver:period:v3:${nextSpec.url}`;
    const cached = cachePeek<TripDriver[]>(key);
    if (cached) {
      setTripDrivers(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }
    (async () => {
      try {
        const next = await loadPeriodTrips(period, custom, false);
        if (!cancelled && next) setTripDrivers(next);
      } catch { /* keep prior */ }
      finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [period, custom?.from, custom?.to]);

  return { tripDrivers, loading: loading && tripDrivers.length === 0 };
}
