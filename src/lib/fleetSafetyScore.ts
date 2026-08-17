/**
 * Shared Fleet Safety Score — used by Home, Safety, Sidebar, Tankers.
 * Editable via Settings → Safety Score (localStorage).
 *
 * Formula (attainment vs leading-fleet target rate):
 *   actualRate = weighted points / vehicles × 100  (last 30 days)
 *   score = min(100, SCORE_AT_AIM × leadingRate / actualRate)
 * Match the leading rate → SCORE_AT_AIM (85). Beat it → climb toward 100.
 */

/** Score awarded when your weighted rate exactly equals the leading aim. */
export const FLEET_SCORE_AT_AIM = 85;

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
   * Leading target for Nigeria / heavy industrial fleets: max weighted IVMS
   * points per 100 vehicles in 30 days. Match the aim → score 85; beat it → up to 100.
   * Default 220 aligns with current heavy-ops MiX rates.
   */
  leadingRatePer100: number;
  /** Minimum score after calculation (default 0). */
  scoreFloor: number;
  /** Display band cutoffs (score ≥ value). */
  bandGood: number;
  bandAttention: number;
  bandBelow: number;
  /** Home Driver Performance: points deducted per incident. */
  driverPenaltyPerEvent: number;
  /** Alert thresholds (display / future alerts). */
  fleetScoreWarning: number;
  fleetScoreCritical: number;
}

export const DEFAULT_FLEET_SCORE_CONFIG: FleetScoreConfig = {
  weights: {
    harshBraking: 2,
    harshAcceleration: 1.5,
    overspeeding: 1.5,
    harshCornering: 1,
  },
  leadingRatePer100: 220,
  scoreFloor: 0,
  bandGood: 80,
  bandAttention: 60,
  bandBelow: 45,
  driverPenaltyPerEvent: 3,
  fleetScoreWarning: 70,
  fleetScoreCritical: 50,
};

type ScoreEvent = { label?: string | null; type?: string; eventTime?: string; timestamp?: string };

function clampNum(n: unknown, fallback: number, min = 0, max = 1000): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
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
    leadingRatePer100: clampNum(o.leadingRatePer100, d.leadingRatePer100, 0.1, 2000),
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
    const parsed = JSON.parse(raw) as Partial<FleetScoreConfig> & { leadingRatePer100?: number };
    // Migrate prior defaults (EU award 8, then NG 240) → current leading aim 220
    if (parsed.leadingRatePer100 === 8 || parsed.leadingRatePer100 === 240) {
      const migrated = normalizeFleetScoreConfig({
        ...parsed,
        leadingRatePer100: DEFAULT_FLEET_SCORE_CONFIG.leadingRatePer100,
      });
      localStorage.setItem(FLEET_SCORE_CONFIG_KEY, JSON.stringify(migrated));
      return migrated;
    }
    return normalizeFleetScoreConfig(parsed);
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

/** Sum of weighted points from scored safety events (panic ignored). */
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

/** Weighted IVMS points per 100 vehicles. */
export function ratePer100Vehicles(
  events: ScoreEvent[],
  vehicleCount: number,
  config: FleetScoreConfig = loadFleetScoreConfig(),
): number {
  const fleet = Math.max(vehicleCount, 1);
  return (weightedIncidentPoints(events, config) / fleet) * 100;
}

/**
 * Fleet Safety Score vs leading-fleet target.
 * Match leadingRatePer100 → 85; beat it → up to 100; worse rates scale down from 85.
 */
export function scoreFromEvents(
  events: ScoreEvent[],
  vehicleCount: number,
  config: FleetScoreConfig = loadFleetScoreConfig(),
): number {
  const actualRate = ratePer100Vehicles(events, vehicleCount, config);
  const leading = Math.max(config.leadingRatePer100, 0.1);
  if (actualRate <= 0) {
    return 100;
  }
  const pct = Math.round((FLEET_SCORE_AT_AIM * leading) / actualRate);
  return Math.max(config.scoreFloor, Math.min(100, pct));
}

export function computeFleetScore(
  events: ScoreEvent[],
  vehicleCount: number,
  config: FleetScoreConfig = loadFleetScoreConfig(),
): { score: number; delta: number } {
  const now = Date.now();
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
  const sixtyDaysAgo = now - 60 * 24 * 60 * 60 * 1000;

  const recent = events.filter(e => new Date(e.eventTime || e.timestamp || 0).getTime() >= thirtyDaysAgo);
  const prev = events.filter(e => {
    const t = new Date(e.eventTime || e.timestamp || 0).getTime();
    return t >= sixtyDaysAgo && t < thirtyDaysAgo;
  });

  const current = scoreFromEvents(recent, vehicleCount, config);
  const previous = scoreFromEvents(prev, vehicleCount, config);
  return { score: current, delta: current - previous };
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
