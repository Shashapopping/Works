/**
 * Shared fuel probe signal processing — deadband, bucketing, refuel detection.
 * Chart, KPIs, and backend consumption must all use this same pipeline.
 */

/** Probe noise band for quarry tanks (JMG uses 3 L for haulage). */
export const FUEL_NOISE_DEADBAND_L = 5;
/** Minimum confirmed refill on quarry tanks. */
export const REFUEL_MIN_LITERS = 20;
/** Probe at or below this is treated as ignition off. */
export const IGNITION_OFF_LEVEL_L = 5;
/** Brief dip that returns to the prior level is a dropout, not consumption. */
export const DROPOUT_RECOVER_MS = 30 * 60 * 1000;
/** Minimum drop depth to raise an investigate spark — filters road/probe shake. */
export const INVESTIGATE_MIN_DROP_L = 50;

export interface FuelReadingPoint {
  timestamp: string;
  levelL: number;
}

export interface DetectedRefuel {
  timestamp: string;
  startTime: string;
  beforeLevel: number;
  afterLevel: number;
  deltaLiters: number;
}

export type ProbeDropoutKind = 'ignition' | 'investigate';

export interface ProbeDropout {
  id: string;
  kind: ProbeDropoutKind;
  timestamp: string;
  startTime: string;
  endTime: string;
  beforeLevel: number;
  dipLevel: number;
  afterLevel: number;
}

export interface FuelSignalMetrics {
  fuelUsedL: number;
  refuelCount: number;
  refuels: DetectedRefuel[];
  refuelTimes: string[];
  dropouts: ProbeDropout[];
}

export interface ProcessedFuelSignal {
  display: FuelReadingPoint[];
  raw: FuelReadingPoint[];
  dropouts: ProbeDropout[];
  metrics: FuelSignalMetrics;
}

/** Hold level steady inside the probe noise band; only step on real change. */
export function applyFuelDeadband<T extends { levelL: number }>(
  readings: T[],
  deadbandL = FUEL_NOISE_DEADBAND_L,
): T[] {
  let held: number | null = null;
  return readings.map(reading => {
    const raw = Math.max(0, reading.levelL);
    if (held == null || Math.abs(raw - held) > deadbandL) held = raw;
    return { ...reading, levelL: Number(held.toFixed(1)) };
  });
}

/** Collapse dense probe ticks into one last reading per time bucket. */
export function bucketFuelReadings(
  readings: FuelReadingPoint[],
  bucketMinutes: number,
): FuelReadingPoint[] {
  if (bucketMinutes <= 0 || readings.length === 0) return readings;
  const bucketMs = bucketMinutes * 60_000;
  const buckets = new Map<number, { timestamp: string; levelL: number; ts: number }>();
  readings.forEach(reading => {
    const ts = new Date(reading.timestamp).getTime();
    if (!Number.isFinite(ts)) return;
    const key = Math.floor(ts / bucketMs) * bucketMs;
    const existing = buckets.get(key);
    if (!existing || ts >= existing.ts) {
      buckets.set(key, {
        timestamp: new Date(key).toISOString(),
        levelL: reading.levelL,
        ts,
      });
    }
  });
  return [...buckets.values()]
    .sort((a, b) => a.ts - b.ts)
    .map(({ timestamp, levelL }) => ({ timestamp, levelL }));
}

/** Bucket size aligned with JMG range logic, adapted for HBM zoom windows. */
export function chartBucketMinutes(windowHours: number): number {
  if (windowHours <= 24) return 15;
  if (windowHours <= 48) return 15;
  if (windowHours <= 168) return 60;
  if (windowHours <= 336) return 60;
  return 180;
}

export function periodBucketMinutes(period: 'day' | 'week' | 'month' | string): number {
  if (period === 'day') return 15;
  if (period === 'month') return 180;
  return 60;
}

function persistSamplesForBucket(bucketMin: number): number {
  if (bucketMin <= 15) return 3;
  if (bucketMin <= 60) return 2;
  return 1;
}

function tsOf(row: FuelReadingPoint) {
  return new Date(row.timestamp).getTime();
}

/**
 * Flatten ignition / brief recoveries so they do not draw as consumption.
 * A dip to ~0 that later returns to the prior level is ignition, even if long.
 * Any other dip that returns within 30 minutes is a quiet investigate spark.
 * If the probe drops then shoots ≥ 20 L above the prior level, keep the rise as a refill.
 */
export function collapseProbeDropouts(readings: FuelReadingPoint[]): {
  display: FuelReadingPoint[];
  dropouts: ProbeDropout[];
} {
  const display = readings.map(r => ({ ...r }));
  const dropouts: ProbeDropout[] = [];
  const collapsed = new Set<number>();

  for (let i = 1; i < readings.length; i++) {
    if (collapsed.has(i)) continue;
    const prev = readings[i - 1];
    const cur = readings[i];
    if (prev.levelL - cur.levelL <= FUEL_NOISE_DEADBAND_L) continue;

    const held = prev.levelL;
    const startMs = tsOf(prev);
    let dipLevel = cur.levelL;
    let handled = false;

    for (let j = i; j < readings.length; j++) {
      const row = readings[j];
      const elapsed = tsOf(row) - startMs;
      dipLevel = Math.min(dipLevel, row.levelL);

      if (row.levelL >= held + REFUEL_MIN_LITERS) {
        for (let k = i; k < j; k++) {
          display[k] = { ...display[k], levelL: held };
          collapsed.add(k);
        }
        handled = true;
        break;
      }

      const recovered = Math.abs(row.levelL - held) <= FUEL_NOISE_DEADBAND_L;
      if (!recovered) continue;

      const ignition = dipLevel <= IGNITION_OFF_LEVEL_L;
      if (!ignition && elapsed > DROPOUT_RECOVER_MS) break;

      // Ignore shallow shakes for the investigate category.
      const dropDepth = held - dipLevel;
      if (!ignition && dropDepth < INVESTIGATE_MIN_DROP_L) {
        handled = true;
        break;
      }

      for (let k = i; k < j; k++) {
        display[k] = { ...display[k], levelL: held };
        collapsed.add(k);
      }
      dropouts.push({
        id: `${prev.timestamp}|${row.timestamp}`,
        kind: ignition ? 'ignition' : 'investigate',
        timestamp: cur.timestamp,
        startTime: prev.timestamp,
        endTime: row.timestamp,
        beforeLevel: held,
        dipLevel: Number(dipLevel.toFixed(1)),
        afterLevel: row.levelL,
      });
      handled = true;
      break;
    }

    if (!handled) continue;
  }

  return { display, dropouts };
}

export function dropoutHoverCopy(event: ProbeDropout) {
  const before = Math.round(event.beforeLevel);
  const dip = Math.round(event.dipLevel);
  const after = Math.round(event.afterLevel);
  if (event.kind === 'ignition') {
    return {
      title: 'Ignition off / on',
      detail: `Probe went to 0 L, then returned to ${after} L.`,
    };
  }
  return {
    title: 'Investigate',
    detail: `Level fell from ${before} L to ${dip} L, then returned to ${after} L.`,
  };
}

/** Raw probe rows → bucketed series, then dropouts collapsed for display. */
export function processFuelReadings(
  raw: Array<{ time?: string; timestamp?: string; level?: number; levelL?: number }>,
  bucketMinutes: number,
  windowStartMs?: number | null,
  windowEndMs?: number | null,
): ProcessedFuelSignal {
  const sorted = raw
    .map(pt => ({
      timestamp: pt.time ?? pt.timestamp ?? '',
      levelL: Math.max(0, pt.level ?? pt.levelL ?? 0),
    }))
    .filter(pt => pt.timestamp && Number.isFinite(new Date(pt.timestamp).getTime()))
    .sort((a, b) => tsOf(a) - tsOf(b));

  const inWindow = sorted.filter(pt => {
    const ts = tsOf(pt);
    if (windowStartMs != null && ts < windowStartMs) return false;
    if (windowEndMs != null && ts > windowEndMs) return false;
    return true;
  });

  const source = inWindow.length > 0 ? inWindow : sorted;
  const deadbanded = applyFuelDeadband(source);
  const { display: collapsed, dropouts } = collapseProbeDropouts(deadbanded);
  const display = bucketFuelReadings(collapsed, bucketMinutes);
  const metrics = analyzeFuelSignal(display, bucketMinutes, dropouts);
  return { display, raw: deadbanded, dropouts, metrics };
}

export function buildStableFuelSeries(
  raw: Array<{ time: string; level: number }>,
  bucketMinutes: number,
  windowStartMs?: number | null,
  windowEndMs?: number | null,
): FuelReadingPoint[] {
  return processFuelReadings(raw, bucketMinutes, windowStartMs, windowEndMs).display;
}

/**
 * Refuel detection on the collapsed series.
 * Rise must be ≥ 20 L, persist for N buckets, and re-arm after a real drawdown.
 */
export function analyzeFuelSignal(
  readings: FuelReadingPoint[],
  bucketMinutes: number,
  dropouts: ProbeDropout[] = [],
): FuelSignalMetrics {
  let fuelUsedL = 0;
  let refuelCount = 0;
  const refuels: DetectedRefuel[] = [];
  const refuelTimes: string[] = [];
  const persistSamples = persistSamplesForBucket(bucketMinutes);
  let armedForRefuel = true;

  for (let i = 1; i < readings.length; i++) {
    const prev = readings[i - 1];
    const cur = readings[i];
    const delta = cur.levelL - prev.levelL;

    if (delta < -FUEL_NOISE_DEADBAND_L) {
      fuelUsedL += Math.abs(delta);
      armedForRefuel = true;
      continue;
    }

    if (!armedForRefuel) continue;

    if (delta >= REFUEL_MIN_LITERS) {
      const peak = cur.levelL;
      const end = Math.min(readings.length - 1, i + persistSamples);
      const stayedElevated = readings
        .slice(i, end + 1)
        .every(r => r.levelL >= peak - FUEL_NOISE_DEADBAND_L);

      if (stayedElevated) {
        refuelCount += 1;
        refuelTimes.push(cur.timestamp);
        refuels.push({
          timestamp: cur.timestamp,
          startTime: prev.timestamp,
          beforeLevel: prev.levelL,
          afterLevel: cur.levelL,
          deltaLiters: Number((cur.levelL - prev.levelL).toFixed(1)),
        });
        armedForRefuel = false;
      }
    }
  }

  return {
    fuelUsedL: Number(fuelUsedL.toFixed(2)),
    refuelCount,
    refuels,
    refuelTimes,
    dropouts,
  };
}

/** Step segment for a refuel already detected on the stable chart series. */
export function refuelStepFromSeries(
  chartData: Array<{ ts: number; level: number }>,
  refuelTimestamp: string,
): Array<{ ts: number; level: number }> | null {
  if (chartData.length < 2) return null;
  const targetTs = new Date(refuelTimestamp).getTime();
  if (!Number.isFinite(targetTs)) return null;

  let bestIdx = -1;
  let bestDist = Infinity;
  for (let i = 1; i < chartData.length; i++) {
    const dist = Math.abs(chartData[i].ts - targetTs);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }
  if (bestIdx < 1) return null;

  const prev = chartData[bestIdx - 1];
  const cur = chartData[bestIdx];
  return [
    { ts: prev.ts, level: prev.level },
    { ts: cur.ts, level: cur.level },
  ];
}

export function dropoutRevealFromRaw(
  raw: FuelReadingPoint[],
  event: ProbeDropout,
): Array<{ ts: number; level: number }> {
  const start = new Date(event.startTime).getTime();
  const end = new Date(event.endTime).getTime();
  return raw
    .filter(pt => {
      const ts = tsOf(pt);
      return ts >= start && ts <= end;
    })
    .map(pt => ({ ts: tsOf(pt), level: pt.levelL }));
}

export function detectedRefuelToRow(assetId: string, refuel: DetectedRefuel): {
  assetId: string;
  timestamp: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  beforeLevel: number;
  afterLevel: number;
  deltaLiters: number;
} {
  const startMs = new Date(refuel.startTime).getTime();
  const endMs = new Date(refuel.timestamp).getTime();
  return {
    assetId,
    timestamp: refuel.timestamp,
    startTime: refuel.startTime,
    endTime: refuel.timestamp,
    durationMinutes: Number.isFinite(startMs) && Number.isFinite(endMs)
      ? Math.max(0, Math.round((endMs - startMs) / 60_000))
      : 0,
    beforeLevel: refuel.beforeLevel,
    afterLevel: refuel.afterLevel,
    deltaLiters: refuel.deltaLiters,
  };
}

export function refuelRowKey(refuel: { assetId: string; timestamp: string }) {
  return `${refuel.assetId}|${refuel.timestamp}`;
}

export function formatFuel(value: number | null | undefined, digits = 1) {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

export function formatRefuelTimes(times: string[]) {
  return times.map(ts => new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })).join(' · ');
}

export function formatFuelSignalSummary(metrics: Pick<FuelSignalMetrics, 'fuelUsedL' | 'refuelCount' | 'refuelTimes'> | null) {
  if (!metrics) return 'Select a vehicle to view fuel signal.';
  const refillBit = metrics.refuelCount === 0
    ? 'No refuel activity recorded.'
    : metrics.refuelCount === 1
      ? `Refuel activity: 1 stop recorded at ${formatRefuelTimes(metrics.refuelTimes)}.`
      : `Refuel activity: ${metrics.refuelCount} stops recorded at ${formatRefuelTimes(metrics.refuelTimes)}.`;
  if (metrics.fuelUsedL <= 0) {
    return `${refillBit} No measurable fuel drawdown in this window.`;
  }
  return refillBit;
}
