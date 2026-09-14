import { useState, useEffect, useCallback, useMemo } from 'react';
import { authFetch } from '../context/FleetContext';
import { cachedFetchJson, cachePeek, CACHE_KEYS, CACHE_TTL } from '../lib/apiCache';
import { startJitteredInterval } from '../lib/pollSchedule';
import { appendUrlScope, normalizeScopeKeys } from '../lib/siteScope';
import {
  type PeriodMode,
  type ConsumptionData,
  type DistanceFuelRange,
  buildConsumptionUrl,
  deriveFromConsumptionData,
  distanceRangeToConsumptionRequest,
} from '../lib/fuelConsumption';

export type FuelPeriod = PeriodMode;

/** Shared cached load for refill / trip-fuel payloads. */
export async function fetchFuelConsumptionCached(
  url: string,
  opts?: { force?: boolean },
): Promise<ConsumptionData | null> {
  return cachedFetchJson<ConsumptionData>(
    url,
    CACHE_TTL.fuelConsumption,
    async () => {
      const res = await authFetch(url);
      if (!res.ok) return null;
      return res.json() as Promise<ConsumptionData>;
    },
    opts,
  );
}

export function peekFuelConsumption(url: string): ConsumptionData | null {
  return cachePeek<ConsumptionData>(url)
    ?? cachePeek<ConsumptionData>(CACHE_KEYS.fuelConsumption(url));
}

export async function fetchFuelHistoryCached<T = unknown>(
  url: string,
  opts?: { force?: boolean },
): Promise<T | null> {
  return cachedFetchJson<T>(
    CACHE_KEYS.fuelHistory(url),
    CACHE_TTL.fuelHistory,
    async () => {
      const res = await authFetch(url);
      if (!res.ok) return null;
      return res.json() as Promise<T>;
    },
    opts,
  );
}

export function peekFuelHistory<T = unknown>(url: string): T | null {
  return cachePeek<T>(CACHE_KEYS.fuelHistory(url));
}

export function useFuelConsumption(
  period: PeriodMode,
  customRange?: { from: string; to: string },
  site: string | 'ALL' = 'ALL',
  assetIds: string[] = [],
  enabled = true,
  siteScope: string[] = [],
) {
  const base = buildConsumptionUrl(period, site, customRange?.from, customRange?.to);
  const url = appendUrlScope(base, {
    siteScope: normalizeScopeKeys(siteScope),
    assetIds: normalizeScopeKeys(assetIds),
  });
  const [data, setData] = useState<ConsumptionData | null>(() => enabled ? peekFuelConsumption(url) : null);
  const [loading, setLoading] = useState(() => enabled && !peekFuelConsumption(url));

  const fetchData = useCallback(async (silent = false) => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    if (!silent) {
      const cached = peekFuelConsumption(url);
      if (cached) {
        setData(cached);
        setLoading(false);
      } else {
        setLoading(true);
      }
    }

    try {
      const next = await fetchFuelConsumptionCached(url, { force: silent });
      if (next) setData(next);
    } catch {
      /* keep prior only on silent poll failure */
    } finally {
      if (!silent) setLoading(false);
    }
  }, [url, enabled]);

  useEffect(() => {
    if (!enabled) {
      setData(null);
      setLoading(false);
      return;
    }
    // Never paint another scope's payload for this URL.
    const cached = peekFuelConsumption(url);
    setData(cached);
    setLoading(!cached);
    void fetchData(false);
    const stop = startJitteredInterval(() => void fetchData(true));
    return stop;
  }, [fetchData, enabled, url]);

  const derived = useMemo(
    () => (data ? deriveFromConsumptionData(data, period) : null),
    [data, period],
  );

  return {
    data,
    chartData: derived?.chartData ?? [],
    summary: derived?.summary ?? { fuel: 0, distance: 0, drivingHours: 0, trips: 0, refuels: 0, litersPerKm: null, litersPerHour: null },
    totalLiters: Math.round(derived?.summary.fuel ?? 0),
    totalDistanceKm: Math.round(derived?.summary.distance ?? 0),
    fuelSeries: derived?.fuelSeries ?? [],
    loading: enabled && loading && !data,
    refetch: fetchData,
  };
}

/** Dashboard metric row — maps day/week/month/custom to consumption API periods. */
export function useFuelConsumptionByDistanceRange(
  range: DistanceFuelRange,
  custom?: { from: string; to: string },
  assetIds: string[] = [],
  enabled = true,
  siteScope: string[] = [],
) {
  const { period, customFrom, customTo } = distanceRangeToConsumptionRequest(range, custom);
  const customRange = period === 'custom' && customFrom && customTo
    ? { from: customFrom, to: customTo }
    : undefined;
  const base = buildConsumptionUrl(period, 'ALL', customRange?.from, customRange?.to);
  const url = appendUrlScope(
    `${base}${base.includes('?') ? '&' : '?'}summary=1`,
    {
      siteScope: normalizeScopeKeys(siteScope),
      assetIds: normalizeScopeKeys(assetIds),
    },
  );
  const [data, setData] = useState<ConsumptionData | null>(() => enabled ? peekFuelConsumption(url) : null);
  const [loading, setLoading] = useState(() => enabled && !peekFuelConsumption(url));

  const fetchData = useCallback(async (silent = false) => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    if (!silent) {
      const cached = peekFuelConsumption(url);
      if (cached) {
        setData(cached);
        setLoading(false);
      } else {
        setLoading(true);
      }
    }
    try {
      const next = await fetchFuelConsumptionCached(url, { force: silent });
      if (next) setData(next);
    } catch {
      /* keep prior */
    } finally {
      if (!silent) setLoading(false);
    }
  }, [url, enabled]);

  useEffect(() => {
    if (!enabled) {
      setData(null);
      setLoading(false);
      return;
    }
    const cached = peekFuelConsumption(url);
    setData(cached);
    setLoading(!cached);
    void fetchData(false);
    const stop = startJitteredInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void fetchData(true);
    });
    return stop;
  }, [fetchData, enabled, url]);

  const derived = useMemo(
    () => (data ? deriveFromConsumptionData(data, period) : null),
    [data, period],
  );

  return {
    data,
    chartData: derived?.chartData ?? [],
    summary: derived?.summary ?? { fuel: 0, distance: 0, drivingHours: 0, trips: 0, refuels: 0, litersPerKm: null, litersPerHour: null },
    totalLiters: Math.round(derived?.summary.fuel ?? 0),
    totalDistanceKm: Math.round(derived?.summary.distance ?? 0),
    fuelSeries: derived?.fuelSeries ?? [],
    loading: enabled && loading && !data,
    refetch: fetchData,
  };
}
