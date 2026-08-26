/**
 * Shared metric / status definitions for (i) info tips.
 * Status rules mirror scripts/mix-test.js assignment.
 * KPI formulas mirror scripts/kpi-engine.js.
 */

export const KPI_DEFINITIONS = {
  utilization:
    'Utilization % = operational time ÷ available (in-use) time. How much the truck was actually working while it was considered in use — typically (trip time − idle) ÷ engine runtime, or DrivingTime ÷ Duration when MiX provides both.',
  availability:
    'Availability % = Engine runtime hours ÷ Hours in the selected period (capped at 100%). Share of the period the asset was in use (running).',
  engineRuntime:
    'Total engine-on / in-use time from trip telemetry in the selected period. Denominator for utilization; numerator for availability.',
  loadedDuration:
    'Time spent loaded, from Loaded Truck / Offload MiX events (intervals capped when offload is missing). Separate from utilization, which measures working vs idle while in use.',
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
  offline: 'No recent movement — last GPS between 24 hours and 30 days ago.',
  nonOperational: 'Non-operational / Inactive — last GPS older than 30 days.',
} as const;

export type KpiDefinitionKey = keyof typeof KPI_DEFINITIONS;
export type StatusDefinitionKey = keyof typeof STATUS_DEFINITIONS;

/** Display label for a vehicle status — the 'Inactive' status value reads as "Non-Operational" everywhere in the UI. */
export function statusDisplayLabel(status: string): string {
  return status === 'Inactive' ? 'Non-Operational' : status;
}
