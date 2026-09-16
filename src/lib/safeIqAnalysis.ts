import type { EnvironmentContext, SafeIQAnalysis, Severity } from '../hooks/useSafeIQ';
import { isOverspeedLabel } from './overspeedFilter';
import { fmtHosMinutes, type HosRecord, type HosRuleId } from './hos';

const KNOWLEDGE_VERSION = 'safeiq-responses-v3';
const INTERVENTION_INCIDENTS = 8;

export type SafeIqResponseStyle = 'weather' | 'traffic' | 'speeding' | 'trend' | 'hos';

export interface SafeIqEventInput {
  eventId?: string;
  label?: string;
  type: string;
  driverName?: string;
  regNo?: string;
  assetId: string;
  address?: string;
  eventTime: string;
  speed?: number | null;
  speedLimit?: number | null;
}

export interface SafeIqVehicleInput {
  id: string;
  type?: string;
  last_maintenance?: string;
  make?: string;
  model?: string;
  site?: string;
  zone?: string;
}

export interface ComposeSafeIqInput {
  event: SafeIqEventInput;
  driverIncidents30Days: number;
  driverTrend: 'improving' | 'stable' | 'declining';
  environment: EnvironmentContext;
  vehicle?: SafeIqVehicleInput | null;
  hos?: HosRecord | null;
}

interface StyleCopy {
  severity_reason: string;
  root_cause: string;
  industry_reference: string;
  coaching_recommendation: string;
}

const analysisCache = new Map<string, SafeIQAnalysis>();

function cacheKey(input: ComposeSafeIqInput): string {
  const e = input.event;
  const env = input.environment;
  const hos = input.hos;
  return [
    KNOWLEDGE_VERSION,
    e.eventId || `${e.assetId}:${e.eventTime}:${e.label}`,
    e.label,
    input.driverIncidents30Days,
    input.driverTrend,
    env.weather,
    env.traffic_density,
    e.speed ?? '',
    e.speedLimit ?? '',
    hos?.status ?? '',
    hos?.rulesBreached?.join(',') ?? '',
    hos?.violationDriveMinutes ?? '',
    hos?.dailyRestElapsedMinutes ?? '',
    hos?.daysSinceWeeklyRest ?? '',
  ].join('|');
}

function locationOf(e: SafeIqEventInput): string {
  return e.address?.trim() || 'the recorded location';
}

function driverOf(e: SafeIqEventInput): string {
  return e.driverName?.trim() || 'This driver';
}

function eventLabel(e: SafeIqEventInput): string {
  return e.label || (e.type === 'panic' ? 'panic alert' : 'event');
}

function roadPhrase(road?: EnvironmentContext['road_type']): string {
  if (road === 'urban') return 'urban corridor';
  if (road === 'rural') return 'rural route';
  return 'highway';
}

function weatherLabel(env: EnvironmentContext): string {
  if (env.weather_condition && env.weather_condition !== 'Unknown') return env.weather_condition;
  return env.weather || 'unrecorded weather';
}

function isAdverseWeather(env: EnvironmentContext): boolean {
  const blob = `${env.weather} ${env.weather_condition ?? ''}`.toLowerCase();
  if ((env.precipitation_mm ?? 0) > 0) return true;
  return /rain|wet|storm|thunder|fog|mist|harmattan|dust|flood|slippery/.test(blob);
}

function isTrafficMaterial(env: EnvironmentContext): boolean {
  if (env.traffic_density === 'heavy') return true;
  if ((env.traffic_delay_pct ?? 0) >= 25) return true;
  return /heavy|congest|slow|queue|jam|peak/.test((env.traffic_description ?? '').toLowerCase());
}

function isSpeedingEvent(e: SafeIqEventInput): boolean {
  return isOverspeedLabel(e.label);
}

function isIdleEvent(label?: string): boolean {
  return /idle/i.test(label || '');
}

function speedBits(e: SafeIqEventInput): { speed: number | null; limit: number | null; excess: number | null } {
  const speed = e.speed != null && Number.isFinite(e.speed) ? Math.round(e.speed) : null;
  const limit = e.speedLimit != null && Number.isFinite(e.speedLimit) ? Math.round(e.speedLimit) : null;
  const excess = speed != null && limit != null ? speed - limit : null;
  return { speed, limit, excess };
}

function countClause(input: ComposeSafeIqInput): string {
  const n = input.driverIncidents30Days;
  const trend = input.driverTrend;
  if (trend === 'declining') {
    return `${driverOf(input.event)} has ${n} scored events in the last 7 days, down versus the prior week — a cluster, not proof of a single cause.`;
  }
  if (n >= INTERVENTION_INCIDENTS) {
    return `${driverOf(input.event)} is at ${n} events in 7 days, which is the usual documentation mark, not an automatic ban.`;
  }
  return `${driverOf(input.event)} has ${n} event${n === 1 ? '' : 's'} in the last 7 days (${trend}).`;
}

function hosIsSkipped(hos?: HosRecord | null): boolean {
  if (!hos) return false;
  if (hos.status === 'violation') return true;
  if ((hos.breaches ?? 0) > 0) return true;
  if (hos.dailyRestViolation) return true;
  if (hos.weeklyRestOk === false) return true;
  if (hos.rulesBreached?.length) return true;
  return false;
}

function hosRules(hos: HosRecord): HosRuleId[] {
  if (hos.rulesBreached?.length) return hos.rulesBreached;
  const rules: HosRuleId[] = [];
  if ((hos.breaches ?? 0) > 0 || (hos.violationDriveMinutes ?? 0) > 0) rules.push('4h_continuous');
  if (hos.dailyRestViolation) rules.push('8h_24h');
  if (hos.weeklyRestOk === false) rules.push('weekly_rest');
  return rules;
}

function primaryHosRule(hos: HosRecord): HosRuleId {
  const rules = hosRules(hos);
  if (rules.includes('weekly_rest')) return 'weekly_rest';
  if (rules.includes('8h_24h')) return '8h_24h';
  return '4h_continuous';
}

function dailyOverMinutes(hos: HosRecord): number {
  const window = hos.dailyRestWindowMinutes || 1440;
  const elapsed = hos.dailyRestElapsedMinutes
    ?? hos.minutesSinceDailyRest
    ?? 0;
  return Math.max(0, elapsed - window);
}

function weeklyOverMinutes(hos: HosRecord): number {
  const window = hos.weeklyRestWindowMinutes || (7 * 24 * 60);
  const elapsed = hos.weeklyRestElapsedMinutes
    ?? (hos.daysSinceWeeklyRest == null ? 0 : hos.daysSinceWeeklyRest * 24 * 60);
  return Math.max(0, elapsed - window);
}

export function selectResponseStyle(input: ComposeSafeIqInput): SafeIqResponseStyle {
  if (hosIsSkipped(input.hos)) return 'hos';
  if (isSpeedingEvent(input.event)) return 'speeding';
  if (isAdverseWeather(input.environment)) return 'weather';
  if (isTrafficMaterial(input.environment)) return 'traffic';
  return 'trend';
}

const INDUSTRY: Record<SafeIqResponseStyle, string> = {
  weather:
    'FRSC Highway Code §14(3) sets minimum following distances in adverse weather and notes that wet-road stopping distance can increase by about 40% versus dry running. That is a condition to account for; it is not, by itself, a finding that this driver was at fault. FMCSA unsafe-driving guidance treats weather as context for following distance, not as a standalone offence.',
  traffic:
    'In congested running, rear-end exposure rises when gaps close. FRSC following-distance guidance still applies in traffic; FMCSA unsafe-driving reviews look at harsh-event frequency, not at a single queue. Heavy traffic explains why a gap can collapse. It does not prove aggressive driving on its own.',
  speeding:
    'FRSC Speed Monitoring Guidelines treat a recorded speed above the posted or zone limit as a documented breach. This fleet only surfaces those MiX overspeed events when recorded speed is at least 60 km/h — the same floor as the map. FMCSA BASIC unsafe-driving practice is to record a first speed offence and to review if it repeats inside 14 days. The figure is the excess over the telematics limit on that event. It is not an estimate of crash probability.',
  trend:
    'Carriers commonly treat eight scored events in a short window as the point to document and coach (FMCSA BASIC unsafe-driving frequency). Below that mark, the usual step is to note the event. A declining label here means implied score fell at least 5% week-over-week. It is not a verdict on this one row.',
  hos:
    'This fleet’s HOS rules are: 4 hours continuous driving needs a ≥20-minute rest; 8 hours continuous rest inside each rolling 24 hours; 24 hours continuous off-duty rest inside each rolling 7 days. A skipped rest is a logged hours breach on the Fatigue page. It is a fatigue risk marker for this shift. It does not prove that fatigue caused this event.',
};

function weatherCopy(input: ComposeSafeIqInput): StyleCopy {
  const env = input.environment;
  const loc = locationOf(input.event);
  const event = eventLabel(input.event);
  const precip = env.precipitation_mm != null && env.precipitation_mm > 0
    ? `, with ${Math.round(env.precipitation_mm)} mm precipitation`
    : '';
  const grip = /rain|wet|storm|flood|slippery/.test(weatherLabel(env).toLowerCase())
    || (env.precipitation_mm ?? 0) > 0
    ? 'Wet or low-grip running lengthens stopping distance versus a dry baseline — on the order of 40% in FRSC wet-road notes.'
    : 'Low visibility or dust can hide gaps; it does not change the posted limit.';
  return {
    severity_reason: `Weather at the scene was ${weatherLabel(env)}. That is a contributing condition for this ${event}, not a severity upgrade on its own.`,
    root_cause: `At ${loc} conditions were ${weatherLabel(env).toLowerCase()}${precip} on a ${roadPhrase(env.road_type)}. ${grip} This ${event} happened in that weather. ${countClause(input)} Weather is the lead reading here; it is not proven as the sole cause.`,
    industry_reference: INDUSTRY.weather,
    coaching_recommendation: 'Depending on your policy, a short reminder on following distance in this weather (the 4-second wet-road gap is the usual talking point) is enough for a first pass. Recurring events in the same weather band are when a longer coaching session is typically considered — not after one row.',
  };
}

function trafficCopy(input: ComposeSafeIqInput): StyleCopy {
  const env = input.environment;
  const delay = env.traffic_delay_pct != null && env.traffic_delay_pct >= 25
    ? ` Delay versus free flow was about ${Math.round(env.traffic_delay_pct)}%.`
    : '';
  const desc = env.traffic_description?.trim();
  return {
    severity_reason: `Traffic was ${env.traffic_density} at the time of this ${eventLabel(input.event)}. Congestion raises rear-end exposure; it does not by itself make this a RED card.`,
    root_cause: `Traffic density was ${env.traffic_density} on this ${roadPhrase(env.road_type)} at ${locationOf(input.event)}.${delay}${desc ? ` Reported as ${desc}.` : ''} In a stream of vehicles a ${eventLabel(input.event)} more often means a closed gap than an empty-road mistake. ${countClause(input)} Traffic is the lead reading. It is not evidence of intent.`,
    industry_reference: INDUSTRY.traffic,
    coaching_recommendation: 'A coaching note on holding a gap in slow or heavy traffic is the usual first step. If the same driver keeps stacking harsh events only in congestion, look at route timing — not at a one-off queue.',
  };
}

function speedingCopy(input: ComposeSafeIqInput): StyleCopy {
  const { speed, limit, excess } = speedBits(input.event);
  const loc = locationOf(input.event);
  const speedLine = speed != null && limit != null && excess != null
    ? `Recorded speed was ${speed} km/h against a posted ${limit} km/h (${excess} km/h over) at ${loc}.`
    : speed != null
      ? `Recorded speed was ${speed} km/h at ${loc}. A posted limit is not in this view, so excess cannot be stated.`
      : `This is logged as ${eventLabel(input.event)} at ${loc}; a numeric speed is not in this view.`;
  const modest = excess != null && excess < 15;
  return {
    severity_reason: excess != null
      ? `${excess} km/h over the posted limit is a documented breach. ${modest ? 'That size of excess is usually a coaching card, not an automatic RED.' : 'This excess is large enough to document and review.'}`
      : 'A speeding label is present without a full speed/limit pair — treat as a recorded event, not as a calculated excess.',
    root_cause: `${speedLine} Weather was ${weatherLabel(input.environment)} and traffic ${input.environment.traffic_density} — conditions at the time, not an explanation that cancels the limit. ${countClause(input)} The problem this card states is the speed relative to the posted limit on this event. It does not estimate crash risk.`,
    industry_reference: INDUSTRY.speeding,
    coaching_recommendation: modest
      ? 'Document the event and a brief pre-shift reminder on this corridor’s limit is the usual first response. A second speeding event inside 14 days is when a formal review is typically opened — not on this row alone.'
      : 'Document the excess and talk through the corridor limit before the next shift. If this repeats inside 14 days, a formal review is the usual next step under carrier practice — still a process step, not a dismissal.',
  };
}

function trendCopy(input: ComposeSafeIqInput): StyleCopy {
  const n = input.driverIncidents30Days;
  const driver = driverOf(input.event);
  const event = eventLabel(input.event);
  if (input.driverTrend === 'declining' || n >= INTERVENTION_INCIDENTS) {
    return {
      severity_reason: n >= INTERVENTION_INCIDENTS
        ? `${n} events in 7 days meets the usual documentation mark. This card is about frequency, not about a proven root cause for this one ${event}.`
        : `Week-over-week implied score is down at least 5% (${n} events in the last 7 days). That is a pattern watch, not a single-event verdict.`,
      root_cause: `${driver} has ${n} scored events in the last 7 days (${input.driverTrend}) against this latest ${event} at ${locationOf(input.event)}. Conditions were ${weatherLabel(input.environment)}, traffic ${input.environment.traffic_density}. The lead reading is the accumulating count versus the prior week, not a reconstructed story of this one moment. A cluster is a reason to coach. It is not a finding of intent or of a mechanical fault.`,
      industry_reference: INDUSTRY.trend,
      coaching_recommendation: n >= INTERVENTION_INCIDENTS
        ? 'Depending on your policy, a documented coaching or short refresher window is the usual step at this count. Keep watching the next few weeks rather than treating this row as the whole case.'
        : 'Note the event and keep a closer eye over the next few weeks. A one-off conversation is enough until the count actually crosses the usual eight-in-7-days mark.',
    };
  }
  return {
    severity_reason: `Isolated ${event} against a ${input.driverTrend} 7-day record (${n} events). Observational, not an escalation.`,
    root_cause: `This ${event} at ${locationOf(input.event)} sits against ${n} scored event${n === 1 ? '' : 's'} in the last 7 days (${input.driverTrend}). Weather ${weatherLabel(input.environment).toLowerCase()}, traffic ${input.environment.traffic_density}. Nothing in the current view shows a weather, traffic, speed, or HOS breach as the lead problem. Treat it as one recorded row unless it repeats.`,
    industry_reference: INDUSTRY.trend,
    coaching_recommendation: 'Document the event. No extra intervention is implied from this record alone. Bring it up in the next routine coaching conversation if you already have one scheduled.',
  };
}

function hosCopy(input: ComposeSafeIqInput): StyleCopy {
  const hos = input.hos!;
  const driver = driverOf(input.event);
  const event = eventLabel(input.event);
  const rule = primaryHosRule(hos);
  const others = hosRules(hos).filter(r => r !== rule);

  let lead: string;
  let hoursNote: string;
  if (rule === '4h_continuous') {
    const over = Math.max(0, hos.violationDriveMinutes ?? 0);
    const block = hos.currentBlockMinutes || hos.continuousMinutes || hos.maxContinuousMinutes;
    const limit = hos.driveLimitMinutes || 240;
    hoursNote = over < 20
      ? `the 4-hour continuous block was just exceeded (about ${fmtHosMinutes(over)} over; block ${fmtHosMinutes(block)} vs ${fmtHosMinutes(limit)}). A ≥20-minute rest had not reset it.`
      : over < 60
        ? `continuous driving ran about ${fmtHosMinutes(over)} past the 4-hour cap (block ${fmtHosMinutes(block)}). The 20-minute rest was skipped on this block.`
        : `continuous driving was held about ${fmtHosMinutes(over)} past the 4-hour cap (block ${fmtHosMinutes(block)}). That is an extended skip of the 20-minute rest, still a hours breach — not a crash finding.`;
    lead = `${driver} skipped the dashboard 4-hour continuous HOS rule: ${hoursNote}`;
  } else if (rule === '8h_24h') {
    const since = hos.dailyRestElapsedMinutes ?? hos.minutesSinceDailyRest ?? 0;
    const over = dailyOverMinutes(hos);
    hoursNote = over > 0
      ? `about ${fmtHosMinutes(since)} since the last 8-hour rest, which is ${fmtHosMinutes(over)} past the 24-hour cycle.`
      : `daily rest is marked skipped (8 hours continuous rest inside 24 hours). Elapsed since last qualifying rest: ${fmtHosMinutes(since)}.`;
    lead = `${driver} skipped the dashboard daily HOS rest: ${hoursNote}`;
  } else {
    const days = hos.daysSinceWeeklyRest;
    const over = weeklyOverMinutes(hos);
    hoursNote = days != null
      ? `${days} day${days === 1 ? '' : 's'} since the last 24-hour off-duty rest${over > 0 ? ` (${fmtHosMinutes(over)} past the 7-day window)` : ''}.`
      : `no qualifying 24-hour rest in the rolling 7-day window.`;
    lead = `${driver} skipped the dashboard weekly HOS rest: ${hoursNote}`;
  }

  const extra = others.length
    ? ` Also flagged: ${others.map(r => (r === '4h_continuous' ? '4h continuous' : r === '8h_24h' ? 'daily rest' : 'weekly rest')).join(', ')}.`
    : '';

  return {
    severity_reason: `HOS rest was skipped (${rule === '4h_continuous' ? '4h continuous' : rule === '8h_24h' ? 'daily rest' : 'weekly rest'}). That is a fatigue-risk flag on this shift. It does not, by itself, grade this ${event} as a crash.`,
    root_cause: `${lead}${extra} This ${event} at ${locationOf(input.event)} is logged on that same shift. Skipped hours are a reason to pause the assignment and recover rest. They are not proof that fatigue caused this ${event}. ${countClause(input)}`,
    industry_reference: INDUSTRY.hos,
    coaching_recommendation:
      rule === 'weekly_rest'
        ? 'The practical step is a full day off before the next long block — that is the weekly-rest recovery, not a disciplinary finding. Keep the event on file; do not write it up as a fatigue crash unless a separate investigation says so.'
        : rule === '8h_24h'
          ? 'Do not assign another long block until an 8-hour continuous rest is completed. Talk through the daily-rest rule. This card is a rest skip plus an event on the same shift, not a proven cause chain.'
          : 'Park for a qualifying 20-minute rest before the next driving block. If the 4h skip keeps repeating, look at dispatch spacing. One skipped rest plus this event is still two facts, not one confirmed cause.',
  };
}

function copyForStyle(style: SafeIqResponseStyle, input: ComposeSafeIqInput): StyleCopy {
  if (style === 'hos') return hosCopy(input);
  if (style === 'speeding') return speedingCopy(input);
  if (style === 'weather') return weatherCopy(input);
  if (style === 'traffic') return trafficCopy(input);
  return trendCopy(input);
}

function severityFor(style: SafeIqResponseStyle, input: ComposeSafeIqInput): { severity: Severity; ops: boolean; opsReason: string } {
  const n = input.driverIncidents30Days;
  const panic = input.event.type === 'panic' || input.event.label === 'Panic';
  const { excess } = speedBits(input.event);

  if (panic) {
    return {
      severity: 'RED',
      ops: true,
      opsReason: 'Panic is an incident record. Supervisor contact and a vault file are the usual next steps — separate from coaching copy.',
    };
  }

  if (style === 'hos') {
    const rule = input.hos ? primaryHosRule(input.hos) : '4h_continuous';
    const heavy = rule === 'weekly_rest' || (rule === '4h_continuous' && (input.hos?.violationDriveMinutes ?? 0) >= 60)
      || (rule === '8h_24h' && dailyOverMinutes(input.hos!) >= 180);
    return {
      severity: heavy ? 'RED' : 'YELLOW',
      ops: true,
      opsReason: heavy
        ? `${driverOf(input.event)} skipped a substantial HOS rest. A supervisor may want to take them off the next long assignment until rest is recovered.`
        : `${driverOf(input.event)} skipped dashboard HOS. Worth a supervisor look at the next shift plan; not an automatic off-road.`,
    };
  }

  if (n >= INTERVENTION_INCIDENTS) {
    return {
      severity: 'RED',
      ops: true,
      opsReason: `${driverOf(input.event)} is at ${n} events in 7 days. A supervisor review of the next few shifts is reasonable. That is a frequency flag, not a charge sheet.`,
    };
  }

  if (style === 'speeding' && excess != null && excess >= 20) {
    return {
      severity: 'YELLOW',
      ops: false,
      opsReason: '',
    };
  }

  if (isIdleEvent(input.event.label) && input.driverTrend !== 'declining' && n < INTERVENTION_INCIDENTS) {
    return { severity: 'GREEN', ops: false, opsReason: '' };
  }

  if (style === 'trend' && input.driverTrend !== 'declining' && n < 3) {
    return { severity: 'GREEN', ops: false, opsReason: '' };
  }

  return { severity: 'YELLOW', ops: false, opsReason: '' };
}

export function validateSafeIqAnalysis(analysis: SafeIQAnalysis): SafeIQAnalysis {
  const severity: Severity = analysis.severity === 'RED' || analysis.severity === 'YELLOW' || analysis.severity === 'GREEN'
    ? analysis.severity
    : 'YELLOW';
  const ops = Boolean(analysis.ops_flag);
  return {
    severity,
    severity_reason: analysis.severity_reason?.trim() || 'Severity assigned from local event rules.',
    root_cause: analysis.root_cause?.trim() || 'Event recorded; no further write-up is available in the current view.',
    industry_reference: analysis.industry_reference?.trim() || INDUSTRY.trend,
    coaching_recommendation: analysis.coaching_recommendation?.trim() || 'Document the event and review it at the next coaching conversation.',
    ops_flag: ops,
    ops_flag_reason: ops
      ? (analysis.ops_flag_reason?.trim() || 'Supervisor review may be warranted.')
      : '',
  };
}

/**
 * Fill the bottom SafeIQ Analysis block from one of five response styles.
 * Facts on the card are inputs. This function only writes the paragraphs.
 */
export function composeSafeIqAnalysis(input: ComposeSafeIqInput): SafeIQAnalysis {
  const key = cacheKey(input);
  const cached = analysisCache.get(key);
  if (cached) return cached;

  const style = selectResponseStyle(input);
  const copy = copyForStyle(style, input);
  const { severity, ops, opsReason } = severityFor(style, input);

  const analysis = validateSafeIqAnalysis({
    severity,
    severity_reason: copy.severity_reason,
    root_cause: copy.root_cause,
    industry_reference: copy.industry_reference,
    coaching_recommendation: copy.coaching_recommendation,
    ops_flag: ops,
    ops_flag_reason: opsReason,
  });

  analysisCache.set(key, analysis);
  if (analysisCache.size > 200) {
    const first = analysisCache.keys().next().value;
    if (first) analysisCache.delete(first);
  }
  return analysis;
}

export function findHosForEvent(
  records: HosRecord[] | undefined,
  e: { driverName?: string; assetId?: string; regNo?: string },
): HosRecord | null {
  if (!records?.length) return null;
  const name = e.driverName?.trim().toLowerCase();
  const asset = e.assetId != null ? String(e.assetId) : '';
  const reg = e.regNo?.trim();
  return records.find(r => {
    if (name && r.driverName?.trim().toLowerCase() === name) return true;
    if (asset && r.assetId != null && String(r.assetId) === asset) return true;
    if (reg && r.vehicleReg === reg) return true;
    return false;
  }) ?? null;
}
