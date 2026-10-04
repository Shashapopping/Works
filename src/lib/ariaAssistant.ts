import type { AiInsight } from './homeWidgetData';
import { displayDriverName, isKnownDriver } from './driverUtils';
import { COACHING_EVENT_COUNT, COACHING_WINDOW_DAYS } from '../config/interventionRules';
import { SAFEIQ_ENABLED } from '../config/safeIq';
import type { DriverDistanceSummary, FleetVehicle, Metadata, VaultRecord } from '../context/FleetContext';
import type { AriaExtras } from './ariaData';
import {
  answerAttentionAssessed,
  answerBestAssessed,
  answerCertificates,
  answerFuel,
  answerTrends,
  answerTrips,
  answerUtilization,
  answerVehicle,
  answerWeather,
  assessedNames,
  mentionedVehicle,
  namedDriverAssessed,
  topicContextSections,
  vehicleStatusFilter,
  worstDrivers,
} from './ariaTopics';
import type { SafetyNotification } from '../hooks/useSafeIQ';
import {
  FLEET_SCORE_SCALE,
  SCORE_DROP_PER_IVMS_UNIT,
  ratePer100Km,
  scoreBandLabel,
  totalSafetyPointsFromCensus,
  type FleetSafetyExposure,
  type FleetScoreConfig,
} from './fleetSafetyScore';
import { fmtHosMinutes, type HosRecord, type HosRuleId } from './hos';

export interface AriaEventLite {
  eventId?: string;
  timestamp: string;
  eventTime?: string;
  label?: string;
  type?: string;
  driverName?: string;
  regNo?: string;
  assetId?: string;
  address?: string;
}

export interface AriaSnapshot {
  page: string;
  watTime: string;
  score: number;
  scoreDelta: number;
  metadata: Metadata;
  redAlertCount: number;
  events: AriaEventLite[];
  notifications: SafetyNotification[];
  vaultRecords: VaultRecord[];
  insights: AiInsight[];
  driverDistance?: DriverDistanceSummary | null;
  /** Same 30-day census the home Fleet Safety Score card uses. */
  safetyExposure?: FleetSafetyExposure | null;
  scoreConfig?: FleetScoreConfig;
  /** Today's HOS records, already scoped to the selected sites. */
  hosRecords?: HosRecord[];
  hosDay?: string | null;
  /** Live fleet, already filtered to the header site selection. */
  vehicles?: FleetVehicle[];
  siteLabel?: string | null;
  /** Datasets fetched on demand for this question (see ariaData.ts). */
  extras?: AriaExtras;
}

export type AriaIntent =
  | 'greeting'
  | 'help'
  | 'hos'
  | 'fuel'
  | 'utilization'
  | 'trends'
  | 'trips'
  | 'certificates'
  | 'weather'
  | 'vehicle'
  | 'driver_attention'
  | 'best_driver'
  | 'weekly_risks'
  | 'fleet_status'
  | 'actions_today'
  | 'open_investigations'
  | 'named_driver'
  | 'remote';

const SUGGESTED: Record<string, AriaIntent> = {
  'which driver needs attention most urgently right now?': 'driver_attention',
  'what are the top safety risks this week?': 'weekly_risks',
  'summarise current fleet status.': 'fleet_status',
  'summarize current fleet status.': 'fleet_status',
  'what actions should i take today?': 'actions_today',
};

function norm(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, ' ');
}

function windowMs(days: number): number {
  return days * 24 * 60 * 60 * 1000;
}

function eventTime(e: AriaEventLite): number {
  return new Date(e.eventTime || e.timestamp).getTime();
}

interface DriverRollup {
  incidents: number;
  types: Record<string, number>;
  lastSeen: string;
}

/** FleetContext loads the last 7 days of scored events, capped at 120 rows. */
const FEED_DAYS = 7;

function driverRollup(events: AriaEventLite[], days = FEED_DAYS): Map<string, DriverRollup> {
  const since = Date.now() - windowMs(days);
  const map = new Map<string, DriverRollup>();
  for (const e of events) {
    const name = e.driverName;
    if (!isKnownDriver(name)) continue;
    if (eventTime(e) < since) continue;
    let row = map.get(name!);
    if (!row) {
      row = { incidents: 0, types: {}, lastSeen: '' };
      map.set(name!, row);
    }
    row.incidents++;
    const label = e.label || (e.type === 'panic' ? 'Panic Alert' : 'Event');
    row.types[label] = (row.types[label] || 0) + 1;
    const t = e.eventTime || e.timestamp;
    if (!row.lastSeen || t > row.lastSeen) row.lastSeen = t;
  }
  return map;
}

function topDrivers(events: AriaEventLite[], n = 5): Array<[string, DriverRollup]> {
  return [...driverRollup(events).entries()]
    .sort((a, b) => b[1].incidents - a[1].incidents)
    .slice(0, n);
}

function weekBreakdown(events: AriaEventLite[]): Array<[string, number]> {
  const since = Date.now() - windowMs(7);
  const typeMap: Record<string, number> = {};
  for (const e of events) {
    if (eventTime(e) < since) continue;
    const label = e.label || (e.type === 'panic' ? 'Panic Alert' : 'Unknown');
    typeMap[label] = (typeMap[label] || 0) + 1;
  }
  return Object.entries(typeMap).sort((a, b) => b[1] - a[1]);
}

function mentionedDriver(q: string, snap: AriaSnapshot): string | null {
  const nq = norm(q);
  const names = [...new Set([
    ...assessedNames(snap),
    ...snap.events.map(e => e.driverName),
    ...(snap.hosRecords ?? []).map(r => r.driverName),
  ].filter(isKnownDriver))] as string[];
  let best: string | null = null;
  for (const name of names) {
    const needle = name.toLowerCase();
    if (needle.length < 4) continue;
    if (nq.includes(needle) && (!best || name.length > best.length)) best = name;
  }
  return best;
}

function fmtDelta(delta: number): string {
  return `${delta >= 0 ? '+' : ''}${delta} vs prior 30 days`;
}

function openVault(snap: AriaSnapshot): VaultRecord[] {
  return snap.vaultRecords.filter(r => r.status !== 'resolved');
}

interface ScoreBreakdown {
  band: string;
  ivmsRate: number;
  deduction: number;
  distanceKm: number;
  incidents: number;
  hosPoints: number;
  hosHeldMinutes: number;
}

/** Mirrors the home Fleet Safety Score card so chat numbers match what the user sees. */
function scoreBreakdown(snap: AriaSnapshot): ScoreBreakdown | null {
  const exp = snap.safetyExposure;
  if (!exp) return null;
  const points = totalSafetyPointsFromCensus(exp, snap.scoreConfig);
  const ivmsRate = ratePer100Km(points.ivms, exp.distanceKm);
  return {
    band: scoreBandLabel(snap.score, snap.scoreConfig),
    ivmsRate,
    deduction: Math.min(FLEET_SCORE_SCALE, Math.max(0, Math.round(SCORE_DROP_PER_IVMS_UNIT * ivmsRate))),
    distanceKm: exp.distanceKm,
    incidents: exp.incidentTotal ?? 0,
    hosPoints: points.hos,
    hosHeldMinutes: exp.hosHeldMinutes ?? 0,
  };
}

const HOS_RULE_LABEL: Record<HosRuleId, string> = {
  '4h_continuous': '4h continuous',
  '8h_24h': 'daily rest',
  weekly_rest: 'weekly rest',
};

function hosRules(r: HosRecord): HosRuleId[] {
  const rules = new Set<HosRuleId>(r.rulesBreached ?? []);
  if ((r.breaches ?? 0) >= 1) rules.add('4h_continuous');
  if (r.dailyRestViolation ?? r.cycle8hViolation) rules.add('8h_24h');
  if (r.weeklyRestOk === false) rules.add('weekly_rest');
  return [...rules];
}

function hosContinuous(r: HosRecord): number {
  return Math.max(r.maxContinuousMinutes ?? 0, r.currentBlockMinutes ?? 0, r.continuousMinutes ?? 0);
}

function hosRank(r: HosRecord): number {
  return hosRules(r).length * 1_000_000
    + (r.status === 'violation' ? 100_000 : r.status === 'warning' ? 50_000 : 0)
    + hosContinuous(r);
}

interface HosSummary {
  total: number;
  violation: number;
  warning: number;
  compliant: number;
  byRule: Record<HosRuleId, number>;
  worst: HosRecord[];
}

function hosSummary(snap: AriaSnapshot): HosSummary | null {
  const rows = (snap.hosRecords ?? []).filter(r => isKnownDriver(r.driverName));
  if (rows.length === 0) return null;
  const byRule: Record<HosRuleId, number> = { '4h_continuous': 0, '8h_24h': 0, weekly_rest: 0 };
  let violation = 0;
  let warning = 0;
  for (const r of rows) {
    const rules = hosRules(r);
    rules.forEach(rule => { byRule[rule]++; });
    if (rules.length > 0 || r.status === 'violation') violation++;
    else if (r.status === 'warning') warning++;
  }
  const worst = [...rows]
    .filter(r => hosRules(r).length > 0 || r.status !== 'compliant')
    .sort((a, b) => hosRank(b) - hosRank(a));
  return { total: rows.length, violation, warning, compliant: rows.length - violation - warning, byRule, worst };
}

function hosLine(r: HosRecord): string {
  const rules = hosRules(r).map(rule => HOS_RULE_LABEL[rule]);
  const status = rules.length ? `breach: ${rules.join(', ')}` : r.status === 'warning' ? 'at risk' : r.status;
  return `${r.driverName} | ${r.vehicleReg || r.assetId || '—'} | ${status} | drive today ${fmtHosMinutes(r.driveMinutesToday)} | longest block ${fmtHosMinutes(hosContinuous(r))}`;
}

function hosForDriver(snap: AriaSnapshot, name: string): HosRecord | undefined {
  const n = name.trim().toLowerCase();
  return snap.hosRecords?.find(r => (r.driverName || '').trim().toLowerCase() === n);
}

export function matchAriaIntent(question: string, snap: AriaSnapshot): AriaIntent {
  const q = norm(question);
  if (SUGGESTED[q]) return SUGGESTED[q];
  if (/^(hi|hello|hey|good morning|good afternoon|good evening)\b/.test(q)) return 'greeting';
  if (/^(help|what can you do|how do you work|what do you do)\b/.test(q)) return 'help';
  if (/\bhos\b|hours of service|fatigue|fatigued|tired|driving hours|drive time|daily rest|weekly rest|rest break|continuous driving|4 ?h(ou)?r?s? (rule|continuous|block)/.test(q)) {
    return 'hos';
  }
  if (/fuel|diesel|litre|liter|refuel|consumption|l\/100/.test(q)) return 'fuel';
  if (/utili[sz]|idle hours|engine hours|availability|under-?used/.test(q)) return 'utilization';
  if (/certif|licen[cs]e|permit|renewal/.test(q)) return 'certificates';
  if (/\btrips?\b|journeys?|in transit|en route/.test(q)) return 'trips';
  if (/trend|increas|decreas|going (up|down)|rising|falling|spike|week on week|month on month|over time/.test(q)) return 'trends';
  if (/weather|\brain(s|ing|y|fall)?\b|storm|thunder|flood|\bfog(gy)?\b|temperature|\bhot\b|humid|\bwindy?\b|traffic(?! (violation|offen[cs]e|rule|law|fine|ticket))|congest|go-?slow|road conditions?/.test(q)) return 'weather';
  if (mentionedVehicle(question, snap.vehicles) || vehicleStatusFilter(question)) return 'vehicle';
  const aboutDriver = /\bdrivers?\b|\bwho\b/.test(q);
  if (aboutDriver && /\b(best|safest|cleanest|good|cool|top performer|model|commend|praise|reward|least risky|fewest)\b/.test(q)) {
    return 'best_driver';
  }
  if (/needs? attention|watch (out )?for|most urgent|priority driver|worst|riskiest|most (risky|incidents|events)|who should i (call|see|coach)|concern(ed|ing)? (about )?driver/.test(q)) {
    return 'driver_attention';
  }
  if (/\btop safety risks\b|\bsafety risks this week\b|\brisks this week\b|this week's risks|event breakdown|what happened this week/.test(q)) {
    return 'weekly_risks';
  }
  if (/fleet status|safety score|how is the fleet|summarise (the )?fleet|summarize (the )?fleet|current status/.test(q)) {
    return 'fleet_status';
  }
  if (/actions? (should i take|today|now)|what should i do|what next|today's actions/.test(q)) {
    return 'actions_today';
  }
  if (/open (vault|investigation)|unresolved|in review/.test(q)) return 'open_investigations';
  const named = mentionedDriver(question, snap);
  if (named && /how (is|many)|status of|incidents|events|record of|tell me about|show me|score|category|standing/.test(q)) {
    return 'named_driver';
  }
  return 'remote';
}

function answerGreeting(): string {
  return 'Ready. Ask about a driver, this week\'s risks, fleet status, or what to do today — those I can answer from the current view without a model call.';
}

function answerHelp(): string {
  return `I can answer fleet facts from the live view:

- Which driver needs attention, or who is driving best (30-day scores, warnings on file)
- Top safety risks this week and 30-day trends
- Current fleet status and safety score breakdown
- Hours of service and fatigue breaches today
- Where a vehicle is, and which trucks are idle, parked or moving
- Fuel use and utilization this week, trips in the last 24 hours
- Expired or expiring driver certificates
- Live weather and traffic where the fleet is, or at a named vehicle
- Open investigations and suggested actions

Anything that needs judgement across several topics goes to the language model with a narrow slice of data, not the whole fleet dump.`;
}

function redCardLine(snap: AriaSnapshot, name: string): string {
  if (!SAFEIQ_ENABLED) return '';
  const red = snap.notifications.find(n => n.analysis?.severity === 'RED' && n.driver.name === name);
  return red ? ` A RED SafeIQ card is open on ${red.vehicle.id} (${red.magnitude}).` : '';
}

function answerAttention(snap: AriaSnapshot): string {
  const assessed = answerAttentionAssessed(snap, name => redCardLine(snap, name));
  if (assessed) return assessed;
  const ranked = topDrivers(snap.events, 3);
  if (ranked.length === 0) {
    return `No known driver stands out in the last ${FEED_DAYS} days of the event feed — check Driver Management.`;
  }
  const [name, row] = ranked[0];
  const breakdown = Object.entries(row.types).map(([t, c]) => `${t}×${c}`).join(', ');
  const last = row.lastSeen
    ? new Date(row.lastSeen).toLocaleString('en-GB', { timeZone: 'Africa/Lagos' })
    : 'unknown';
  const others = ranked.slice(1).map(([n, r]) => `${n} (${r.incidents})`).join(', ');
  const rest = others ? ` Next in line: ${others}.` : '';
  return `**${name}** has the most events in the last ${FEED_DAYS} days of the live feed: **${row.incidents}** (${breakdown}). Last event ${last}.${redCardLine(snap, name)}${rest} (30-day driver scores unavailable right now.)`;
}

interface DriverRate {
  name: string;
  km: number;
  journeys: number;
  incidents: number;
  per100: number;
}

const BEST_DRIVER_MIN_KM = 100;

/** Events per 100 km over the same window as the driver-distance summary. */
function driverRates(snap: AriaSnapshot): { rows: DriverRate[]; start: string; end: string } | null {
  const dist = snap.driverDistance;
  if (!dist?.drivers?.length) return null;
  const from = new Date(dist.start).getTime();
  const to = new Date(dist.end).getTime();
  const counts = new Map<string, number>();
  for (const e of snap.events) {
    if (!isKnownDriver(e.driverName)) continue;
    const t = eventTime(e);
    if (Number.isFinite(from) && t < from) continue;
    if (Number.isFinite(to) && t > to) continue;
    const k = e.driverName!.trim().toLowerCase();
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const rows = dist.drivers
    .filter(d => isKnownDriver(d.driverName) && d.totalDistanceKm >= BEST_DRIVER_MIN_KM)
    .map(d => {
      const incidents = counts.get(d.driverName.trim().toLowerCase()) || 0;
      return {
        name: d.driverName.trim(),
        km: d.totalDistanceKm,
        journeys: d.journeyCount,
        incidents,
        per100: (incidents / d.totalDistanceKm) * 100,
      };
    });
  return { rows, start: dist.start, end: dist.end };
}

function fmtDay(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { timeZone: 'Africa/Lagos' });
}

function answerBest(snap: AriaSnapshot): string | null {
  const assessed = answerBestAssessed(snap);
  if (assessed) return assessed;
  const rated = driverRates(snap);
  if (!rated || rated.rows.length === 0) return null;
  const ranked = [...rated.rows].sort((a, b) => a.per100 - b.per100 || b.km - a.km);
  const [top, ...rest] = ranked;
  const km = (v: number) => Math.round(v).toLocaleString('en-GB');
  const rate = (r: DriverRate) => (r.incidents === 0 ? 'zero events' : `${r.per100.toFixed(2)} events/100 km`);
  const clean = ranked.filter(r => r.incidents === 0).length;
  const next = rest.slice(0, 2).map(r => `${r.name} (${km(r.km)} km, ${rate(r)})`).join(', ');
  const window = `${fmtDay(rated.start)}–${fmtDay(rated.end)}`;
  return `**${top.name}** is the strongest driver in the current view: **${km(top.km)} km** over ${top.journeys} journeys with **${rate(top)}** (${window}).${next ? ` Next: ${next}.` : ''} ${clean} of ${ranked.length} drivers with ≥${BEST_DRIVER_MIN_KM} km had no events.`;
}

function answerWeekly(snap: AriaSnapshot): string {
  const rows = weekBreakdown(snap.events);
  const weekCount = rows.reduce((s, [, c]) => s + c, 0);
  if (weekCount === 0) {
    return 'No safety events in the last 7 days in the current feed.';
  }
  const lines = rows.slice(0, 6).map(([label, count]) => `- **${label}:** ${count}`);
  const lead = rows[0];
  return `**${weekCount}** safety events in the last 7 days. Lead type is **${lead[0]}** (${lead[1]}).\n\n${lines.join('\n')}`;
}

function scoreSentence(snap: AriaSnapshot): string {
  const b = scoreBreakdown(snap);
  const head = `Safety score **${snap.score}/100**${b ? ` — ${b.band}` : ''} (${fmtDelta(snap.scoreDelta)}).`;
  if (!b) return head;
  const hos = b.hosHeldMinutes > 0
    ? ` HOS adds ${b.hosPoints} pts (${fmtHosMinutes(b.hosHeldMinutes)} over limits).`
    : '';
  return `${head} ${b.ivmsRate.toFixed(1)} IVMS pts/100 km → −${b.deduction} from 100, over ${Math.round(b.distanceKm).toLocaleString('en-GB')} km and ${b.incidents} scored events in 30 days.${hos}`;
}

function hosSentence(snap: AriaSnapshot): string {
  const h = hosSummary(snap);
  if (!h) return '';
  return ` HOS today: **${h.violation}** of ${h.total} drivers in breach, ${h.warning} at risk.`;
}

function answerStatus(snap: AriaSnapshot): string {
  const m = snap.metadata;
  const open = openVault(snap).length;
  return `${scoreSentence(snap)}\n\n**${m.totalVehicles}** vehicles — moving ${m.moving}, idle ${m.idle}, excessive idle ${m.excessiveIdle}, parked ${m.parked}, inactive ${m.inactive}. Active red alerts: **${snap.redAlertCount}**. Open vault investigations: **${open}**.${hosSentence(snap)} As of ${snap.watTime} WAT.`;
}

function answerHos(question: string, snap: AriaSnapshot): string {
  const h = hosSummary(snap);
  if (!h) return 'No HOS records for today in the current view — check Fatigue Management.';
  const nq = norm(question);
  const named = (snap.hosRecords ?? []).find(r => {
    const n = (r.driverName || '').trim().toLowerCase();
    return n.length >= 4 && nq.includes(n);
  });
  if (named) {
    const rest = named.restDueAt
      ? ` Rest due ${new Date(named.restDueAt).toLocaleTimeString('en-GB', { timeZone: 'Africa/Lagos', hour: '2-digit', minute: '2-digit' })}.`
      : '';
    return `**${named.driverName}** today: ${hosLine(named).split(' | ').slice(1).join(' · ')}.${rest}`;
  }
  const day = snap.hosDay ? ` (${fmtDay(snap.hosDay)})` : '';
  const rules = (Object.keys(h.byRule) as HosRuleId[])
    .filter(rule => h.byRule[rule] > 0)
    .map(rule => `${HOS_RULE_LABEL[rule]} ${h.byRule[rule]}`)
    .join(', ');
  const head = `**${h.violation}** of ${h.total} drivers are in HOS breach today${day}${rules ? ` (${rules})` : ''}; ${h.warning} at risk, ${h.compliant} compliant.`;
  const top = h.worst.slice(0, 3).map(r => `- ${hosLine(r)}`);
  return top.length ? `${head}\n\n${top.join('\n')}` : head;
}

function answerActions(snap: AriaSnapshot): string {
  const lines: string[] = [];
  const vault = openVault(snap).slice(0, 4);
  if (vault.length) {
    lines.push(`**Vault:** ${vault.length} open. Lead: ${vault[0].driverName} / ${vault[0].vehicleId} (${vault[0].type}, ${vault[0].status}).`);
  }
  if (SAFEIQ_ENABLED) {
    const reds = snap.notifications.filter(n => n.analysis?.severity === 'RED' && isKnownDriver(n.driver.name));
    if (reds[0]) {
      lines.push(`**SafeIQ RED:** ${reds[0].driver.name} on ${reds[0].vehicle.id} — ${reds[0].magnitude}.`);
    }
  }
  const flagged = worstDrivers(snap, 12)
    .filter(d => d.consequence.category === 'Red' || d.consequence.category === 'Yellow')
    .filter(d => !snap.extras?.warnings?.has(d.key))
    .slice(0, 3);
  if (flagged.length) {
    lines.push(`**Needs a conversation** (30d, no written warning yet): ${flagged.map(d => `${d.name} (${d.consequence.categoryLabel}, ${d.consequence.displayScore}/100)`).join(', ')}.`);
  } else if (!snap.extras?.drivers) {
    const coaching = topDrivers(snap.events, 8)
      .filter(([, r]) => r.incidents >= COACHING_EVENT_COUNT)
      .slice(0, 3);
    if (coaching.length) {
      lines.push(`**Coaching queue** (≥${COACHING_EVENT_COUNT} events / ${COACHING_WINDOW_DAYS}d): ${coaching.map(([n, r]) => `${n} (${r.incidents})`).join(', ')}.`);
    }
  }
  const h = hosSummary(snap);
  if (h?.violation) lines.push(`**HOS:** ${h.violation} drivers in breach today — lead: ${h.worst[0] ? hosLine(h.worst[0]) : '—'}.`);
  const expired = (snap.extras?.certificates ?? []).filter(c => c.expiryDate && new Date(c.expiryDate).getTime() < Date.now()).length;
  if (expired) lines.push(`**Certificates:** ${expired} expired — renew before dispatch.`);
  for (const ins of snap.insights.slice(0, 2)) {
    lines.push(`**${ins.title}:** ${ins.description}`);
  }
  if (lines.length === 0) {
    return 'Nothing urgent in the current view — no open vault items, no RED cards, and no driver above the coaching-event mark.';
  }
  return `From the current view:\n\n${lines.map(l => `- ${l}`).join('\n')}`;
}

function answerInvestigations(snap: AriaSnapshot): string {
  const rows = openVault(snap).slice(0, 8);
  if (rows.length === 0) return 'No open vault investigations in the current view.';
  const lines = rows.map(r => `- **[${r.severity}]** ${r.driverName} | ${r.vehicleId} | ${r.type} | ${r.status}`);
  return `**${rows.length}** open investigations:\n\n${lines.join('\n')}`;
}

function answerNamedDriver(snap: AriaSnapshot, name: string): string {
  const row = driverRollup(snap.events).get(name);
  const recent = snap.events
    .filter(e => e.driverName === name)
    .sort((a, b) => eventTime(b) - eventTime(a))
    .slice(0, 5);
  const assessed = namedDriverAssessed(snap, name);
  const hos = hosForDriver(snap, name);
  if (!assessed && !row && recent.length === 0 && !hos) {
    return `${name} has no scored events or HOS record in the current view.`;
  }
  const head = assessed ?? (() => {
    const breakdown = row ? Object.entries(row.types).map(([t, c]) => `${t}×${c}`).join(', ') : 'no scored events';
    return `**${name}:** ${row?.incidents ?? 0} events in the last ${FEED_DAYS} days (${breakdown}).`;
  })();
  const lines = recent.map(e => {
    const t = new Date(e.eventTime || e.timestamp).toLocaleString('en-GB', { timeZone: 'Africa/Lagos' });
    return `- ${t} | ${e.label || 'Event'} | ${e.regNo || e.assetId} | ${e.address || 'No location'}`;
  });
  const recentText = lines.length ? `\n\nMost recent events:\n${lines.join('\n')}` : '';
  const hosText = hos ? `\n\n**HOS today:** ${hosLine(hos).split(' | ').slice(2).join(' · ')}.` : '';
  return `${head}${recentText}${hosText}`;
}

/** Local answer when rules/templates can handle the question. Null means use the remote model. */
export function answerAriaLocal(question: string, snap: AriaSnapshot): string | null {
  const intent = matchAriaIntent(question, snap);
  switch (intent) {
    case 'greeting':
      return answerGreeting();
    case 'help':
      return answerHelp();
    case 'hos':
      return answerHos(question, snap);
    case 'fuel':
      return answerFuel(question, snap);
    case 'utilization':
      return answerUtilization(question, snap);
    case 'trends':
      return answerTrends(snap);
    case 'trips':
      return answerTrips(snap);
    case 'certificates':
      return answerCertificates(snap);
    case 'weather':
      return answerWeather(snap);
    case 'vehicle':
      return answerVehicle(question, snap);
    case 'driver_attention':
      return answerAttention(snap);
    case 'best_driver':
      return answerBest(snap);
    case 'weekly_risks':
      return answerWeekly(snap);
    case 'fleet_status':
      return answerStatus(snap);
    case 'actions_today':
      return answerActions(snap);
    case 'open_investigations':
      return answerInvestigations(snap);
    case 'named_driver': {
      const name = mentionedDriver(question, snap);
      return name ? answerNamedDriver(snap, name) : null;
    }
    default:
      return null;
  }
}

function compactStatus(snap: AriaSnapshot): string {
  const m = snap.metadata;
  const b = scoreBreakdown(snap);
  const score = b
    ? `Fleet safety score ${snap.score}/100 ${b.band} (${fmtDelta(snap.scoreDelta)}; ${b.ivmsRate.toFixed(1)} IVMS pts/100 km = −${b.deduction}; ${Math.round(b.distanceKm)} km, ${b.incidents} scored events in 30d; HOS ${b.hosPoints} pts from ${fmtHosMinutes(b.hosHeldMinutes)} over limits)`
    : `Fleet safety score ${snap.score}/100 (${fmtDelta(snap.scoreDelta)})`;
  const h = hosSummary(snap);
  const hos = h ? ` | HOS today ${h.violation}/${h.total} in breach, ${h.warning} at risk` : '';
  const scope = snap.siteLabel ? `site filter: ${snap.siteLabel}` : 'all sites';
  return `${score}\n${scope} | vehicles ${m.totalVehicles} moving ${m.moving} idle ${m.idle} | red ${snap.redAlertCount} | open vault ${openVault(snap).length}${hos} | page ${snap.page} | ${snap.watTime} WAT`;
}

function formatDriverLine(name: string, d: DriverRollup): string {
  const breakdown = Object.entries(d.types).map(([t, c]) => `${t}×${c}`).join(', ');
  const last = d.lastSeen ? new Date(d.lastSeen).toLocaleString('en-GB', { timeZone: 'Africa/Lagos' }) : 'unknown';
  return `  ${name}: ${d.incidents} incidents (${breakdown}) | last: ${last}`;
}

/**
 * Narrow slice for the remote model — only the records that match the question.
 * Does not change how Claude is called; it only shrinks the user-message context.
 */
export function buildAriaRemoteContext(question: string, snap: AriaSnapshot): string {
  const q = norm(question);
  const named = mentionedDriver(question, snap);
  const sections: string[] = [
    `BPL ANALYST NARROW CONTEXT — ${snap.watTime} (Lagos, WAT)`,
    compactStatus(snap),
    ...topicContextSections(question, snap, named),
  ];

  if (named) {
    const row = driverRollup(snap.events).get(named);
    sections.push(`=== DRIVER ${named} — LIVE FEED (last ${FEED_DAYS} days) ===`);
    sections.push(row ? formatDriverLine(named, row) : `  No events in the last ${FEED_DAYS} days`);
    const recent = snap.events.filter(e => e.driverName === named).slice(0, 8);
    sections.push(recent.map(e => {
      const t = e.eventTime ? new Date(e.eventTime).toLocaleString('en-GB', { timeZone: 'Africa/Lagos' }) : 'unknown';
      return `  ${t} | ${e.label || 'Event'} | ${e.regNo || e.assetId} | ${e.address || 'No location'}`;
    }).join('\n') || '  No rows');
    const hos = hosForDriver(snap, named);
    if (hos) sections.push(`  HOS today: ${hosLine(hos)}`);
  }

  const wantsHos = /\bhos\b|hours of service|fatigue|tired|rest|driving hours|drive time|continuous/.test(q);
  const h = hosSummary(snap);
  if (h && (wantsHos || (!named && q.length < 40))) {
    const rules = (Object.keys(h.byRule) as HosRuleId[]).map(rule => `${HOS_RULE_LABEL[rule]} ${h.byRule[rule]}`).join(', ');
    sections.push(`=== HOS TODAY${snap.hosDay ? ` (${snap.hosDay})` : ''} — ${h.violation}/${h.total} in breach (${rules}), ${h.warning} at risk ===`);
    sections.push(h.worst.slice(0, wantsHos ? 6 : 3).map(r => `  ${hosLine(r)}`).join('\n') || '  None');
  }

  const wantsSpeed = /speed|overspeed/.test(q);
  const wantsHarsh = /harsh|brak|accel|corner/.test(q);
  const wantsVault = /vault|investigation|incident/.test(q);
  const wantsAlert = /alert|safeiq|red|yellow/.test(q);

  if (!named && (wantsSpeed || wantsHarsh)) {
    const labels = wantsSpeed
      ? ['Overspeeding', 'Overspeed Tiered', 'Road Speed Overspeeding']
      : ['Harsh Braking', 'Harsh Acceleration', 'Harsh Cornering'];
    const hits = snap.events.filter(e => labels.includes(e.label || '')).slice(0, 8);
    sections.push(`=== MATCHING EVENTS ===`);
    sections.push(hits.map(e => {
      const t = e.eventTime ? new Date(e.eventTime).toLocaleString('en-GB', { timeZone: 'Africa/Lagos' }) : 'unknown';
      const driver = displayDriverName(e.driverName, '—');
      return `  ${t} | ${e.label} | ${driver} | ${e.regNo || e.assetId}`;
    }).join('\n') || '  None');
  }

  if (wantsVault || (!named && q.length < 40)) {
    const vault = openVault(snap).slice(0, 5);
    sections.push('=== OPEN VAULT ===');
    sections.push(vault.map(r => `  [${r.severity}] ${r.driverName} | ${r.vehicleId} | ${r.type} | ${r.status}`).join('\n') || '  None');
  }

  if (SAFEIQ_ENABLED && (wantsAlert || !named)) {
    const reds = snap.notifications
      .filter(n => n.analysis?.severity === 'RED' && isKnownDriver(n.driver.name))
      .slice(0, 3)
      .map(n => `  [RED] ${n.driver.name} | ${n.vehicle.id} | ${n.magnitude}`);
    if (reds.length) {
      sections.push('=== RED ALERTS ===');
      sections.push(reds.join('\n'));
    }
  }

  if (!named && !wantsSpeed && !wantsHarsh) {
    const week = weekBreakdown(snap.events).slice(0, 5).map(([l, c]) => `  ${l}: ${c}`);
    if (!snap.extras?.drivers?.length) {
      const top = topDrivers(snap.events, 3).map(([name, d]) => formatDriverLine(name, d));
      sections.push(`=== MOST EVENTS (last ${FEED_DAYS} days, live feed) — highest risk, not best ===`);
      sections.push(top.join('\n') || '  None');
    }
    const rated = snap.extras?.drivers?.length ? null : driverRates(snap);
    if (rated?.rows.length) {
      const low = [...rated.rows]
        .sort((a, b) => a.per100 - b.per100 || b.km - a.km)
        .slice(0, 3)
        .map(r => `  ${r.name}: ${Math.round(r.km)} km, ${r.incidents} events (${r.per100.toFixed(2)}/100 km)`);
      sections.push(`=== LOWEST EVENT RATE (${fmtDay(rated.start)}–${fmtDay(rated.end)}, ≥${BEST_DRIVER_MIN_KM} km) — best ===`);
      sections.push(low.join('\n'));
    }
    sections.push('=== WEEK BREAKDOWN ===');
    sections.push(week.join('\n') || '  None');
  }

  return `${sections.join('\n')}\n\n---\n\nUser question: ${question.trim()}`;
}
