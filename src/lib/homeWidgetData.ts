import type { LogEntry, Vehicle } from '../context/FleetContext';
import { displayDriverName, isKnownDriver } from './driverUtils';
import { brandLabel } from './branding';

export type StatusFilter =
  | 'All'
  | 'Moving'
  | 'Idle'
  | 'Excessive Idle'
  | 'Stationary'
  | 'Parked'
  | 'Offline'
  | 'Inactive';

export interface AlertItem {
  id: string;
  label: string;
  vehicle: string;
  driver: string;
  time: string;
  severity: 'critical' | 'warning' | 'info';
  speed?: number | null;
  speedLimit?: number | null;
}

export interface MaintenanceItem {
  vehicle: string;
  assetName: string;
  service: string;
  due: string;
  urgency: 'high' | 'medium' | 'low';
}

export interface FuelDay {
  day: string;
  liters: number;
}

export interface AiInsight {
  id: string;
  title: string;
  description: string;
  type: 'fuel' | 'safety' | 'route' | 'maintenance';
}

export const HOME_ALERT_LABELS = [
  'Harsh Braking',
  'Harsh Acceleration',
  'Overspeeding',
  'Overspeed Tiered',
  'Harsh Cornering',
] as const;

const HOME_ALERT_LABEL_SET = new Set<string>(HOME_ALERT_LABELS);

/** Stable ISO so Home alert / events cache keys do not change every millisecond. */
export function bucketedIso(atMs = Date.now(), bucketMs = 60_000) {
  return new Date(Math.ceil(atMs / bucketMs) * bucketMs).toISOString();
}

/** Cheap Home card feed: 12 typed incidents, not 500 mixed events. */
export function buildHomeAlertsUrl(opts?: { assetIds?: string[]; siteScope?: string[] }) {
  const to = bucketedIso();
  const from = new Date(new Date(to).getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const params = new URLSearchParams({
    from,
    to,
    limit: '12',
    excludeHidden: '1',
    types: HOME_ALERT_LABELS.join(','),
  });
  if (opts?.assetIds?.length) params.set('assetIds', opts.assetIds.join(','));
  else if (opts?.siteScope?.length) params.set('siteScope', opts.siteScope.join(','));
  return `/api/events/log?${params.toString()}`;
}

function timeAgo(ts: string) {
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function deriveAlerts(events: LogEntry[]): AlertItem[] {
  return events
    .filter(e => e.type !== 'panic' && HOME_ALERT_LABEL_SET.has(e.label || ''))
    .slice(0, 12)
    .map(e => ({
      id: e.eventId,
      label: e.label || 'Incident',
      vehicle: e.regNo || e.assetId || 'Unknown',
      driver: displayDriverName(e.driverName, 'Unassigned'),
      time: timeAgo(e.eventTime || e.timestamp),
      severity: e.label === 'Harsh Braking' || e.label === 'Overspeed Tiered'
        ? 'warning' as const
        : e.label === 'Overspeeding'
        ? 'critical' as const
        : 'info' as const,
      speed: e.speed ?? null,
      speedLimit: e.speedLimit ?? null,
    }));
}

export function deriveInsights(events: LogEntry[], vehicles: Vehicle[]): AiInsight[] {
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const recent = events.filter(e => new Date(e.eventTime || e.timestamp).getTime() >= thirtyDaysAgo);
  const harsh = recent.filter(e => e.type !== 'panic' && e.label === 'Harsh Braking').length;
  const lowFuel = vehicles.filter(v => {
    const level = (v as Vehicle & { fuelLevel?: { level: number } }).fuelLevel?.level;
    return level != null && level < 20;
  }).length;

  const insights: AiInsight[] = [];
  if (harsh > 0) {
    insights.push({
      id: 'safety-harsh',
      title: 'Harsh braking activity',
      description: `${harsh} harsh braking event${harsh === 1 ? '' : 's'} in the last 30 days — coaching review suggested.`,
      type: 'safety',
    });
  }
  if (lowFuel > 0) {
    insights.push({
      id: 'fuel-low',
      title: 'Low fuel levels',
      description: `${lowFuel} vehicle${lowFuel === 1 ? '' : 's'} below 20% probe reading.`,
      type: 'fuel',
    });
  }
  if (insights.length === 0) {
    insights.push({
      id: 'all-clear',
      title: 'Fleet operating normally',
      description: 'No significant anomalies detected in recent telemetry.',
      type: 'safety',
    });
  }
  return insights.slice(0, 3);
}

export function normalizeVehicle(v: Vehicle) {
  return {
    ...v,
    transporter: brandLabel(v.transporter) || v.transporter,
    address: v.position?.address || '—',
    site: v.site || 'Unknown',
    zone: v.zone,
    fuelLevel: v.fuelLevel ?? null,
  };
}

export const DEFAULT_MAINTENANCE: MaintenanceItem[] = [
  { vehicle: '—', assetName: 'Fleet service', service: 'Scheduled maintenance', due: 'Review schedule', urgency: 'low' },
];

export const DEFAULT_FUEL_SERIES: FuelDay[] = [
  { day: 'Mon', liters: 0 },
  { day: 'Tue', liters: 0 },
  { day: 'Wed', liters: 0 },
  { day: 'Thu', liters: 0 },
  { day: 'Fri', liters: 0 },
  { day: 'Sat', liters: 0 },
  { day: 'Sun', liters: 0 },
];

export interface TripItem {
  id: string;
  vehicle: string;
  driver: string;
  route: string;
  timing: 'On Time' | 'Delayed' | 'Completed';
  status: 'Ongoing' | 'Completed';
  progress: number;
  eta: string;
}

export const DEMO_TRIPS: TripItem[] = [
  { id: '1', vehicle: 'FLT-0042', driver: 'Alex Morgan', route: 'North Quarry → Central Depot', timing: 'On Time', status: 'Ongoing', progress: 72, eta: '14:30' },
  { id: '2', vehicle: 'FLT-0033', driver: 'Sam Rivera', route: 'Quarry → East Terminal', timing: 'Delayed', status: 'Ongoing', progress: 45, eta: '15:10' },
  { id: '3', vehicle: 'FLT-0017', driver: 'Jordan Lee', route: 'West Depot → South Plant', timing: 'On Time', status: 'Ongoing', progress: 88, eta: '13:45' },
  { id: '4', vehicle: 'FLT-0055', driver: 'Taylor Reed', route: 'Hub → North Quarry', timing: 'Completed', status: 'Completed', progress: 100, eta: '12:00' },
];
