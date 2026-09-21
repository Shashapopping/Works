/**
 * SafeIQ cards are composed locally from event + environment + safety references.
 * No model call. Flip to false to hide the pipeline in the shell.
 * Overspeed qualification is the same floor as the map (`overspeedFilter`).
 * Card display always uses the company 60 km/h standard as the limit line.
 */
export const SAFEIQ_ENABLED = true;

/** Company speed standard shown on SafeIQ cards (always — not telematics posted limit). */
export const SAFEIQ_SPEED_LIMIT_KMH = 60;

/** Declining/improving only when implied score moves at least this fraction vs the prior equal window. */
export const SAFEIQ_TREND_DROP_PCT = 0.05;

export function safeIqTrendFromCounts(
  recentCount: number,
  priorCount: number,
): 'improving' | 'stable' | 'declining' {
  const score = (n: number) => Math.max(0, 100 - n * 3);
  const recentScore = score(recentCount);
  const priorScore = score(priorCount);
  const base = Math.max(priorScore, 1);
  const deltaPct = (recentScore - priorScore) / base;
  if (deltaPct <= -SAFEIQ_TREND_DROP_PCT) return 'declining';
  if (deltaPct >= SAFEIQ_TREND_DROP_PCT) return 'improving';
  return 'stable';
}
