import { useState, useEffect, useCallback } from 'react';
import { authFetch } from '../context/FleetContext';
import { cachedFetchJson, cachePeek, CACHE_KEYS, CACHE_TTL } from '../lib/apiCache';
import { buildHosUrl, type HosResponse } from '../lib/hos';
import { startJitteredInterval } from '../lib/pollSchedule';

export async function fetchHosCached(url: string, opts?: { force?: boolean }): Promise<HosResponse | null> {
  return cachedFetchJson<HosResponse>(
    url,
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
  return cachePeek<HosResponse>(url) ?? cachePeek<HosResponse>(CACHE_KEYS.hos(url));
}

function localDateKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Live continuous-driving-time records (today unless `date` given). Today polls ~30s with jitter; history loads once. */
export function useHosRecords(date?: string, opts?: { enabled?: boolean }) {
  const enabled = opts?.enabled !== false;
  const isLiveDay = !date || date === localDateKey();
  const url = buildHosUrl(date);
  const [data, setData] = useState<HosResponse | null>(() => peekHos(url));
  const [loading, setLoading] = useState(() => enabled && !peekHos(url));

  const fetchData = useCallback(async (silent = false) => {
    // Peek-first: never wipe painted data; skeleton only when nothing to show.
    if (!silent) {
      const cached = peekHos(url);
      if (cached) {
        setData(cached);
        setLoading(false);
      } else {
        setLoading(true);
      }
    }
    try {
      const next = await fetchHosCached(url, { force: silent });
      if (next) setData(next);
    } catch { /* keep prior on silent poll failure */ }
    finally { if (!silent) setLoading(false); }
  }, [url]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    void fetchData(false);
    if (!isLiveDay) return;
    return startJitteredInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void fetchData(true);
    }, 30_000, 5_000);
  }, [enabled, fetchData, isLiveDay]);

  const records = data?.records ?? [];

  return {
    data,
    records,
    lastTripDay: data?.lastTripDay ?? null,
    violationCount: records.filter(r => r.status === 'violation').length,
    warningCount: records.filter(r => r.status === 'warning').length,
    /** True only when we have nothing to paint yet. */
    loading: loading && records.length === 0,
    refetch: fetchData,
  };
}
