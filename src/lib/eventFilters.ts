/**
 * Shared event-type filters for Event Explorer, trends, and event log panels.
 * Keep label strings aligned with MiX / SQLite `events.label`.
 */

export type EventFilterKey =
  | 'All'
  | 'Harsh Braking'
  | 'Harsh Acceleration'
  | 'Overspeeding'
  | 'Overspeed Tiered'
  | 'Road Speed Overspeeding'
  | 'Harsh Cornering';

export const EVENT_FILTER_OPTIONS: { key: EventFilterKey; label: string }[] = [
  { key: 'All', label: 'All' },
  { key: 'Harsh Braking', label: 'Harsh Braking' },
  { key: 'Harsh Acceleration', label: 'Harsh Acceleration' },
  { key: 'Overspeeding', label: 'Overspeeding' },
  { key: 'Overspeed Tiered', label: 'Overspeed Tiered' },
  { key: 'Road Speed Overspeeding', label: 'Road Speed' },
  { key: 'Harsh Cornering', label: 'Harsh Cornering' },
];

/** Labels plotted on trends / breakdown charts (excludes All). */
export const TREND_EVENT_LABELS: readonly EventFilterKey[] = [
  'Harsh Braking',
  'Harsh Acceleration',
  'Overspeeding',
  'Overspeed Tiered',
  'Road Speed Overspeeding',
  'Harsh Cornering',
] as const;

export function isEventFilterKey(value: string | null | undefined): value is EventFilterKey {
  return EVENT_FILTER_OPTIONS.some(f => f.key === value);
}

export function labelsForEventFilter(filter: EventFilterKey): string[] | null {
  if (filter === 'All') return null;
  return [filter];
}

export function rowMatchesEventFilter(
  row: { label?: string | null },
  filter: EventFilterKey,
): boolean {
  if (filter === 'All') return true;
  return (row.label || '') === filter;
}

export function filterEventsByType<T extends { label?: string | null }>(
  rows: T[],
  filter: EventFilterKey,
): T[] {
  if (filter === 'All') return rows;
  return rows.filter(r => rowMatchesEventFilter(r, filter));
}

/** `types` query param for /api/events/log (comma-separated exact labels). */
export function eventTypesQueryParam(filter: EventFilterKey): string | undefined {
  const labels = labelsForEventFilter(filter);
  if (!labels?.length) return undefined;
  return labels.join(',');
}

/** Sum overspeed-family counts for KPI cards (matches segment breakdown). */
export function sumOverspeedFamily(byLabel: Record<string, number | undefined> | undefined): number {
  if (!byLabel) return 0;
  return (byLabel['Overspeeding'] ?? 0)
    + (byLabel['Overspeed Tiered'] ?? 0)
    + (byLabel['Road Speed Overspeeding'] ?? 0);
}
