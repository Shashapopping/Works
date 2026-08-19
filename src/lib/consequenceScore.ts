/**
 * Consequence Management scoring — Driver Score per 100 km.
 * Source: Consequence Management.md (bpl-core-template)
 *
 * Tunable via Settings → Alert Thresholds (localStorage).
 */

export const CONSEQUENCE_CONFIG_KEY = 'bpl_consequence_score_config';
export const CONSEQUENCE_CONFIG_EVENT = 'bpl-consequence-score-config';

/** @deprecated prefer loadConsequenceConfig().penaltyPerEvent */
export const PENALTY_PER_EVENT = 2;

export type ConsequenceCategory = 'Green' | 'Amber' | 'Yellow' | 'Red';

export interface ConsequenceScoreConfig {
  /** Points deducted per scored IVMS event (positive; applied as negative). */
  penaltyPerEvent: number;
  /** Score at or below this enters Amber (default −2). */
  amberStart: number;
  /** Score at or below this enters Yellow (default −6). */
  yellowStart: number;
  /** Score at or below this enters Red (default −12). */
  redStart: number;
}

export const DEFAULT_CONSEQUENCE_CONFIG: ConsequenceScoreConfig = {
  penaltyPerEvent: 2,
  amberStart: -2,
  yellowStart: -6,
  redStart: -12,
};

function clampNum(n: unknown, fallback: number, min: number, max: number): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

export function normalizeConsequenceConfig(raw: unknown): ConsequenceScoreConfig {
  const d = DEFAULT_CONSEQUENCE_CONFIG;
  if (!raw || typeof raw !== 'object') return { ...d };
  const o = raw as Partial<ConsequenceScoreConfig>;
  let amberStart = clampNum(o.amberStart, d.amberStart, -50, 0);
  let yellowStart = clampNum(o.yellowStart, d.yellowStart, -80, 0);
  let redStart = clampNum(o.redStart, d.redStart, -100, 0);
  if (yellowStart >= amberStart) yellowStart = amberStart - 4;
  if (redStart >= yellowStart) redStart = yellowStart - 6;
  return {
    penaltyPerEvent: clampNum(o.penaltyPerEvent, d.penaltyPerEvent, 0.5, 20),
    amberStart,
    yellowStart,
    redStart,
  };
}

export function loadConsequenceConfig(): ConsequenceScoreConfig {
  try {
    const raw = localStorage.getItem(CONSEQUENCE_CONFIG_KEY);
    if (!raw) return { ...DEFAULT_CONSEQUENCE_CONFIG };
    return normalizeConsequenceConfig(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_CONSEQUENCE_CONFIG };
  }
}

export function saveConsequenceConfig(config: ConsequenceScoreConfig): ConsequenceScoreConfig {
  const next = normalizeConsequenceConfig(config);
  localStorage.setItem(CONSEQUENCE_CONFIG_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(CONSEQUENCE_CONFIG_EVENT, { detail: next }));
  return next;
}

const SCORED_LABELS = new Set<string>([
  'Harsh Braking',
  'Harsh Acceleration',
  'Overspeeding',
  'Overspeed Tiered',
  'Harsh Cornering',
]);

export interface PenaltyTotals {
  harshBraking: number;
  harshAccel: number;
  overspeeding: number;
  cornering: number;
  eventCount: number;
  penaltyPoints: number;
}

export interface ConsequenceCard {
  penaltyPoints: number;
  distanceKm: number;
  driverScore: number;
  category: ConsequenceCategory;
  displayScore: number;
  categoryLabel: string;
  categoryColor: string;
  recommendedConsequence: string;
  occurrenceIndex: number;
  counts: {
    harshBraking: number;
    harshAccel: number;
    overspeeding: number;
    cornering: number;
    eventCount: number;
  };
}

export const CATEGORY_COLORS: Record<ConsequenceCategory, string> = {
  Green: '#16a34a',
  Amber: '#f59e0b',
  Yellow: '#d97706',
  Red: '#CC0000',
};

/** Plain-language band labels — avoid colour names in the UI. */
export const CATEGORY_PLAIN_LABEL: Record<ConsequenceCategory, string> = {
  Green: 'On track',
  Amber: 'Needs coaching',
  Yellow: 'Suspension review',
  Red: 'Critical',
};

export function categoryPlainLabel(category: ConsequenceCategory): string {
  return CATEGORY_PLAIN_LABEL[category] ?? category;
}

export function categoryPlainDescription(category: ConsequenceCategory): string {
  switch (category) {
    case 'Green':
      return 'Safe driving rate for distance covered — eligible for rewards.';
    case 'Amber':
      return 'First formal step: written warning. Repeat in this band → mandatory retraining.';
    case 'Yellow':
      return 'Escalated risk — suspension review (3 days, then 1 week if repeated).';
    case 'Red':
      return 'Severe rate — two-week suspension, then termination if repeated.';
  }
}

export function isScoredViolationLabel(label?: string | null): boolean {
  return !!label && SCORED_LABELS.has(label);
}

export function countPenaltyEvents(
  events: { label?: string | null; type?: string }[],
  config: ConsequenceScoreConfig = loadConsequenceConfig(),
): PenaltyTotals {
  let harshBraking = 0;
  let harshAccel = 0;
  let overspeeding = 0;
  let cornering = 0;

  events.forEach(e => {
    if (e.type === 'panic') return;
    const label = e.label || '';
    if (label === 'Harsh Braking') harshBraking++;
    else if (label === 'Harsh Acceleration') harshAccel++;
    else if (label === 'Overspeeding' || label === 'Overspeed Tiered') overspeeding++;
    else if (label === 'Harsh Cornering') cornering++;
  });

  const eventCount = harshBraking + harshAccel + overspeeding + cornering;
  return {
    harshBraking,
    harshAccel,
    overspeeding,
    cornering,
    eventCount,
    penaltyPoints: -(eventCount * config.penaltyPerEvent),
  };
}

export function normalizeDriverScore(penaltyPoints: number, distanceKm: number): number {
  // Spec: penalty ÷ (km / 100). Never use less than one 100 km block —
  // a 0.01-block floor turned one event (−2) into −200 (display score 0).
  const blocks = Math.max(distanceKm / 100, 1);
  return penaltyPoints / blocks;
}

export function categorizeDriverScore(
  driverScore: number,
  config: ConsequenceScoreConfig = loadConsequenceConfig(),
): ConsequenceCategory {
  const { amberStart, yellowStart, redStart } = config;
  if (driverScore >= 0) return 'Green';
  if (driverScore > amberStart) return 'Green';
  if (driverScore > yellowStart) return 'Amber';
  if (driverScore > redStart) return 'Yellow';
  return 'Red';
}

export function toDisplayScore100(
  driverScore: number,
  config: ConsequenceScoreConfig = loadConsequenceConfig(),
): number {
  const { amberStart, yellowStart, redStart } = config;
  if (driverScore >= 0) return 100;
  if (driverScore > amberStart) {
    const t = amberStart === 0 ? 0 : driverScore / amberStart;
    return Math.round(100 - t * 15);
  }
  if (driverScore > yellowStart) {
    const span = yellowStart - amberStart;
    const t = span === 0 ? 0 : (driverScore - amberStart) / span;
    return Math.round(84 + t * (70 - 84));
  }
  if (driverScore > redStart) {
    const span = redStart - yellowStart;
    const t = span === 0 ? 0 : (driverScore - yellowStart) / span;
    return Math.round(69 + t * (50 - 69));
  }
  const floor = redStart * 2;
  if (driverScore >= redStart) return 49;
  const span = floor - redStart;
  const t = span === 0 ? 1 : (driverScore - redStart) / span;
  return Math.max(0, Math.round(49 + t * (0 - 49)));
}

export function recommendedConsequence(
  category: ConsequenceCategory,
  occurrenceIndex = 1,
): string {
  const second = occurrenceIndex >= 2;
  switch (category) {
    case 'Green':
      return 'No disciplinary action — eligible for monthly / quarterly rewards';
    case 'Amber':
      return second ? 'Mandatory Driver Retraining' : 'Written Warning';
    case 'Yellow':
      return second ? 'One-Week Suspension' : 'Three-Day Suspension';
    case 'Red':
      return second ? 'Driver Terminated' : 'Two-Week Suspension';
  }
}

export function buildDriverConsequenceCard(input: {
  events: { label?: string | null; type?: string }[];
  distanceKm: number;
  occurrenceIndex?: number;
  config?: ConsequenceScoreConfig;
}): ConsequenceCard {
  const config = input.config ?? loadConsequenceConfig();
  const totals = countPenaltyEvents(input.events, config);
  const distanceKm = Math.max(0, input.distanceKm || 0);
  const driverScore = normalizeDriverScore(totals.penaltyPoints, distanceKm);
  const category = categorizeDriverScore(driverScore, config);
  const displayScore = toDisplayScore100(driverScore, config);
  const occurrenceIndex = Math.max(1, input.occurrenceIndex ?? 1);

  return {
    penaltyPoints: totals.penaltyPoints,
    distanceKm,
    driverScore: Number(driverScore.toFixed(2)),
    category,
    displayScore,
    categoryLabel: categoryPlainLabel(category),
    categoryColor: CATEGORY_COLORS[category],
    recommendedConsequence: recommendedConsequence(category, occurrenceIndex),
    occurrenceIndex,
    counts: {
      harshBraking: totals.harshBraking,
      harshAccel: totals.harshAccel,
      overspeeding: totals.overspeeding,
      cornering: totals.cornering,
      eventCount: totals.eventCount,
    },
  };
}

export const CONSEQUENCE_OCCURRENCES_KEY = 'bpl_consequence_occurrences';

export type OccurrenceStore = Record<
  string,
  { Amber?: number; Yellow?: number; Red?: number; lastLoggedAt?: string }
>;

export function loadConsequenceOccurrences(): OccurrenceStore {
  try {
    const raw = localStorage.getItem(CONSEQUENCE_OCCURRENCES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function saveConsequenceOccurrences(store: OccurrenceStore) {
  localStorage.setItem(CONSEQUENCE_OCCURRENCES_KEY, JSON.stringify(store));
}

export function getOccurrenceCount(
  store: OccurrenceStore,
  driverKey: string,
  category: ConsequenceCategory,
): number {
  if (category === 'Green') return 0;
  return store[driverKey]?.[category] ?? 0;
}

export function nextOccurrenceIndex(
  store: OccurrenceStore,
  driverKey: string,
  category: ConsequenceCategory,
): number {
  return getOccurrenceCount(store, driverKey, category) + 1;
}

export function logConsequenceResponse(
  store: OccurrenceStore,
  driverKey: string,
  category: ConsequenceCategory,
): OccurrenceStore {
  if (category === 'Green') return store;
  const prev = store[driverKey] || {};
  const next: OccurrenceStore = {
    ...store,
    [driverKey]: {
      ...prev,
      [category]: (prev[category] ?? 0) + 1,
      lastLoggedAt: new Date().toISOString(),
    },
  };
  saveConsequenceOccurrences(next);
  return next;
}

/** Text log of what response was actually taken, and who logged it. */
export const CONSEQUENCE_RESPONSE_LOG_KEY = 'bpl_consequence_response_log';

export interface ResponseLogEntry {
  id: string;
  driverKey: string;
  driverName: string;
  category: ConsequenceCategory;
  occurrenceIndex: number;
  note: string;
  loggedBy: string;
  loggedAt: string;
}

export function loadResponseLog(): ResponseLogEntry[] {
  try {
    const raw = localStorage.getItem(CONSEQUENCE_RESPONSE_LOG_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveResponseLog(entries: ResponseLogEntry[]) {
  try {
    localStorage.setItem(CONSEQUENCE_RESPONSE_LOG_KEY, JSON.stringify(entries));
  } catch { /* quota / private mode */ }
}

export function getResponseLogForDriver(driverKey: string): ResponseLogEntry[] {
  return loadResponseLog()
    .filter(e => e.driverKey === driverKey)
    .sort((a, b) => new Date(b.loggedAt).getTime() - new Date(a.loggedAt).getTime());
}

export function addResponseLogEntry(
  driverKey: string,
  driverName: string,
  category: ConsequenceCategory,
  occurrenceIndex: number,
  note: string,
  loggedBy: string,
): ResponseLogEntry {
  const entries = loadResponseLog();
  const entry: ResponseLogEntry = {
    id: `${driverKey}-${Date.now()}`,
    driverKey,
    driverName,
    category,
    occurrenceIndex,
    note: note.trim(),
    loggedBy: loggedBy.trim() || 'You',
    loggedAt: new Date().toISOString(),
  };
  entries.push(entry);
  saveResponseLog(entries);
  return entry;
}
