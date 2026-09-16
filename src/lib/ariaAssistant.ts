import type { AiInsight } from './homeWidgetData';
import { displayDriverName, isKnownDriver } from './driverUtils';
import { COACHING_EVENT_COUNT, COACHING_WINDOW_DAYS } from '../config/interventionRules';
import { SAFEIQ_ENABLED } from '../config/safeIq';
import type { Metadata, VaultRecord } from '../context/FleetContext';
import type { SafetyNotification } from '../hooks/useSafeIQ';

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
}

export type AriaIntent =
  | 'greeting'
  | 'help'
  | 'driver_attention'
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

function driverRollup(events: AriaEventLite[], days = 30): Map<string, DriverRollup> {
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

function mentionedDriver(q: string, events: AriaEventLite[]): string | null {
  const nq = norm(q);
  const names = [...new Set(events.map(e => e.driverName).filter(isKnownDriver))] as string[];
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

export function matchAriaIntent(question: string, snap: AriaSnapshot): AriaIntent {
  const q = norm(question);
  if (SUGGESTED[q]) return SUGGESTED[q];
  if (/^(hi|hello|hey|good morning|good afternoon|good evening)\b/.test(q)) return 'greeting';
  if (/^(help|what can you do|how do you work|what do you do)\b/.test(q)) return 'help';
  if (/which driver|who needs attention|most urgent|priority driver|worst driver|who is worst|who should i (call|see|coach)/.test(q)) {
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
  const named = mentionedDriver(question, snap.events);
  if (named && /how (is|many)|status of|incidents|events|record of|tell me about|show me/.test(q)) {
    return 'named_driver';
  }
  return 'remote';
}

function answerGreeting(): string {
  return 'Ready. Ask about a driver, this week\'s risks, fleet status, or what to do today — those I can answer from the current view without a model call.';
}

function answerHelp(): string {
  return `I can answer fleet facts from the live view:

- Which driver needs attention
- Top safety risks this week
- Current fleet status and score
- Open investigations and suggested actions

Anything that needs judgement across several topics goes to the language model with a narrow slice of data, not the whole fleet dump.`;
}

function answerAttention(snap: AriaSnapshot): string {
  const ranked = topDrivers(snap.events, 3);
  if (ranked.length === 0) {
    return 'No known driver stands out in the last 30 days from the current event feed — check Driver Management.';
  }
  const [name, row] = ranked[0];
  const breakdown = Object.entries(row.types).map(([t, c]) => `${t}×${c}`).join(', ');
  const last = row.lastSeen
    ? new Date(row.lastSeen).toLocaleString('en-GB', { timeZone: 'Africa/Lagos' })
    : 'unknown';
  const red = SAFEIQ_ENABLED
    ? snap.notifications.find(n => n.analysis?.severity === 'RED' && n.driver.name === name)
    : undefined;
  const others = ranked.slice(1).map(([n, r]) => `${n} (${r.incidents})`).join(', ');
  const redLine = red
    ? ` A RED SafeIQ card is open on ${red.vehicle.id} (${red.magnitude}).`
    : '';
  const rest = others ? ` Next in line: ${others}.` : '';
  return `**${name}** has the highest 30-day incident count in the current view: **${row.incidents}** (${breakdown}). Last event ${last}.${redLine}${rest}`;
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

function answerStatus(snap: AriaSnapshot): string {
  const m = snap.metadata;
  const open = openVault(snap).length;
  return `Safety score **${snap.score}/100** (${fmtDelta(snap.scoreDelta)}). **${m.totalVehicles}** vehicles — moving ${m.moving}, idle ${m.idle}, excessive idle ${m.excessiveIdle}, parked ${m.parked}, inactive ${m.inactive}. Active red alerts: **${snap.redAlertCount}**. Open vault investigations: **${open}**. As of ${snap.watTime} WAT.`;
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
  const coaching = topDrivers(snap.events, 8)
    .filter(([, r]) => r.incidents >= COACHING_EVENT_COUNT)
    .slice(0, 3);
  if (coaching.length) {
    lines.push(`**Coaching queue** (≥${COACHING_EVENT_COUNT} events / ${COACHING_WINDOW_DAYS}d): ${coaching.map(([n, r]) => `${n} (${r.incidents})`).join(', ')}.`);
  }
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
  if (!row && recent.length === 0) {
    return `${name} is not in the current 30-day event view.`;
  }
  const breakdown = row
    ? Object.entries(row.types).map(([t, c]) => `${t}×${c}`).join(', ')
    : 'no scored events';
  const lines = recent.map(e => {
    const t = new Date(e.eventTime || e.timestamp).toLocaleString('en-GB', { timeZone: 'Africa/Lagos' });
    return `- ${t} | ${e.label || 'Event'} | ${e.regNo || e.assetId} | ${e.address || 'No location'}`;
  });
  return `**${name}:** ${row?.incidents ?? 0} events in 30 days (${breakdown}).\n\n${lines.join('\n') || 'No recent rows.'}`;
}

/** Local answer when rules/templates can handle the question. Null means use the remote model. */
export function answerAriaLocal(question: string, snap: AriaSnapshot): string | null {
  const intent = matchAriaIntent(question, snap);
  switch (intent) {
    case 'greeting':
      return answerGreeting();
    case 'help':
      return answerHelp();
    case 'driver_attention':
      return answerAttention(snap);
    case 'weekly_risks':
      return answerWeekly(snap);
    case 'fleet_status':
      return answerStatus(snap);
    case 'actions_today':
      return answerActions(snap);
    case 'open_investigations':
      return answerInvestigations(snap);
    case 'named_driver': {
      const name = mentionedDriver(question, snap.events);
      return name ? answerNamedDriver(snap, name) : null;
    }
    default:
      return null;
  }
}

function compactStatus(snap: AriaSnapshot): string {
  const m = snap.metadata;
  return `Score ${snap.score}/100 (${fmtDelta(snap.scoreDelta)}) | vehicles ${m.totalVehicles} moving ${m.moving} idle ${m.idle} | red ${snap.redAlertCount} | open vault ${openVault(snap).length} | page ${snap.page} | ${snap.watTime} WAT`;
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
  const named = mentionedDriver(question, snap.events);
  const sections: string[] = [
    `BPL ANALYST NARROW CONTEXT — ${snap.watTime} (Lagos, WAT)`,
    compactStatus(snap),
  ];

  if (named) {
    const row = driverRollup(snap.events).get(named);
    sections.push(`=== DRIVER ${named} ===`);
    sections.push(row ? formatDriverLine(named, row) : '  Not in 30-day rollup');
    const recent = snap.events.filter(e => e.driverName === named).slice(0, 8);
    sections.push(recent.map(e => {
      const t = e.eventTime ? new Date(e.eventTime).toLocaleString('en-GB', { timeZone: 'Africa/Lagos' }) : 'unknown';
      return `  ${t} | ${e.label || 'Event'} | ${e.regNo || e.assetId} | ${e.address || 'No location'}`;
    }).join('\n') || '  No rows');
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
    const top = topDrivers(snap.events, 3).map(([name, d]) => formatDriverLine(name, d));
    const week = weekBreakdown(snap.events).slice(0, 5).map(([l, c]) => `  ${l}: ${c}`);
    sections.push('=== TOP DRIVERS (30d) ===');
    sections.push(top.join('\n') || '  None');
    sections.push('=== WEEK BREAKDOWN ===');
    sections.push(week.join('\n') || '  None');
  }

  return `${sections.join('\n')}\n\n---\n\nUser question: ${question.trim()}`;
}
