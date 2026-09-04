/**
 * Hours-of-Service — continuous-driving-time compliance, served by /api/hos.
 *
 * Rules:
 * 1) 4 hours continuous driving requires a ≥20-minute rest (parked gap between trips).
 * 2) 8 hours continuous rest required inside each rolling 24-hour cycle.
 * 3) ≥24 hours continuous rest within a rolling 7-day week.
 * "Today" = since 00:00 Africa/Lagos — trip drive time is clipped to that day
 * (overnight trips do not dump yesterday’s hours into today).
 */

export type HosStatus = 'compliant' | 'warning' | 'violation';

export type HosRuleId = '4h_continuous' | '8h_24h' | 'weekly_rest';

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
  /** Total driving minutes in the rolling 24h cycle. */
  driveMinutes24h?: number;
  continuousMinutes: number;
  maxContinuousMinutes: number;
  currentBlockMinutes: number;
  /** Longest continuous drive block in the rolling 24h cycle (toward 8h). */
  maxContinuous24hMinutes?: number;
  cycle8hBreaches?: number;
  cycle8hViolation?: boolean;
  cycle8hLimitMinutes?: number;
  /** Minutes since the last >=8h continuous rest ended; 0 = currently in one; null = none found in the lookback. */
  minutesSinceDailyRest?: number | null;
  /** Display fallback when no >=8h rest is found in the lookback. */
  dailyRestElapsedMinutes?: number;
  dailyRestRequiredMinutes?: number;
  dailyRestWindowMinutes?: number;
  dailyRestViolation?: boolean;
  /** Longest off-duty gap in the rolling 7-day week. */
  longestRestWeekMinutes?: number;
  weeklyRestRequiredMinutes?: number;
  weeklyRestWindowMinutes?: number;
  weeklyRestOk?: boolean;
  /** Minutes since the last >=24h continuous rest ended; 0 = currently in one; null = none found in the lookback. */
  minutesSinceWeeklyRest?: number | null;
  /** Display fallback when no >=24h rest is found in the lookback. */
  weeklyRestElapsedMinutes?: number;
  /** Days since last ≥24h continuous rest ended; 0 = in one now; null = none in window. */
  daysSinceWeeklyRest?: number | null;
  /** Rolling 7-day weekly-rest lookback window. */
  weeklyRestLookbackStart?: string;
  weeklyRestLookbackEnd?: string;
  /** Last qualifying 24h continuous off-duty rest inside the lookback window. */
  weeklyRestStart?: string | null;
  weeklyRestEnd?: string | null;
  rulesBreached?: HosRuleId[];
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
  rules?: {
    continuous4hMinutes: number;
    restGapMinutes: number;
    continuous8hIn24hMinutes: number;
    dailyRestMinutes?: number;
    dailyRestWindowMinutes?: number;
    weeklyRestMinutes: number;
    weeklyRestWindowMinutes?: number;
  };
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

export function hosRuleLabels(rules: HosRuleId[] | undefined): string[] {
  if (!rules?.length) return [];
  return rules.map(r => {
    if (r === '4h_continuous') return '4h continuous';
    if (r === '8h_24h') return 'Daily rest';
    if (r === 'weekly_rest') return 'No 24h weekly rest';
    return r;
  });
}
