/**
 * Drive vs idle fuel / hours from a MiX trip (+ SubTrips when present).
 * Shared by SQLite ingest columns and API consumers (Fuel / Util / HOS).
 */

function sanitizeEngineSeconds(eng, driveSec, standSec, durationSec) {
  if (!Number.isFinite(eng) || eng < 0) return null;
  const cap = Math.max(
    Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 0,
    (driveSec || 0) + (standSec || 0),
    driveSec || 0,
  );
  if (cap > 0 && eng > cap * 1.25) return cap;
  return eng;
}

export function readEngineSeconds(obj, driveSec, standSec) {
  const durationSec = Number(obj?.Duration);
  const startEng = obj?.StartEngineSeconds != null ? Number(obj.StartEngineSeconds) : null;
  const endEng = obj?.EndEngineSeconds != null ? Number(obj.EndEngineSeconds) : null;
  const delta = Number.isFinite(startEng) && Number.isFinite(endEng) ? endEng - startEng : null;
  const reported = obj?.EngineSeconds != null ? Number(obj.EngineSeconds) : null;

  let eng = null;
  if (Number.isFinite(delta) && delta >= 0 && startEng > 0) eng = delta;
  else if (Number.isFinite(reported) && reported >= 0) eng = reported;
  else if (Number.isFinite(delta) && delta >= 0) eng = delta;

  return sanitizeEngineSeconds(eng, driveSec, standSec, durationSec);
}

/**
 * @param {object} raw - slim or full MiX trip
 * @param {{ fuelUsedLitres?: number|null, tripStart?: string|null, tripEnd?: string|null, drivingTimeSeconds?: number|null }} [normalized]
 */
export function splitTripFuel(raw, normalized = null) {
  const fuelRaw = normalized?.fuelUsedLitres != null
    ? normalized.fuelUsedLitres
    : (raw?.FuelUsedLitres ?? raw?.FuelUsedLiters ?? raw?.fuelUsedLitres);
  const tripFuel = fuelRaw != null && Number.isFinite(Number(fuelRaw)) ? Math.abs(Number(fuelRaw)) : 0;
  const tripStart = normalized?.tripStart ?? raw?.TripStart ?? raw?.tripStart ?? raw?.StartDateTime ?? null;
  const tripEnd = normalized?.tripEnd ?? raw?.TripEnd ?? raw?.tripEnd ?? raw?.EndDateTime ?? tripStart;
  const drivingTimeSeconds = normalized?.drivingTimeSeconds ?? raw?.DrivingTime ?? null;

  const subs = Array.isArray(raw?.SubTrips) ? raw.SubTrips : [];
  let driveFuel = 0;
  let idleFuel = 0;
  let driveSec = 0;
  let standSec = 0;
  let engSec = 0;
  let hasSubTrips = false;

  if (subs.length) {
    hasSubTrips = true;
    for (const s of subs) {
      const fuel = Math.abs(Number(s.FuelUsedLitres ?? s.FuelUsedLiters) || 0);
      const d = Number(s.DrivingTime) || 0;
      const st = Number(s.StandingTime) || 0;
      const eng = readEngineSeconds(s, d, st);
      driveSec += d;
      standSec += st;
      if (eng != null && eng > 0) {
        engSec += eng;
        if (fuel > 0) {
          driveFuel += fuel * (d / eng);
          idleFuel += fuel * (Math.max(0, eng - d) / eng);
        }
      } else if (fuel > 0) {
        driveFuel += fuel;
      }
    }
  } else {
    driveSec = Number(drivingTimeSeconds) || 0;
    standSec = Number(raw?.StandingTime) || 0;
    const spanSec = (() => {
      const a = tripStart ? new Date(tripStart).getTime() : NaN;
      const b = tripEnd ? new Date(tripEnd).getTime() : NaN;
      return Number.isFinite(a) && Number.isFinite(b) && b > a ? (b - a) / 1000 : 0;
    })();
    const eng = readEngineSeconds(
      { ...raw, Duration: raw?.Duration ?? spanSec },
      driveSec,
      standSec,
    );
    engSec = eng != null && eng > 0 ? eng : driveSec;
  }

  const splitTotal = driveFuel + idleFuel;
  if (tripFuel > 0 && splitTotal > 0.0001) {
    const scale = tripFuel / splitTotal;
    driveFuel *= scale;
    idleFuel *= scale;
  } else if (tripFuel > 0 && splitTotal <= 0.0001) {
    if (hasSubTrips && engSec > 0) {
      driveFuel = tripFuel * (driveSec / engSec);
      idleFuel = tripFuel * (Math.max(0, engSec - driveSec) / engSec);
    } else {
      driveFuel = tripFuel;
      idleFuel = 0;
    }
  }

  const totalFuel = tripFuel > 0 ? tripFuel : splitTotal;
  const idleEngSec = Math.max(0, engSec - driveSec);

  return {
    hasSubTrips,
    totalFuelLiters: totalFuel,
    driveFuelLiters: driveFuel,
    idleFuelLiters: idleFuel,
    drivingHours: driveSec / 3600,
    standingHours: standSec / 3600,
    engineHours: engSec / 3600,
    idleHours: idleEngSec / 3600,
  };
}
