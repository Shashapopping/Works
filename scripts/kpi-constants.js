/**
 * Shared MiX event IDs for operational KPIs:
 * utilization (loaded truck), fatigue management (MiX Vision), overspeed variants.
 * IDs sourced from public/event-library.json.
 */

export const KPI_CATEGORY = {
  LOADED: 'loaded',
  OFFLOAD: 'offload',
  LOAD_DURATION: 'load_duration',
  FATIGUE_YAWNING: 'fatigue_yawning',
  FATIGUE_EYE_CLOSING: 'fatigue_eye_closing',
  DISTRACTION: 'distraction',
  PHONE_DISTRACTION: 'phone_distraction',
  OVERSPEED: 'overspeed',
  HARSH_BRAKING: 'harsh_braking',
};

/** EventTypeId → { category, label } */
export const KPI_EVENT_TYPES = {
  // Loaded state — opens a loaded interval
  '-8473465096680378070': { category: KPI_CATEGORY.LOADED, label: 'Loaded Truck' },
  '928362777931537630':   { category: KPI_CATEGORY.LOADED, label: 'Loaded Truck and Moving' },
  '-5834537248419541276': { category: KPI_CATEGORY.LOADED, label: 'Loaded truck Info Hub' },
  '2217713211525682971':  { category: KPI_CATEGORY.LOADED, label: 'Loaded Truck Standing >5min' },

  // Empty / offload — closes a loaded interval
  '-5061180788966743327': { category: KPI_CATEGORY.OFFLOAD, label: 'Quarry Truck Offload' },
  '6746915803169144506':  { category: KPI_CATEGORY.OFFLOAD, label: 'Payload Reduction' },
  '3598509194708519680':  { category: KPI_CATEGORY.OFFLOAD, label: 'Empty Truck Info Hub' },

  // Direct load-duration event (payload tonnes as value)
  '4250686965290100090':  { category: KPI_CATEGORY.LOAD_DURATION, label: 'Truck Load Duration' },

  // Fatigue management — MiX Vision DMS (Chevron guidance: yawning = fatigue indicator)
  '-9097769333405069134': { category: KPI_CATEGORY.FATIGUE_YAWNING, label: 'Driver Fatigue — Yawning' },
  '-480217926216925926':  { category: KPI_CATEGORY.FATIGUE_EYE_CLOSING, label: 'Driver Fatigue — Eye Closing' },
  '-8300145843408847057': { category: KPI_CATEGORY.DISTRACTION, label: 'Driver Distraction' },
  '5790861721889710462':  { category: KPI_CATEGORY.PHONE_DISTRACTION, label: 'Mobile Phone Distraction' },

  // Overspeed variants (canonical two are also in WARNING_EVENT_TYPES / events.log)
  '-3890646499157906515': { category: KPI_CATEGORY.OVERSPEED, label: 'Overspeeding' },
  '-4596269900191457380': { category: KPI_CATEGORY.OVERSPEED, label: 'Overspeed Tiered' },
  '-8136342741862439235': { category: KPI_CATEGORY.OVERSPEED, label: 'Overspeeding — Excessive Speed' },
  '-2864371101042705250': { category: KPI_CATEGORY.OVERSPEED, label: 'Road Speed Overspeeding' },

  // Harsh braking (canonical id is also in WARNING_EVENT_TYPES / events.log)
  '4750800303282680186':  { category: KPI_CATEGORY.HARSH_BRAKING, label: 'Harsh Braking' },
};

export const KPI_EVENT_IDS = new Set(Object.keys(KPI_EVENT_TYPES));

export function serializeKpiLogEntry(e, driver) {
  const meta = KPI_EVENT_TYPES[e.EventTypeId?.toString()];
  if (!meta) return null;
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    assetId: e.AssetId?.toString() ?? null,
    driverId: e.DriverId?.toString() ?? null,
    driverName: driver?.name ?? 'N/A',
    eventId: e.EventId?.toString() ?? null,
    eventTypeId: e.EventTypeId?.toString() ?? null,
    category: meta.category,
    label: meta.label,
    eventTime: e.EventDateTime ?? e.StartDateTime ?? null,
    endTime: e.EndDateTime ?? null,
    value: e.Value ?? e.EventValue ?? null,
    speed: e.Speed
      ?? e.SpeedKilometresPerHour
      ?? e.Position?.SpeedKilometresPerHour
      ?? e.Value
      ?? e.EventValue
      ?? e.ValueNumber
      ?? null,
    latitude: e.Position?.Latitude ?? null,
    longitude: e.Position?.Longitude ?? null,
  });
}
