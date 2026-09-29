import type { EnvironmentContext, IndustryCitation, SafeIQAnalysis, Severity } from '../hooks/useSafeIQ';
import { SAFEIQ_SPEED_LIMIT_KMH } from '../config/safeIq';
import { isOverspeedLabel } from './overspeedFilter';
import { fmtHosMinutes, type HosRecord, type HosRuleId } from './hos';

const KNOWLEDGE_VERSION = 'safeiq-responses-v9';
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

/**
 * Industry citations: FRSC first (sole operational advice), then ISO 55001.
 * Each chip is tagged to the SafeIQ section it supports.
 */
const CITE = {
  frscWeather: {
    org: 'FRSC' as const,
    tag: 'weather' as const,
    label: 'FRSC · Weather',
    url: 'https://frsc.gov.ng/wp-content/uploads/2025/04/ARC-COMPENDIUM-2025.pdf',
    note: 'FRSC ARC Compendium §1.5 Driving in the Rain: traction falls on wet roads; stopping distance may become four or more times longer than dry. Reduce speed and increase following distance.',
  },
  isoWeather: {
    org: 'ISO 55001' as const,
    tag: 'weather' as const,
    label: 'ISO 55001 · Weather',
    url: 'https://www.iso.org/standard/83054.html',
    note: 'ISO 55001:2024 — manage asset risk and opportunities in operations (cl. 6.1 / 8.1). Weather-exposed fleet use is a lifecycle risk to plan and control, not only a one-off driver note.',
  },
  frscTraffic: {
    org: 'FRSC' as const,
    tag: 'traffic' as const,
    label: 'FRSC · Traffic',
    url: 'https://frsc.gov.ng/wp-content/uploads/2025/04/ARC-COMPENDIUM-2025.pdf',
    note: 'FRSC ARC Compendium — convoy / dense traffic: keep safe following distance, avoid tailgating, slow in busy towns. Gaps close; do not chase other road users.',
  },
  isoTraffic: {
    org: 'ISO 55001' as const,
    tag: 'traffic' as const,
    label: 'ISO 55001 · Traffic',
    url: 'https://www.iso.org/transport/fleet-management',
    note: 'ISO fleet-management guidance under ISO 55001 — structured control of utilization risk, route performance, and cost/risk balance across the vehicle lifecycle.',
  },
  frscSpeeding: {
    org: 'FRSC' as const,
    tag: 'speeding' as const,
    label: 'FRSC · Speeding',
    url: 'https://frsc.gov.ng/wp-content/uploads/2021/08/Speed-Limiting-Device-Implementation-in-Nigeria_The-Journey-So-Far.pdf',
    note: 'FRSC Speed Limiting Device implementation — speed limits are maxima under ideal conditions; NRTR Schedule 8 / Reg. 152 sets category limits. Speed control is a documented road-safety duty.',
  },
  frscSpeedingRain: {
    org: 'FRSC' as const,
    tag: 'speeding' as const,
    label: 'FRSC · Speeding (rain)',
    url: 'https://frsc.gov.ng/wp-content/uploads/2025/04/ARC-COMPENDIUM-2025.pdf',
    note: 'FRSC rain guidance: reduce speed in rain; wet stopping distance may be 4× dry. Posted/company maxima assume ideal (dry) conditions.',
  },
  isoSpeeding: {
    org: 'ISO 55001' as const,
    tag: 'speeding' as const,
    label: 'ISO 55001 · Speeding',
    url: 'https://www.iso.org/standard/83054.html',
    note: 'ISO 55001:2024 — balance performance, cost, and risk across the asset lifecycle. Speeding raises operational risk and life-cycle cost (wear, incident exposure) from acquisition through disposal.',
  },
  frscTrend: {
    org: 'FRSC' as const,
    tag: 'trend' as const,
    label: 'FRSC · Trend',
    url: 'https://frsc.gov.ng/wp-content/uploads/2021/08/The-Road-Transport-Safety-Standardization-Scheme-RTSSS.pdf',
    note: 'FRSC RTSSS — fleet operators must run a Safety Unit, train/retrain drivers, keep crash and driver records, and treat driving risk as part of organisational safety policy.',
  },
  isoTrend: {
    org: 'ISO 55001' as const,
    tag: 'trend' as const,
    label: 'ISO 55001 · Trend',
    url: 'https://committee.iso.org/files/live/sites/tc251/files/guidance/ISO%20TC251%20ISO55001%20Rev3.pdf',
    note: 'ISO 55001:2024 overview — data/knowledge, predictive action, and continuous improvement so recurring event patterns trigger planned treatment, not one-off notes only.',
  },
  frscHos: {
    org: 'FRSC' as const,
    tag: 'hos' as const,
    label: 'FRSC · HOS',
    url: 'https://rtsss.frsc.gov.ng/pdf/13_art-20120620125245.pdf',
    note: 'FRSC RTSSS / tanker-trailer safety requirements — Safety Manager enforces rest: ≥8 hours rest in each 24-hour period; drivers must not drive while fatigued; rest after continuous driving blocks.',
  },
  isoHos: {
    org: 'ISO 55001' as const,
    tag: 'hos' as const,
    label: 'ISO 55001 · HOS',
    url: 'https://www.iso.org/standard/83054.html',
    note: 'ISO 55001:2024 — people, competence, and operational control are part of the asset management system. Fatigue risk on utilization is a managed lifecycle risk, not only a shift anecdote.',
  },
} as const satisfies Record<string, IndustryCitation>;

function citesFor(style: SafeIqResponseStyle, variant?: 'wet' | 'wetTraffic'): IndustryCitation[] {
  if (style === 'weather') return [CITE.frscWeather, CITE.isoWeather];
  if (style === 'traffic') return [CITE.frscTraffic, CITE.isoTraffic];
  if (style === 'speeding') {
    if (variant === 'wet' || variant === 'wetTraffic') {
      return [CITE.frscSpeedingRain, CITE.frscSpeeding, CITE.isoSpeeding];
    }
    return [CITE.frscSpeeding, CITE.isoSpeeding];
  }
  if (style === 'trend') return [CITE.frscTrend, CITE.isoTrend];
  return [CITE.frscHos, CITE.isoHos];
}

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
    SAFEIQ_SPEED_LIMIT_KMH,
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
  if (env.weather === 'Loading…') return 'weather loading';
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

function speedBits(e: SafeIqEventInput): { speed: number | null; limit: number; excess: number | null } {
  const speed = e.speed != null && Number.isFinite(e.speed) ? Math.round(e.speed) : null;
  const limit = SAFEIQ_SPEED_LIMIT_KMH;
  const excess = speed != null ? speed - limit : null;
  return { speed, limit, excess };
}

function speedHeadline(e: SafeIqEventInput): string {
  const { speed, limit, excess } = speedBits(e);
  const loc = locationOf(e);
  if (speed != null && excess != null) {
    return `${speed} km/h vs company ${limit} km/h (${excess} km/h over) at ${loc}`;
  }
  return `Overspeed vs company ${limit} km/h at ${loc}`;
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
    'FRSC (ARC Compendium §1.5 Driving in the Rain): rain cuts visibility and tyre traction; stopping distance may become four or more times longer than on a dry road — reduce speed and increase following distance. ISO 55001:2024 adds the fleet-asset view: weather exposure is an operational risk to manage across the vehicle lifecycle (performance, cost, risk), not only a one-shift coaching line.',
  traffic:
    'FRSC (ARC Compendium): in dense traffic keep a safe following distance, avoid tailgating, and slow in busy towns — closed gaps raise rear-end exposure. ISO 55001 fleet/asset practice treats utilization under congestion as a controllable lifecycle risk (route, timing, wear), supporting FRSC’s road-user rules with asset-level planning.',
  speeding:
    'FRSC: speed limits are maxima under ideal conditions (Speed Limiting Device / NRTR framework); this fleet’s SafeIQ standard is 60 km/h. First overspeed: document and coach; repeat inside 14 days: formal review. ISO 55001:2024 frames the same event as asset risk — speeding raises incident and wear cost from acquisition through disposal.',
  trend:
    'FRSC RTSSS: operators must run a Safety Unit, train/retrain drivers, and keep driver/crash records — rising event counts are an organisational safety signal. ISO 55001:2024 supports that with data, predictive action, and continuous improvement so a declining week-over-week pattern triggers planned treatment, not a one-off note only.',
  hos:
    'FRSC RTSSS / Safety Manager duty: enforce rest — at least 8 hours rest within each 24-hour period; drivers must not drive while fatigued; rest after continuous driving blocks (FRSC public advice: rest after about four hours). This fleet’s dashboard mirrors that (4h continuous, daily 8h, weekly 24h). ISO 55001:2024 treats fatigue on utilization as a managed people/competence and operational-control risk in the asset system. A skipped rest is a fatigue-risk marker — not proof fatigue caused this event.',
};

function weatherCopy(input: ComposeSafeIqInput): StyleCopy {
  const env = input.environment;
  const loc = locationOf(input.event);
  const event = eventLabel(input.event);
  const precip = env.precipitation_mm != null && env.precipitation_mm > 0
    ? `, with ${Math.round(env.precipitation_mm)} mm precipitation`
    : '';
  const grip = isWetRoad(env)
    ? 'Wet road: less grip, longer stop — slow down and open the gap.'
    : 'Low visibility or dust can hide gaps; slow down and open the gap.';
  return {
    severity_reason: `${weatherLabel(env)} at the scene — contributing condition for this ${event}.`,
    root_cause: `${weatherLabel(env)}${precip} on a ${roadPhrase(env.road_type)} at ${loc}. ${grip} This ${event} happened in that weather. ${countClause(input)}`,
    industry_reference: INDUSTRY.weather,
    industry_citations: citesFor('weather'),
    coaching_recommendation: 'Ease off and increase following distance in this weather. Escalate only if the same weather band keeps repeating.',
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
    industry_citations: citesFor('traffic'),
    coaching_recommendation: 'Coach holding gap in slow traffic. If harsh events stack only in congestion, look at route timing.',
  };
}

function speedingCopy(input: ComposeSafeIqInput): StyleCopy {
  const env = input.environment;
  const wet = isWetRoad(env);
  const congested = isTrafficMaterial(env);
  const { excess, limit } = speedBits(input.event);
  const headline = speedHeadline(input.event);
  const weather = weatherLabel(env);
  const modest = excess == null || excess < 15;

  if (wet && congested) {
    return {
      severity_reason: `Overspeed in ${weather.toLowerCase()} and ${env.traffic_density} traffic — wet grip loss plus closed gaps.`,
      root_cause: `${headline} during ${weather.toLowerCase()} in ${env.traffic_density} traffic. Wet road needs a longer stop — especially in dense traffic, where the gap ahead is already short. ${countClause(input)}`,
      industry_reference:
        `FRSC (rain + following distance): reduce speed in rain; stopping may take four or more times dry distance; keep a safe gap and avoid tailgating in dense traffic. This fleet’s SafeIQ limit is ${limit} km/h (ideal-condition maximum). ISO 55001:2024 adds asset risk — congested wet running raises lifecycle incident and wear cost. Congestion removes the extra space wet roads need.`,
      industry_citations: citesFor('speeding', 'wetTraffic'),
      coaching_recommendation: modest
        ? `In rain and ${env.traffic_density} traffic, stay under ${limit} km/h and hold a longer gap. Second wet/traffic overspeed in 14 days → formal review.`
        : `Document. In rain and ${env.traffic_density} traffic stay under ${limit} km/h and leave more space. Repeat inside 14 days → formal review.`,
    };
  }

  if (wet) {
    return {
      severity_reason: `Overspeed in ${weather.toLowerCase()} — wet roads and speed do not mix.`,
      root_cause: `${headline} during ${weather.toLowerCase()}. Wet road: less grip, longer stop required — ${limit} km/h is the dry maximum; in rain drive below it. ${countClause(input)}`,
      industry_reference:
        `FRSC ARC Compendium — Driving in the Rain: reduce speed; wet stopping distance may become four or more times dry. Speed limits assume ideal (dry) conditions; this fleet’s SafeIQ standard is ${limit} km/h. ISO 55001:2024 treats that excess as asset operational risk across the vehicle lifecycle.`,
      industry_citations: citesFor('speeding', 'wet'),
      coaching_recommendation: modest
        ? `In rain, stay under ${limit} km/h — that limit is for dry roads. Second wet overspeed in 14 days → formal review.`
        : `Document. In rain stay under ${limit} km/h. Repeat inside 14 days → formal review.`,
    };
  }

  return {
    severity_reason: excess != null
      ? `${excess} km/h over company ${limit} km/h — documented overspeed.`
      : `Logged overspeed vs company ${limit} km/h — document and coach.`,
    root_cause: `${headline}. Conditions ${weather.toLowerCase()}, traffic ${env.traffic_density}. This card is speed control, not weather. ${countClause(input)}`,
    industry_reference: INDUSTRY.speeding,
    industry_citations: citesFor('speeding'),
    coaching_recommendation: modest
      ? 'Document and a short 60 km/h reminder before next shift. Second overspeed in 14 days → formal review.'
      : 'Document the excess and review the company 60 km/h standard. Repeat inside 14 days → formal review.',
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
      industry_citations: citesFor('trend'),
      coaching_recommendation: n >= INTERVENTION_INCIDENTS
        ? 'Documented coaching / refresher is the usual step at this count. Watch the next few weeks.'
        : 'Note the event; closer watch for a few weeks. Escalate at eight-in-7-days.',
    };
  }
  return {
    severity_reason: `Isolated ${event} — ${input.driverTrend} 7-day record (${n}).`,
    root_cause: `${event} at ${locationOf(input.event)}; ${n} event${n === 1 ? '' : 's'} in 7 days (${input.driverTrend}). Weather ${weatherLabel(input.environment).toLowerCase()}, traffic ${input.environment.traffic_density}. Treat as one row unless it repeats.`,
    industry_reference: INDUSTRY.trend,
    industry_citations: citesFor('trend'),
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
    industry_citations: citesFor('hos'),
    coaching_recommendation: rule === 'weekly_rest'
      ? 'Full day off before the next issued dispatch.'
      : rule === '8h_24h'
        ? 'No issued dispatch until 8-hour continuous rest is done.'
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
