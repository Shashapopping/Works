import { useCallback, useEffect, useMemo, useState } from 'react';
import { authFetch, type DriverDistanceSummary, type TripAsset } from '../context/FleetContext';
import { authCachedJson, cachePeek, CACHE_TTL } from '../lib/apiCache';
import {
  buildDriverDistanceUrl,
  defaultSegmentCustomRange,
  segmentPeriodLabel,
  type SegmentPeriod,
} from '../lib/segmentPeriod';
import { appendUrlScope, normalizeScopeKeys } from '../lib/siteScope';
import { startJitteredInterval } from '../lib/pollSchedule';

export type DistanceScopeOptions = {
  siteScope?: string[];
  assetIds?: string[];
  /** When false, skip fetch (e.g. waiting for scoped vehicle list). */
  enabled?: boolean;
};

export function useDriverDistancePeriod(
  period: SegmentPeriod,
  customRange?: { from: string; to: string },
  scope: DistanceScopeOptions = {},
) {
  const siteScope = normalizeScopeKeys(scope.siteScope);
  const assetIds = normalizeScopeKeys(scope.assetIds);
  const enabled = scope.enabled !== false;
  const baseUrl = buildDriverDistanceUrl(period, customRange);
  const url = appendUrlScope(baseUrl, { siteScope, assetIds });
  const [data, setData] = useState<DriverDistanceSummary | null>(
    () => (enabled ? cachePeek<DriverDistanceSummary>(url) : null),
  );
  const [loading, setLoading] = useState(() => enabled && !cachePeek<DriverDistanceSummary>(url));

  const fetchData = useCallback(async (silent = false) => {
    if (!enabled) {
      setLoading(false);
      return;
    }
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
  }, [url, enabled]);

  useEffect(() => {
    if (!enabled) {
      setData(null);
      setLoading(false);
      return;
    }
    const cached = cachePeek<DriverDistanceSummary>(url);
    setData(cached);
    setLoading(!cached);
    void fetchData(false);
    return startJitteredInterval(() => void fetchData(true));
  }, [fetchData, enabled, url]);

  const assets: TripAsset[] = data?.assets ?? [];
  const label = segmentPeriodLabel(period, customRange);

  return {
    data,
    assets,
    loading: enabled && loading && !data,
    label,
    refetch: fetchData,
  };
}

export function useSegmentPeriod(
  defaultPeriod: SegmentPeriod = 'today',
  scope: DistanceScopeOptions = {},
) {
  const [period, setPeriod] = useState<SegmentPeriod>(defaultPeriod);
  const [customRange, setCustomRange] = useState(defaultSegmentCustomRange);
  const distance = useDriverDistancePeriod(period, customRange, scope);
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
