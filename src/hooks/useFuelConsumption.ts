import { useState, useEffect, useCallback, useMemo } from 'react';
import { authFetch } from '../context/FleetContext';
import { cachedFetchJson, cachePeek, CACHE_KEYS, CACHE_TTL } from '../lib/apiCache';
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
    CACHE_KEYS.fuelConsumption(url),
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
  return cachePeek<ConsumptionData>(CACHE_KEYS.fuelConsumption(url));
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
) {
  const url = buildConsumptionUrl(period, site, customRange?.from, customRange?.to);
  const [data, setData] = useState<ConsumptionData | null>(() => peekFuelConsumption(url));
  const [loading, setLoading] = useState(() => !peekFuelConsumption(url));

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) {
      // Always busy on key change so UI never shows prior-period numbers.
      setLoading(true);
      const cached = peekFuelConsumption(url);
      if (cached) setData(cached);
      else setData(null);
    }

    try {
      const next = await fetchFuelConsumptionCached(url, { force: silent });
      if (next) setData(next);
    } catch {
      /* keep prior only on silent poll failure */
    } finally {
      if (!silent) setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    void fetchData(false);
    const id = setInterval(() => void fetchData(true), 60_000);
    return () => clearInterval(id);
  }, [fetchData]);

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
    loading,
    refetch: fetchData,
  };
}

/** Dashboard metric row — maps 24h / this month / last month to consumption API periods. */
export function useFuelConsumptionByDistanceRange(range: DistanceFuelRange) {
  const { period, customFrom, customTo } = distanceRangeToConsumptionRequest(range);
  const customRange = period === 'custom' && customFrom && customTo
    ? { from: customFrom, to: customTo }
    : undefined;
  return useFuelConsumption(period, customRange);
}
