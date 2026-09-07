import { useCallback, useEffect, useMemo, useState } from 'react';
import { authFetch, type DriverDistanceSummary, type TripAsset } from '../context/FleetContext';
import { authCachedJson, cachePeek, CACHE_TTL } from '../lib/apiCache';
import {
  buildDriverDistanceUrl,
  defaultSegmentCustomRange,
  segmentPeriodLabel,
  type SegmentPeriod,
} from '../lib/segmentPeriod';
import { startJitteredInterval } from '../lib/pollSchedule';

export function useDriverDistancePeriod(
  period: SegmentPeriod,
  customRange?: { from: string; to: string },
) {
  const url = buildDriverDistanceUrl(period, customRange);
  const [data, setData] = useState<DriverDistanceSummary | null>(
    () => cachePeek<DriverDistanceSummary>(url),
  );
  const [loading, setLoading] = useState(() => !cachePeek<DriverDistanceSummary>(url));

  const fetchData = useCallback(async (silent = false) => {
    // Peek-first: never wipe painted data while refetching.
    if (!silent) {
      const cached = cachePeek<DriverDistanceSummary>(url);
      if (cached) {
        setData(cached);
        setLoading(false);
      } else {
        setLoading(true);
      }
    }
    try {
      const next = await authCachedJson<DriverDistanceSummary>(url, authFetch, {
        force: silent,
        ttlMs: CACHE_TTL.pageRollup,
      });
      if (next) setData(next);
    } catch {
      /* keep prior on silent failure */
    } finally {
      if (!silent) setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    void fetchData(false);
    return startJitteredInterval(() => void fetchData(true));
  }, [fetchData]);

  const assets: TripAsset[] = data?.assets ?? [];
  const label = segmentPeriodLabel(period, customRange);

  return {
    data,
    assets,
    /** True only when we have nothing to paint yet. */
    loading: loading && !data,
    label,
    refetch: fetchData,
  };
}

export function useSegmentPeriod(defaultPeriod: SegmentPeriod = 'today') {
  const [period, setPeriod] = useState<SegmentPeriod>(defaultPeriod);
  const [customRange, setCustomRange] = useState(defaultSegmentCustomRange);
  const distance = useDriverDistancePeriod(period, customRange);
  const label = useMemo(
    () => segmentPeriodLabel(period, customRange),
    [period, customRange],
  );

  return {
    period,
    setPeriod,
    customRange,
    setCustomRange,
    ...distance,
    label,
  };
}
