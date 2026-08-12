/**
 * Hours-of-Service — continuous-driving-time compliance, served by /api/hos.
 * Rule: 4 hours continuous driving requires a >=30-minute rest. A rest is a >=30 min gap
 * between trips (vehicle parked). "Today" = since 00:00 Africa/Lagos.
 */

export type HosStatus = 'compliant' | 'warning' | 'violation';

export interface HosViolationEvent {
  breachAt: string;
  violationDriveMinutes: number;
  violationTripMinutes: number;
}

export interface HosRecord {
  id: string;
  driverName: string;
  vehicleReg: string;
  site: string;
  driveMinutesToday: number;
  dutyMinutesToday: number;
  continuousMinutes: number;
  maxContinuousMinutes: number;
  currentBlockMinutes: number;
  breaches: number;
  violationDriveMinutes: number;
  violationTripMinutes: number;
  violationHistory: HosViolationEvent[];
  driveLimitMinutes: number;
  dutyLimitMinutes: number;
  restMinutesRemaining: number;
  status: HosStatus;
  restDueAt: string | null;
  lastUpdated: string;
}

export interface HosResponse {
  updatedAt: string;
  day: string;
  isToday: boolean;
  /** Most recent Lagos calendar day that has any trip in SQLite (may lag live if trips sync is behind). */
  lastTripDay?: string | null;
  records: HosRecord[];
}

export function buildHosUrl(date?: string): string {
  return date ? `/api/hos?date=${encodeURIComponent(date)}` : '/api/hos';
}

export function fmtHosMinutes(min: number | null | undefined): string {
  if (min == null || !Number.isFinite(min)) return '—';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h <= 0) return `${m}m`;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
