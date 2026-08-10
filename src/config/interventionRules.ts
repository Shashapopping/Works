/**
 * Driver Coaching / Training queue rules — thresholds only.
 * Pages should import from this file, not hardcode numbers.
 *
 * Deliberately excludes panic and any HOS/fatigue inputs — the Scaffold's
 * consequence-management score (src/lib/consequenceScore.ts) already covers
 * the four scored violation types below.
 */

export const SCORING_LABELS = [
  'Harsh Braking',
  'Harsh Acceleration',
  'Overspeeding',
  'Overspeed Tiered',
  'Harsh Cornering',
] as const;

/** Coaching — display score (0-100) at/below this qualifies a driver. */
export const COACHING_SCORE_THRESHOLD = 70;
/** Coaching — or this many scored events within the window qualifies a driver. */
export const COACHING_EVENT_COUNT = 8;
export const COACHING_WINDOW_DAYS = 30;

/** Training — same violation label repeated this many times within the lookback
 *  window after a coaching note was left qualifies a driver for training. */
export const TRAINING_SAME_LABEL_COUNT = 3;
export const TRAINING_SAME_LABEL_DAYS = 14;
export const TRAINING_NOTE_LOOKBACK_DAYS = 30;

export const RECENT_NOTES_PREVIEW = 3;
