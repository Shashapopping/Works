/**
 * Shared metric / status definitions for (i) info tips.
 * Status rules mirror scripts/mix-test.js assignment.
 * Utilization formulas mirror scripts/util-engine.js.
 */

export const KPI_DEFINITIONS = {
  utilization:
    'Utilization % = Driving time ÷ Engine-on time. How much of engine-on time was actually driving rather than standing / idle. Uses SubTrip DrivingTime and EngineSeconds when available.',
  availability:
    'Availability % = Engine-on hours ÷ Hours in the selected period (capped at 100%). Share of the period the asset was running.',
  engineRuntime:
    'Total engine-on time from trip telemetry (EngineSeconds / SubTrips, else driving + standing). Denominator for utilization; numerator for availability.',
  drivingTime:
    'Time MiX counts as driving (SubTrip DrivingTime when present). Numerator for utilization.',
  idleTime:
    'Engine-on time that is not driving — standing / idle from SubTrips, else engine-on minus driving.',
  harshBraking:
    'Count of harsh braking events from MiX warning telemetry. Score = count ÷ 3.',
  overspeeding:
    'Count of overspeeding events from MiX. Score = count ÷ 1. Duration estimated when end time is missing.',
  fatigue:
    'Fatigue / distraction events (yawning, eye closing, distraction, phone use) from MiX DMS telemetry.',
} as const;

export const STATUS_DEFINITIONS = {
  total: 'Total number of vehicles currently in the fleet feed.',
  moving: 'Actively travelling — speed above 5 km/h and GPS update within the last 5 minutes.',
  idle: 'MiX idle event — engine on / idling, not classified as Moving.',
  excessiveIdle: 'MiX excessive-idle event — prolonged idling flagged by telematics.',
  stationary: 'Not moving; last GPS position less than 1 hour ago.',
  parked: 'Not moving; last GPS position between 1 and 24 hours ago.',
  offline: 'Inactive — vehicle has not moved in over 24 hours (last GPS between 24 hours and 30 days ago).',
  nonOperational: 'Non-operational — vehicle has not moved in over 30 days.',
} as const;

export type KpiDefinitionKey = keyof typeof KPI_DEFINITIONS;
export type StatusDefinitionKey = keyof typeof STATUS_DEFINITIONS;

/**
 * Display label for a vehicle status (Chevron naming):
 * Offline → Inactive, Inactive → Non-Operational.
 */
export function statusDisplayLabel(status: string): string {
  if (status === 'Offline') return 'Inactive';
  if (status === 'Inactive') return 'Non-Operational';
  return status;
}
