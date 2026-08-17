import { useState, useEffect, useCallback } from 'react';
import { authFetch } from '../context/FleetContext';
import { cachedFetchJson, cachePeek, CACHE_KEYS, CACHE_TTL } from '../lib/apiCache';
import { buildHosUrl, type HosResponse } from '../lib/hos';

export async function fetchHosCached(url: string, opts?: { force?: boolean }): Promise<HosResponse | null> {
  return cachedFetchJson<HosResponse>(
    CACHE_KEYS.hos(url),
    CACHE_TTL.hos,
    async () => {
      const res = await authFetch(url);
      if (!res.ok) return null;
      return res.json() as Promise<HosResponse>;
    },
    opts,
  );
}

export function peekHos(url: string): HosResponse | null {
  return cachePeek<HosResponse>(CACHE_KEYS.hos(url));
}

/** Live continuous-driving-time records (today unless `date` given). Polls every 30s. */
export function useHosRecords(date?: string) {
  const url = buildHosUrl(date);
  const [data, setData] = useState<HosResponse | null>(() => peekHos(url));
  const [loading, setLoading] = useState(() => !peekHos(url));

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true);
      const cached = peekHos(url);
      if (cached) setData(cached);
      else setData(null);
    }
    try {
      const next = await fetchHosCached(url, { force: silent });
      if (next) setData(next);
    } catch { /* keep prior on silent poll failure */ }
    finally { if (!silent) setLoading(false); }
  }, [url]);

  useEffect(() => {
    void fetchData(false);
    const id = setInterval(() => void fetchData(true), 30_000);
    return () => clearInterval(id);
  }, [fetchData]);

  const records = data?.records ?? [];

  return {
    data,
    records,
    lastTripDay: data?.lastTripDay ?? null,
    violationCount: records.filter(r => r.status === 'violation').length,
    warningCount: records.filter(r => r.status === 'warning').length,
    loading,
    refetch: fetchData,
  };
}
