import { useState, useEffect } from 'react';
import { authFetch } from '../context/FleetContext';
import type { TripDriver } from '../context/FleetContext';
import { cachedFetchJson, cachePeek, CACHE_KEYS, CACHE_TTL } from '../lib/apiCache';
import {
  mergeAssessmentTripDrivers,
  periodDistanceSpec,
  type DriverPeriod,
} from '../lib/driverAssessment';

async function loadAssessmentTrips(): Promise<TripDriver[] | null> {
  return cachedFetchJson<TripDriver[]>(
    CACHE_KEYS.driverAssessment,
    CACHE_TTL.driverAssessment,
    async () => {
      const [cur, last] = await Promise.all([
        authFetch('/api/driver-distance?range=currentMonth&trips=0'),
        authFetch('/api/driver-distance?range=lastMonth&trips=0'),
      ]);
      const batches: TripDriver[][] = [];
      for (const res of [cur, last]) {
        if (!res.ok) continue;
        const data = await res.json();
        batches.push((data.drivers || []) as TripDriver[]);
      }
      return mergeAssessmentTripDrivers(batches);
    },
  );
}

async function loadPeriodTrips(period: DriverPeriod, custom: { from: string; to: string }): Promise<TripDriver[] | null> {
  const spec = periodDistanceSpec(period, custom);
  if (spec.kind === 'assessment') return loadAssessmentTrips();
  return cachedFetchJson<TripDriver[]>(
    `driver:period:${spec.url}`,
    CACHE_TTL.driverAssessment,
    async () => {
      const res = await authFetch(spec.url);
      if (!res.ok) return [];
      const data = await res.json();
      return mergeAssessmentTripDrivers([(data.drivers || []) as TripDriver[]]);
    },
  );
}

export function useAssessmentTripDrivers() {
  const [tripDrivers, setTripDrivers] = useState<TripDriver[]>(
    () => cachePeek<TripDriver[]>(CACHE_KEYS.driverAssessment) ?? [],
  );
  const [loading, setLoading] = useState(() => !cachePeek<TripDriver[]>(CACHE_KEYS.driverAssessment)?.length);

  useEffect(() => {
    let cancelled = false;
    setLoading(prev => prev || tripDrivers.length === 0);
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

  return { tripDrivers, loading };
}

export function usePeriodTripDrivers(period: DriverPeriod, custom: { from: string; to: string }) {
  const spec = periodDistanceSpec(period, custom);
  const cacheKey = spec.kind === 'assessment' ? CACHE_KEYS.driverAssessment : `driver:period:${spec.url}`;
  const [tripDrivers, setTripDrivers] = useState<TripDriver[]>(
    () => cachePeek<TripDriver[]>(cacheKey) ?? [],
  );
  const [loading, setLoading] = useState(() => !cachePeek<TripDriver[]>(cacheKey)?.length);

  useEffect(() => {
    let cancelled = false;
    const nextSpec = periodDistanceSpec(period, custom);
    const key = nextSpec.kind === 'assessment' ? CACHE_KEYS.driverAssessment : `driver:period:${nextSpec.url}`;
    const cached = cachePeek<TripDriver[]>(key);
    if (cached?.length) {
      setTripDrivers(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }
    (async () => {
      try {
        const next = await loadPeriodTrips(period, custom);
        if (!cancelled && next) setTripDrivers(next);
      } catch { /* keep prior */ }
      finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [period, custom.from, custom.to]);

  return { tripDrivers, loading };
}
