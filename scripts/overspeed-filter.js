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

/**
 * Speed (kph) recorded on the MiX event itself at trigger time.
 * Order: explicit Speed fields → event Position → Value (Road speed) → optional live.
 * Does NOT use live position unless allowLiveFallback is explicitly true.
 */
export function extractMixEventSpeedKph(e, speedByAsset, opts = {}) {
  const allowLiveFallback = opts.allowLiveFallback === true;
  const candidates = [
    e?.Speed,
    e?.SpeedKilometresPerHour,
    e?.Position?.SpeedKilometresPerHour,
    // MiX overspeed ValueName is often "Road speed"
    e?.Value,
    e?.EventValue,
    e?.ValueNumber,
    // Last resort only when explicitly allowed — not "speed at event call".
    allowLiveFallback && e?.AssetId != null && speedByAsset
      ? speedByAsset.get(String(e.AssetId))
      : null,
  ];
  for (const c of candidates) {
    // Skip null/undefined/'' — Number(null)===0 would falsely look like a real speed.
    if (c == null || c === '') continue;
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

/**
 * Drop under-threshold / unknown-speed overspeed rows.
 * Matches src/lib/overspeedFilter.ts — requireSpeed is always on.
 * @param {Array<{ label?: string|null, speed?: number|null }>} rows
 */
export function filterOverspeedEvents(rows) {
  return (rows || []).filter(row =>
    qualifiesAsOverspeed(row.label, row.speed ?? null, { requireSpeed: true }),
  );
}
