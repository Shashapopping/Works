/**
 * Fleet Safety Score — rooted on distance, then HOS duration.
 *
 *   100 = zero weighted harm per 100 km (IVMS + HOS)
 *   score = clamp(0, 100, 100 − 5 × rate)
 *   5 is this fleet's working-day calibration (≈4.3 pt/100 km → Good Standing 80)
 *
 *   actualRate = (IVMS points + HOS points) ÷ (km ÷ 100)
 *   Facts come from /api/safety/summary (SQL), not the live event list.
 */

/** Score points lost per 1 weighted point per 100 km. */
export const SCORE_DROP_PER_HARM_UNIT = 5;

export const FLEET_SCORE_CONFIG_KEY = 'bpl_fleet_score_config';
export const FLEET_SCORE_CONFIG_EVENT = 'bpl-fleet-score-config';

export interface FleetScoreWeights {
  harshBraking: number;
  harshAcceleration: number;
  overspeeding: number;
  harshCornering: number;
}

export interface FleetScoreConfig {
  weights: FleetScoreWeights;
  /**
   * @deprecated Inverse-formula target. Score is now 100 − 5 × rate.
   */
  aimRatePer100Km?: number;
  /** Minutes a HOS breach must be held to mint one slice (default 10). */
  hosSliceMinutes: number;
  /** Points added per HOS slice (default 1.5, same band as overspeeding). */
  hosPointsPer10Min: number;
  /** @deprecated Linear slope; converted back to aimRatePer100Km as 15 / k. */
  scoreDropPerHarmUnit?: number;
  /** @deprecated Old per-100-vehicles aim. Migrated to aimRatePer100Km. */
  leadingRatePer100?: number;
  scoreFloor: number;
  bandGood: number;
  bandAttention: number;
  bandBelow: number;
  driverPenaltyPerEvent: number;
  fleetScoreWarning: number;
  fleetScoreCritical: number;
}

export interface FleetSafetyExposure {
  distanceKm: number;
  hosHeldMinutes: number;
  hosSlices?: number;
  incidentTotal?: number;
  scoringCount?: number;
  byLabel?: Record<string, number>;
  panicCount?: number;
  assetCount?: number;
  driverCount?: number;
  breakdown?: {
    continuous4hMinutes: number;
    weeklyRestMinutes: number;
  };
  start?: string;
  end?: string;
}

export const DEFAULT_FLEET_SCORE_CONFIG: FleetScoreConfig = {
  weights: {
    harshBraking: 2,
    harshAcceleration: 1.5,
    overspeeding: 1.5,
    harshCornering: 1,
  },
  aimRatePer100Km: 1,
  hosSliceMinutes: 10,
  hosPointsPer10Min: 1.5,
  scoreFloor: 0,
  bandGood: 80,
  bandAttention: 60,
  bandBelow: 45,
  driverPenaltyPerEvent: 3,
  fleetScoreWarning: 70,
  fleetScoreCritical: 50,
};

type ScoreEvent = { label?: string | null; type?: string; eventTime?: string; timestamp?: string };

const OLD_VEHICLE_AIMS = new Set([8, 220, 240]);

function clampNum(n: unknown, fallback: number, min = 0, max = 1000): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

function migrateAimRate(raw: Partial<FleetScoreConfig>): number {
  const d = DEFAULT_FLEET_SCORE_CONFIG.aimRatePer100Km;
  const explicit = clampNum(raw.aimRatePer100Km, NaN, 0.01, 50);
  if (Number.isFinite(explicit)) return explicit;

  const drop = Number(raw.scoreDropPerHarmUnit);
  if (Number.isFinite(drop) && drop > 0) {
    return clampNum((100 - 85) / drop, d, 0.01, 50);
  }

  const legacy = Number(raw.leadingRatePer100);
  if (OLD_VEHICLE_AIMS.has(legacy) || (Number.isFinite(legacy) && legacy >= 20)) {
    return d;
  }
  if (Number.isFinite(legacy) && legacy > 0) {
    return clampNum(legacy, d, 0.01, 50);
  }
  return d;
}

export function normalizeFleetScoreConfig(raw: unknown): FleetScoreConfig {
  const d = DEFAULT_FLEET_SCORE_CONFIG;
  if (!raw || typeof raw !== 'object') return { ...d, weights: { ...d.weights } };
  const o = raw as Partial<FleetScoreConfig> & { weights?: Partial<FleetScoreWeights> };

  return {
    weights: {
      harshBraking: clampNum(o.weights?.harshBraking, d.weights.harshBraking, 0, 20),
      harshAcceleration: clampNum(o.weights?.harshAcceleration, d.weights.harshAcceleration, 0, 20),
      overspeeding: clampNum(o.weights?.overspeeding, d.weights.overspeeding, 0, 20),
      harshCornering: clampNum(o.weights?.harshCornering, d.weights.harshCornering, 0, 20),
    },
    aimRatePer100Km: migrateAimRate(o),
    hosSliceMinutes: clampNum(o.hosSliceMinutes, d.hosSliceMinutes, 1, 60),
    hosPointsPer10Min: clampNum(o.hosPointsPer10Min, d.hosPointsPer10Min, 0, 20),
    scoreFloor: clampNum(o.scoreFloor, d.scoreFloor, 0, 100),
    bandGood: clampNum(o.bandGood, d.bandGood, 1, 100),
    bandAttention: clampNum(o.bandAttention, d.bandAttention, 1, 100),
    bandBelow: clampNum(o.bandBelow, d.bandBelow, 1, 100),
    driverPenaltyPerEvent: clampNum(o.driverPenaltyPerEvent, d.driverPenaltyPerEvent, 0, 20),
    fleetScoreWarning: clampNum(o.fleetScoreWarning, d.fleetScoreWarning, 1, 100),
    fleetScoreCritical: clampNum(o.fleetScoreCritical, d.fleetScoreCritical, 1, 100),
  };
}

export function loadFleetScoreConfig(): FleetScoreConfig {
  try {
    const raw = localStorage.getItem(FLEET_SCORE_CONFIG_KEY);
    if (!raw) return { ...DEFAULT_FLEET_SCORE_CONFIG, weights: { ...DEFAULT_FLEET_SCORE_CONFIG.weights } };
    const parsed = JSON.parse(raw) as Partial<FleetScoreConfig>;
    const next = normalizeFleetScoreConfig(parsed);
    const legacyAim = Number(parsed.leadingRatePer100);
    const needsMigrate = parsed.aimRatePer100Km == null
      && (OLD_VEHICLE_AIMS.has(legacyAim) || (Number.isFinite(legacyAim) && legacyAim >= 20));
    if (needsMigrate || parsed.hosPointsPer10Min == null || parsed.scoreDropPerHarmUnit != null) {
      localStorage.setItem(FLEET_SCORE_CONFIG_KEY, JSON.stringify(next));
    }
    return next;
  } catch {
    return { ...DEFAULT_FLEET_SCORE_CONFIG, weights: { ...DEFAULT_FLEET_SCORE_CONFIG.weights } };
  }
}

export function saveFleetScoreConfig(config: FleetScoreConfig): FleetScoreConfig {
  const next = normalizeFleetScoreConfig(config);
  localStorage.setItem(FLEET_SCORE_CONFIG_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(FLEET_SCORE_CONFIG_EVENT, { detail: next }));
  return next;
}

export function eventWeight(label: string | null | undefined, config: FleetScoreConfig = loadFleetScoreConfig()): number {
  const w = config.weights;
  switch (label) {
    case 'Harsh Braking': return w.harshBraking;
    case 'Harsh Acceleration': return w.harshAcceleration;
    case 'Overspeeding':
    case 'Overspeed Tiered':
    case 'Road Speed Overspeeding':
    case 'Overspeeding — Excessive Speed':
      return w.overspeeding;
    case 'Harsh Cornering': return w.harshCornering;
    default: return 0;
  }
}

export function weightedIncidentPoints(
  events: ScoreEvent[],
  config: FleetScoreConfig = loadFleetScoreConfig(),
): number {
  let total = 0;
  events.forEach(e => {
    if (e.type === 'panic') return;
    total += eventWeight(e.label, config);
  });
  return total;
}

export function hosSlicesFromMinutes(
  heldMinutes: number,
  config: FleetScoreConfig = loadFleetScoreConfig(),
): number {
  const slice = Math.max(1, config.hosSliceMinutes || 10);
  return Math.floor(Math.max(0, heldMinutes) / slice);
}

export function hosPointsFromHeldMinutes(
  heldMinutes: number,
  config: FleetScoreConfig = loadFleetScoreConfig(),
): number {
  return hosSlicesFromMinutes(heldMinutes, config) * (config.hosPointsPer10Min ?? 1.5);
}

/** Weighted harm (IVMS + HOS) per 100 km. */
export function ratePer100Km(
  points: number,
  distanceKm: number,
): number {
  const blocks = Math.max(distanceKm / 100, 0.01);
  return points / blocks;
}

export function totalSafetyPoints(
  events: ScoreEvent[],
  hosHeldMinutes: number,
  config: FleetScoreConfig = loadFleetScoreConfig(),
): { ivms: number; hos: number; total: number } {
  const ivms = weightedIncidentPoints(events, config);
  const hos = hosPointsFromHeldMinutes(hosHeldMinutes, config);
  return { ivms, hos, total: ivms + hos };
}

export function ivmsPointsFromByLabel(
  byLabel: Record<string, number> | undefined,
  config: FleetScoreConfig = loadFleetScoreConfig(),
): number {
  let total = 0;
  for (const [label, count] of Object.entries(byLabel || {})) {
    total += eventWeight(label, config) * Number(count || 0);
  }
  return total;
}

export function totalSafetyPointsFromCensus(
  exposure: FleetSafetyExposure,
  config: FleetScoreConfig = loadFleetScoreConfig(),
): { ivms: number; hos: number; total: number } {
  const ivms = ivmsPointsFromByLabel(exposure.byLabel, config);
  const hos = hosPointsFromHeldMinutes(exposure.hosHeldMinutes ?? 0, config);
  return { ivms, hos, total: ivms + hos };
}

export function scoreFromCensus(
  exposure: FleetSafetyExposure,
  config: FleetScoreConfig = loadFleetScoreConfig(),
): number {
  const { total } = totalSafetyPointsFromCensus(exposure, config);
  if (total <= 0) return 100;
  if (!(exposure.distanceKm > 0)) return config.scoreFloor;
  const pct = Math.round(100 - SCORE_DROP_PER_HARM_UNIT * ratePer100Km(total, exposure.distanceKm));
  return Math.max(config.scoreFloor, Math.min(100, pct));
}

export function scoreFromInputs(
  input: {
    events?: ScoreEvent[];
    byLabel?: Record<string, number>;
    distanceKm: number;
    hosHeldMinutes?: number;
  },
  config: FleetScoreConfig = loadFleetScoreConfig(),
): number {
  const ivms = input.byLabel
    ? ivmsPointsFromByLabel(input.byLabel, config)
    : weightedIncidentPoints(input.events || [], config);
  const hos = hosPointsFromHeldMinutes(input.hosHeldMinutes ?? 0, config);
  const total = ivms + hos;
  if (total <= 0) return 100;
  if (!(input.distanceKm > 0)) return config.scoreFloor;
  const pct = Math.round(100 - SCORE_DROP_PER_HARM_UNIT * ratePer100Km(total, input.distanceKm));
  return Math.max(config.scoreFloor, Math.min(100, pct));
}

/** Second arg is distance km. Optional 4th arg is HOS held minutes. */
export function scoreFromEvents(
  events: ScoreEvent[],
  distanceKm: number,
  config: FleetScoreConfig = loadFleetScoreConfig(),
  hosHeldMinutes = 0,
): number {
  return scoreFromInputs({ events, distanceKm, hosHeldMinutes }, config);
}

/** @deprecated Vehicle-based rate. Prefer ratePer100Km. */
export function ratePer100Vehicles(
  events: ScoreEvent[],
  vehicleCount: number,
  config: FleetScoreConfig = loadFleetScoreConfig(),
): number {
  const fleet = Math.max(vehicleCount, 1);
  return (weightedIncidentPoints(events, config) / fleet) * 100;
}

export function computeFleetScore(
  current: FleetSafetyExposure,
  previous: FleetSafetyExposure | null = null,
  config: FleetScoreConfig = loadFleetScoreConfig(),
): { score: number; delta: number } {
  const currentScore = scoreFromCensus(current, config);
  const previousScore = previous ? scoreFromCensus(previous, config) : currentScore;
  return { score: currentScore, delta: currentScore - previousScore };
}

export function scoreBandLabel(score: number, config: FleetScoreConfig = loadFleetScoreConfig()): string {
  if (score >= config.bandGood) return 'Good Standing';
  if (score >= config.bandAttention) return 'Needs Attention';
  if (score >= config.bandBelow) return 'Below Average';
  return 'Poor Performance';
}

export function scoreBandColor(score: number, config: FleetScoreConfig = loadFleetScoreConfig()): string {
  if (score >= config.bandGood) return '#16a34a';
  if (score >= config.bandAttention) return '#d97706';
  if (score >= config.bandBelow) return '#e05c2a';
  return '#CC0000';
}
