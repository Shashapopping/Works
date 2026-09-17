import type { EnvironmentContext, IndustryCitation, SafeIQAnalysis, Severity } from '../hooks/useSafeIQ';
import { isOverspeedLabel } from './overspeedFilter';
import { fmtHosMinutes, type HosRecord, type HosRuleId } from './hos';

const KNOWLEDGE_VERSION = 'safeiq-responses-v4';
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
  industry_citations?: IndustryCitation[];
  coaching_recommendation: string;
}

const analysisCache = new Map<string, SafeIQAnalysis>();

const CITE = {
  highwayCodeWet: {
    label: 'UK Highway Code R227',
    url: 'https://www.gov.uk/guidance/the-highway-code/driving-in-adverse-weather-conditions-226-to-237',
    note: 'Wet weather: stopping distances at least double dry roads because tyres have less grip.',
  },
  highwayCodeGap: {
    label: 'UK Highway Code R126',
    url: 'https://www.gov.uk/guidance/the-highway-code/general-rules-techniques-and-advice-for-all-drivers-and-riders-103-to-158',
    note: 'Following gap must be at least doubled on wet roads (up to 10× on ice).',
  },
  fhwaWet: {
    label: 'FHWA wet-weather SSD',
    url: 'https://highways.dot.gov/safety/speed-management/guidelines-use-variable-speed-limit-systems-wet-weather/chapter-2-driver',
    note: 'Lower tyre–pavement adhesion on wet roads lengthens braking and stopping sight distance.',
  },
  nhtsaRearEnd: {
    label: 'NHTSA 100-Car rear-end',
    url: 'https://www.nhtsa.gov/document/analyses-rear-end-crashes-and-near-crashes-100-car-naturalistic-driving-study-support-rear',
    note: 'Lead/follow conflicts on wet roads were more likely to become crashes or near-crashes than on dry roads.',
  },
  texasRainRisk: {
    label: 'Texas rainfall crash risk',
    url: 'https://pubmed.ncbi.nlm.nih.gov/41120689/',
    note: 'Matched-pair study (Texas 2006–2021): precipitation raised crash risk ~32–38% on average.',
  },
  trrWetBrake: {
    label: 'TRR wet-pavement braking',
    url: 'https://journals.sagepub.com/doi/10.1177/0361198119832886',
    note: 'Water film on pavement raises crash rates; wet friction and hydrodynamics lengthen braking distance.',
  },
} as const satisfies Record<string, IndustryCitation>;

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
    env.weather_condition ?? '',
    env.traffic_density,
    env.traffic_delay_pct ?? '',
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
  return /rain|wet|storm|thunder|fog|mist|harmattan|dust|flood|slippery|drizzle|shower/.test(blob);
}

/** Rain / wet pavement — grip and stopping-distance risk. */
function isWetRoad(env: EnvironmentContext): boolean {
  const blob = `${env.weather} ${env.weather_condition ?? ''}`.toLowerCase();
  if ((env.precipitation_mm ?? 0) > 0) return true;
  return /rain|drizzle|wet|storm|thunder|flood|shower|slippery/.test(blob);
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

function speedHeadline(e: SafeIqEventInput): string {
  const { speed, limit, excess } = speedBits(e);
  const loc = locationOf(e);
  if (speed != null && limit != null && excess != null) {
    return `${speed} km/h vs posted ${limit} (${excess} km/h over) at ${loc}`;
  }
  if (speed != null) return `${speed} km/h logged overspeed at ${loc}`;
  return `Overspeed logged at ${loc}`;
}

function countClause(input: ComposeSafeIqInput): string {
  const n = input.driverIncidents30Days;
  const trend = input.driverTrend;
  if (trend === 'declining') {
    return `${driverOf(input.event)}: ${n} events in 7 days, down vs prior week.`;
  }
  if (n >= INTERVENTION_INCIDENTS) {
    return `${driverOf(input.event)}: ${n} events in 7 days — documentation mark.`;
  }
  return `${driverOf(input.event)}: ${n} event${n === 1 ? '' : 's'} in 7 days (${trend}).`;
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
    'Overspeed is a documented breach when MiX logs it at ≥60 km/h (same floor as the map). First offence: record and coach; repeat inside 14 days: formal review.',
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
  const grip = isWetRoad(env)
    ? 'Wet roads cut tyre grip — UK Highway Code: stopping distance at least doubles vs dry.'
    : 'Low visibility or dust can hide gaps; slow down and open the gap.';
  return {
    severity_reason: `${weatherLabel(env)} at the scene — contributing condition for this ${event}.`,
    root_cause: `${weatherLabel(env)}${precip} on a ${roadPhrase(env.road_type)} at ${loc}. ${grip} This ${event} happened in that weather. ${countClause(input)}`,
    industry_reference: INDUSTRY.weather,
    industry_citations: isWetRoad(env) ? [CITE.highwayCodeWet, CITE.fhwaWet] : undefined,
    coaching_recommendation: 'Remind the wet-road gap (double the dry following distance). Escalate only if the same weather band keeps repeating.',
  };
}

function trafficCopy(input: ComposeSafeIqInput): StyleCopy {
  const env = input.environment;
  const delay = env.traffic_delay_pct != null && env.traffic_delay_pct >= 25
    ? ` Delay ~${Math.round(env.traffic_delay_pct)}% vs free flow.`
    : '';
  const desc = env.traffic_description?.trim();
  return {
    severity_reason: `Heavy/congested traffic at this ${eventLabel(input.event)} — rear-end exposure up.`,
    root_cause: `Traffic ${env.traffic_density} on a ${roadPhrase(env.road_type)} at ${locationOf(input.event)}.${delay}${desc ? ` ${desc}.` : ''} Gaps close fast in a queue. ${countClause(input)}`,
    industry_reference: INDUSTRY.traffic,
    industry_citations: [CITE.nhtsaRearEnd],
    coaching_recommendation: 'Coach holding gap in slow traffic. If harsh events stack only in congestion, look at route timing.',
  };
}

function speedingCopy(input: ComposeSafeIqInput): StyleCopy {
  const env = input.environment;
  const wet = isWetRoad(env);
  const congested = isTrafficMaterial(env);
  const { excess } = speedBits(input.event);
  const headline = speedHeadline(input.event);
  const weather = weatherLabel(env);
  const modest = excess == null || excess < 15;

  // Wet + congested traffic + speeding — distinct from rain-only.
  if (wet && congested) {
    return {
      severity_reason: `Overspeed in ${weather.toLowerCase()} and ${env.traffic_density} traffic — wet grip loss plus closed gaps.`,
      root_cause: `${headline}. Rain/wet pavement stretches stopping distance; ${env.traffic_density} traffic closes the gap ahead. Together that is a rear-end setup, not a speed-only card. ${countClause(input)}`,
      industry_reference:
        'UK Highway Code Rule 227: wet stopping distances are at least double dry because tyres lose grip. Rule 126: double the following gap on wet roads. NHTSA’s 100-Car study found lead/follow conflicts on wet roads more often became crashes or near-crashes than the same conflicts on dry roads. Congestion removes the extra space wet roads need — speeding in rain and traffic stacks both risks.',
      industry_citations: [CITE.highwayCodeWet, CITE.highwayCodeGap, CITE.nhtsaRearEnd, CITE.texasRainRisk],
      coaching_recommendation: modest
        ? 'Coach: slow earlier in rain, hold a double gap in queues. Document this row; a second wet/traffic overspeed inside 14 days → formal review.'
        : 'Document the excess. Pre-shift talk: wet + traffic means leave earlier and leave more space. Repeat inside 14 days → formal review.',
    };
  }

  // Wet / rain + speeding (open road or light/moderate traffic).
  if (wet) {
    return {
      severity_reason: `Overspeed in ${weather.toLowerCase()} — wet roads and speed do not mix.`,
      root_cause: `${headline} during ${weather.toLowerCase()}. Water cuts tyre grip; the same speed that feels fine dry leaves far less room to stop. ${countClause(input)}`,
      industry_reference:
        'UK Highway Code Rule 227: in wet weather, stopping distances are at least double those on dry roads because tyres have less grip. FHWA wet-weather guidance: lower tyre–pavement adhesion lengthens braking distance. TRR wet-pavement work links water film to longer braking and higher crash rates. Speeding removes the margin those rules exist to protect.',
      industry_citations: [CITE.highwayCodeWet, CITE.fhwaWet, CITE.trrWetBrake, CITE.texasRainRisk],
      coaching_recommendation: modest
        ? 'Brief coaching: ease off in rain; treat posted speed as a dry-road ceiling, not a wet target. Second wet overspeed in 14 days → formal review.'
        : 'Document and talk wet-road speed before the next shift. Repeat inside 14 days → formal review.',
    };
  }

  // Dry / clear speeding.
  return {
    severity_reason: excess != null
      ? `${excess} km/h over posted — documented overspeed.`
      : 'Logged overspeed — document and coach.',
    root_cause: `${headline}. Conditions ${weather.toLowerCase()}, traffic ${env.traffic_density}. This card is speed control, not weather. ${countClause(input)}`,
    industry_reference: INDUSTRY.speeding,
    coaching_recommendation: modest
      ? 'Document and a short corridor-limit reminder before next shift. Second overspeed in 14 days → formal review.'
      : 'Document the excess and review the corridor limit. Repeat inside 14 days → formal review.',
  };
}

function trendCopy(input: ComposeSafeIqInput): StyleCopy {
  const n = input.driverIncidents30Days;
  const driver = driverOf(input.event);
  const event = eventLabel(input.event);
  if (input.driverTrend === 'declining' || n >= INTERVENTION_INCIDENTS) {
    return {
      severity_reason: n >= INTERVENTION_INCIDENTS
        ? `${n} events in 7 days — frequency documentation mark.`
        : `Week-over-week score down ≥5% (${n} events in 7 days).`,
      root_cause: `${driver}: ${n} events in 7 days (${input.driverTrend}) after this ${event} at ${locationOf(input.event)}. Lead reading is the count, not a single-moment story. ${weatherLabel(input.environment)}, traffic ${input.environment.traffic_density}.`,
      industry_reference: INDUSTRY.trend,
      coaching_recommendation: n >= INTERVENTION_INCIDENTS
        ? 'Documented coaching / refresher is the usual step at this count. Watch the next few weeks.'
        : 'Note the event; closer watch for a few weeks. Escalate at eight-in-7-days.',
    };
  }
  return {
    severity_reason: `Isolated ${event} — ${input.driverTrend} 7-day record (${n}).`,
    root_cause: `${event} at ${locationOf(input.event)}; ${n} event${n === 1 ? '' : 's'} in 7 days (${input.driverTrend}). Weather ${weatherLabel(input.environment).toLowerCase()}, traffic ${input.environment.traffic_density}. Treat as one row unless it repeats.`,
    industry_reference: INDUSTRY.trend,
    coaching_recommendation: 'Document. No extra intervention from this row alone.',
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
    severity_reason: `HOS rest skipped (${rule === '4h_continuous' ? '4h continuous' : rule === '8h_24h' ? 'daily rest' : 'weekly rest'}). Fatigue-risk flag — not proof this ${event} was caused by fatigue.`,
    root_cause: `${lead}${extra} This ${event} at ${locationOf(input.event)} is on the same shift. ${countClause(input)}`,
    industry_reference: INDUSTRY.hos,
    coaching_recommendation: rule === 'weekly_rest'
      ? 'Full day off before the next long block. Keep on file; not a fatigue-crash finding unless investigation says so.'
      : rule === '8h_24h'
        ? 'No long block until 8-hour continuous rest is done. Rest skip + event are two facts, not one cause chain.'
        : 'Park for a qualifying 20-minute rest. If 4h skips repeat, look at dispatch spacing.',
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
  const wet = isWetRoad(input.environment);
  const congested = isTrafficMaterial(input.environment);

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

  if (style === 'speeding' && wet && congested) {
    return {
      severity: 'YELLOW',
      ops: true,
      opsReason: `${driverOf(input.event)} oversped in wet weather and congested traffic. Worth a supervisor look at the next wet-weather assignment — rear-end exposure is elevated.`,
    };
  }

  if (style === 'speeding' && wet) {
    return {
      severity: 'YELLOW',
      ops: false,
      opsReason: '',
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
  const citations = Array.isArray(analysis.industry_citations)
    ? analysis.industry_citations.filter(c => c?.label && c?.url)
    : undefined;
  return {
    severity,
    severity_reason: analysis.severity_reason?.trim() || 'Severity assigned from local event rules.',
    root_cause: analysis.root_cause?.trim() || 'Event recorded; no further write-up is available in the current view.',
    industry_reference: analysis.industry_reference?.trim() || INDUSTRY.trend,
    industry_citations: citations?.length ? citations : undefined,
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
    industry_citations: copy.industry_citations,
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
