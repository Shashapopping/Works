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

export function isOverspeedLabel(label) {
  return !!label && OVERSPEED_LABELS.has(String(label));
}

export function isOverspeedCategory(category) {
  return category === 'overspeed';
}

/** Best available speed (kph) from a MiX active-event payload. */
export function extractMixEventSpeedKph(e, speedByAsset) {
  const candidates = [
    e?.Speed,
    e?.SpeedKilometresPerHour,
    e?.Position?.SpeedKilometresPerHour,
    e?.AssetId != null && speedByAsset ? speedByAsset.get(String(e.AssetId)) : null,
  ];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n) && n >= 0 && n < 300) return n;
  }
  return null;
}

/**
 * Returns true when this event should count as overspeeding.
 * Non-overspeed labels always pass.
 * @param {{ requireSpeed?: boolean }} [opts] — when requireSpeed is true (ingest),
 *   unknown speed is rejected so we never store unverified low-speed overspeeds.
 */
export function qualifiesAsOverspeed(labelOrCategory, speedKph, opts = {}) {
  const isOverspeed =
    isOverspeedLabel(labelOrCategory) || isOverspeedCategory(labelOrCategory);
  if (!isOverspeed) return true;
  if (speedKph == null || !Number.isFinite(Number(speedKph))) {
    return opts.requireSpeed ? false : true;
  }
  return Number(speedKph) >= OVERSPEED_MIN_KPH;
}

/** Drop under-threshold overspeed rows from a list (label + optional speed). */
export function filterOverspeedEvents(rows, getLabel, getSpeed) {
  return (rows || []).filter(row =>
    qualifiesAsOverspeed(getLabel(row), getSpeed(row)),
  );
}
