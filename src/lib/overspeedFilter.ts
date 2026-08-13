/**
 * Overspeed qualification — absolute floor so road-limit / tiered events
 * below 60 kph are never treated as overspeeding.
 */

export const OVERSPEED_MIN_KPH = 60;

const OVERSPEED_LABELS = new Set([
  'Overspeeding',
  'Overspeed Tiered',
  'Overspeeding — Excessive Speed',
  'Road Speed Overspeeding',
]);

export function isOverspeedLabel(label?: string | null): boolean {
  return !!label && OVERSPEED_LABELS.has(label);
}

/**
 * Non-overspeed always passes. Overspeed with a known speed must be ≥ 60 kph.
 * Unknown speed is kept unless requireSpeed is set by the caller.
 */
export function qualifiesAsOverspeed(
  label?: string | null,
  speedKph?: number | null,
  opts: { requireSpeed?: boolean } = {},
): boolean {
  if (!isOverspeedLabel(label)) return true;
  if (speedKph == null || !Number.isFinite(speedKph)) {
    return opts.requireSpeed ? false : true;
  }
  return speedKph >= OVERSPEED_MIN_KPH;
}

export function filterOverspeedEvents<T extends { label?: string | null; speed?: number | null }>(
  rows: T[],
): T[] {
  return rows.filter(r => qualifiesAsOverspeed(r.label, r.speed ?? null, { requireSpeed: true }));
}
