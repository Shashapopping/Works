/**
 * Backend mirror of src/lib/fuelSignal.ts — keep refuel/chart logic in sync.
 */

export const FUEL_NOISE_DEADBAND_L = 5;
export const REFUEL_MIN_LITERS = 20;
export const IGNITION_OFF_LEVEL_L = 5;
export const DROPOUT_RECOVER_MS = 30 * 60 * 1000;
export const INVESTIGATE_MIN_DROP_L = 50;

export function applyFuelDeadband(readings, deadbandL = FUEL_NOISE_DEADBAND_L) {
  let held = null;
  return readings.map(reading => {
    const raw = Math.max(0, reading.levelL ?? reading.level ?? 0);
    if (held == null || Math.abs(raw - held) > deadbandL) held = raw;
    return {
      ...reading,
      levelL: Number(held.toFixed(1)),
      level: Number(held.toFixed(1)),
    };
  });
}

export function bucketFuelReadings(readings, bucketMinutes) {
  if (bucketMinutes <= 0 || !readings?.length) return readings ?? [];
  const bucketMs = bucketMinutes * 60_000;
  const buckets = new Map();
  readings.forEach(reading => {
    const ts = new Date(reading.timestamp ?? reading.time).getTime();
    if (!Number.isFinite(ts)) return;
    const key = Math.floor(ts / bucketMs) * bucketMs;
    const existing = buckets.get(key);
    const levelL = reading.levelL ?? reading.level ?? 0;
    if (!existing || ts >= existing.ts) {
      buckets.set(key, {
        timestamp: new Date(key).toISOString(),
        levelL,
        level: levelL,
        ms: key,
        ts,
      });
    }
  });
  return [...buckets.values()]
    .sort((a, b) => a.ts - b.ts)
    .map(({ timestamp, levelL, level, ms }) => ({ timestamp, levelL, level, ms }));
}

export function periodBucketMinutes(period) {
  if (period === 'day') return 15;
  if (period === 'month') return 180;
  return 60;
}

function persistSamplesForBucket(bucketMin) {
  if (bucketMin <= 15) return 3;
  if (bucketMin <= 60) return 2;
  return 1;
}

function tsOf(row) {
  return new Date(row.timestamp).getTime();
}

export function collapseProbeDropouts(readings) {
  const display = readings.map(r => ({ ...r }));
  const dropouts = [];
  const collapsed = new Set();

  for (let i = 1; i < readings.length; i++) {
    if (collapsed.has(i)) continue;
    const prev = readings[i - 1];
    const cur = readings[i];
    const prevLevel = prev.levelL ?? prev.level ?? 0;
    const curLevel = cur.levelL ?? cur.level ?? 0;
    if (prevLevel - curLevel <= FUEL_NOISE_DEADBAND_L) continue;

    const held = prevLevel;
    const startMs = tsOf(prev);
    let dipLevel = curLevel;

    for (let j = i; j < readings.length; j++) {
      const row = readings[j];
      const rowLevel = row.levelL ?? row.level ?? 0;
      const elapsed = tsOf(row) - startMs;
      dipLevel = Math.min(dipLevel, rowLevel);

      if (rowLevel >= held + REFUEL_MIN_LITERS) {
        for (let k = i; k < j; k++) {
          display[k] = { ...display[k], levelL: held, level: held };
          collapsed.add(k);
        }
        break;
      }

      const recovered = Math.abs(rowLevel - held) <= FUEL_NOISE_DEADBAND_L;
      if (!recovered) continue;

      const ignition = dipLevel <= IGNITION_OFF_LEVEL_L;
      if (!ignition && elapsed > DROPOUT_RECOVER_MS) break;

      // Ignore shallow shakes for the investigate category.
      const dropDepth = held - dipLevel;
      if (!ignition && dropDepth < INVESTIGATE_MIN_DROP_L) break;

      for (let k = i; k < j; k++) {
        display[k] = { ...display[k], levelL: held, level: held };
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
        afterLevel: rowLevel,
      });
      break;
    }
  }

  return { display, dropouts };
}

export function processFuelReadings(rawRows, bucketMinutes, startMs, endMs) {
  const sorted = (rawRows ?? [])
    .map(row => ({
      timestamp: row.timestamp ?? row.time,
      levelL: Math.max(0, row.level ?? row.levelL ?? 0),
      ms: row.ms ?? new Date(row.timestamp ?? row.time).getTime(),
    }))
    .filter(row => Number.isFinite(row.ms))
    .sort((a, b) => a.ms - b.ms);

  const inWindow = sorted.filter(row => {
    if (startMs != null && row.ms < startMs) return false;
    if (endMs != null && row.ms > endMs) return false;
    return true;
  });

  const source = inWindow.length > 0 ? inWindow : sorted;
  const deadbanded = applyFuelDeadband(source.map(r => ({ ...r, levelL: r.levelL })));
  const { display: collapsed, dropouts } = collapseProbeDropouts(deadbanded);
  const display = bucketFuelReadings(collapsed, bucketMinutes);
  const metrics = analyzeFuelSignal(display, bucketMinutes, dropouts);
  return { display, raw: deadbanded, dropouts, metrics };
}

export function buildStableFuelSeries(rawRows, bucketMinutes, startMs, endMs) {
  return processFuelReadings(rawRows, bucketMinutes, startMs, endMs).display;
}

export function analyzeFuelSignal(readings, bucketMinutes, dropouts = []) {
  let fuelUsedL = 0;
  let refuelCount = 0;
  const refuels = [];
  const persistSamples = persistSamplesForBucket(bucketMinutes);
  let armedForRefuel = true;

  for (let i = 1; i < readings.length; i++) {
    const prev = readings[i - 1];
    const cur = readings[i];
    const prevLevel = prev.levelL ?? prev.level ?? 0;
    const curLevel = cur.levelL ?? cur.level ?? 0;
    const delta = curLevel - prevLevel;

    if (delta < -FUEL_NOISE_DEADBAND_L) {
      fuelUsedL += Math.abs(delta);
      armedForRefuel = true;
      continue;
    }

    if (!armedForRefuel) continue;

    if (delta >= REFUEL_MIN_LITERS) {
      const peak = curLevel;
      const end = Math.min(readings.length - 1, i + persistSamples);
      const stayedElevated = readings
        .slice(i, end + 1)
        .every(r => (r.levelL ?? r.level ?? 0) >= peak - FUEL_NOISE_DEADBAND_L);

      if (stayedElevated) {
        refuelCount += 1;
        const deltaLiters = Number((curLevel - prevLevel).toFixed(1));
        refuels.push({
          timestamp: cur.timestamp,
          startTime: prev.timestamp,
          endTime: cur.timestamp,
          durationMinutes: Math.max(
            0,
            Math.round((new Date(cur.timestamp).getTime() - new Date(prev.timestamp).getTime()) / 60_000),
          ),
          beforeLevel: prevLevel,
          afterLevel: curLevel,
          deltaLiters,
        });
        armedForRefuel = false;
      }
    }
  }

  return {
    fuelUsedL: Number(fuelUsedL.toFixed(2)),
    refuelCount,
    refuels,
    dropouts,
  };
}

export function detectRefuelsFromAssets(byAsset, start, end, bucketMinutes) {
  const refuels = [];
  byAsset.forEach((sorted, assetId) => {
    const { metrics } = processFuelReadings(sorted, bucketMinutes, start, end);
    metrics.refuels.forEach(r => {
      const ts = new Date(r.timestamp).getTime();
      if (ts >= start && ts <= end) {
        refuels.push({ assetId, ...r });
      }
    });
  });
  return refuels;
}

export function periodFuelDropFromStable(rows, start, end, bucketMinutes) {
  const { metrics } = processFuelReadings(rows, bucketMinutes, start, end);
  return metrics.fuelUsedL;
}
