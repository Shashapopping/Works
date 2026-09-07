import {
  CONNECTIVITY_EVENT_TYPES,
  connectivityCountsFromGps,
  NO_RECENT_COMMUNICATION,
  normalizeConnectivityEventType,
  type ConnectivityVehicle,
} from './connectivityCounts';

export type ReportEventGroup = 'ivms' | 'connectivity';

export interface ReportEventTypeDef {
  id: string;
  hint: string;
  group: ReportEventGroup;
}

export const REPORT_EVENT_TYPE_CATALOG: ReportEventTypeDef[] = [
  { id: 'Harsh Braking', hint: 'Sudden heavy braking', group: 'ivms' },
  { id: 'Harsh Acceleration', hint: 'Hard pull-away or surge', group: 'ivms' },
  { id: 'Overspeeding', hint: 'Speed above limit', group: 'ivms' },
  { id: 'Overspeed Tiered', hint: 'Tiered road-speed breach', group: 'ivms' },
  { id: 'Harsh Cornering', hint: 'Sharp turn at speed', group: 'ivms' },
  {
    id: NO_RECENT_COMMUNICATION,
    hint: 'No GPS for 2 hours. Stored once, then emailed on the next hourly run.',
    group: 'connectivity',
  },
  {
    id: 'Offline',
    hint: 'Not receiving GPS (24h–30d). Excludes Non-Operational and No recent communication.',
    group: 'connectivity',
  },
  {
    id: 'Non-Operational',
    hint: 'No GPS for 30+ days — excluded from Offline and No recent communication.',
    group: 'connectivity',
  },
];

export const REPORT_EVENT_TYPE_IDS = REPORT_EVENT_TYPE_CATALOG.map(o => o.id);

export function reportEventTypeDef(id: string): ReportEventTypeDef | undefined {
  return REPORT_EVENT_TYPE_CATALOG.find(o => o.id === normalizeConnectivityEventType(id));
}

const NO_RECENT_COMMUNICATION_DISPLAY_LABEL = 'No recent communication (2 hrs)';

export function connectivityEventDisplayLabel(bucket: string): string {
  const normalized = normalizeConnectivityEventType(bucket);
  if (normalized === NO_RECENT_COMMUNICATION) return NO_RECENT_COMMUNICATION_DISPLAY_LABEL;
  return bucket || 'Unknown';
}

export function formatEventTypeOptionLabel(
  id: string,
  count?: number | null,
): string {
  const normalized = normalizeConnectivityEventType(id);
  const def = reportEventTypeDef(normalized);
  const hint = def?.hint ?? '';
  const label = normalized === NO_RECENT_COMMUNICATION ? NO_RECENT_COMMUNICATION_DISPLAY_LABEL : normalized;
  const countPart = count != null && count >= 0 ? ` · ${count.toLocaleString()}` : '';
  return hint ? `${label}${countPart} — ${hint}` : `${label}${countPart}`;
}

export function buildEventTypeCounts(
  ivmsCounts: Record<string, number>,
  vehicles: ConnectivityVehicle[],
  windowHours = 24,
): Record<string, number> {
  const gps = connectivityCountsFromGps(vehicles, windowHours);
  const out: Record<string, number> = { ...ivmsCounts };
  for (const type of CONNECTIVITY_EVENT_TYPES) {
    out[type] = gps[type];
  }
  return out;
}
