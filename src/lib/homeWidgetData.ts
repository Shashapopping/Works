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
}

export interface DriverScore {
  name: string;
  score: number;
  trend: 'up' | 'down' | 'stable';
  incidents: number;
  harshBraking: number;
  overspeeding: number;
  lastEvent: string | null;
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

function timeAgo(ts: string) {
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function deriveAlerts(events: LogEntry[]): AlertItem[] {
  return events
    .filter(e => e.type !== 'panic' && (
      e.label === 'Harsh Braking'
      || e.label === 'Harsh Acceleration'
      || e.label === 'Overspeeding'
      || e.label === 'Overspeed Tiered'
      || e.label === 'Harsh Cornering'
    ))
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
    }));
}

export function deriveDriverScores(events: LogEntry[], penaltyPerEvent = 3): DriverScore[] {
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const sixtyDaysAgo = Date.now() - 60 * 24 * 60 * 60 * 1000;
  const byDriver = new Map<string, {
    recent: number;
    prev: number;
    harshBraking: number;
    overspeeding: number;
    lastMs: number;
  }>();

  events.forEach(e => {
    const name = e.driverName;
    if (!isKnownDriver(name)) return;
    const t = new Date(e.eventTime || e.timestamp).getTime();
    if (!Number.isFinite(t)) return;
    if (!byDriver.has(name!)) {
      byDriver.set(name!, { recent: 0, prev: 0, harshBraking: 0, overspeeding: 0, lastMs: 0 });
    }
    const row = byDriver.get(name!)!;
    if (t >= thirtyDaysAgo) {
      row.recent++;
      if (e.label === 'Harsh Braking') row.harshBraking++;
      if (e.label === 'Overspeeding' || e.label === 'Overspeed Tiered') row.overspeeding++;
      if (t > row.lastMs) row.lastMs = t;
    } else if (t >= sixtyDaysAgo) {
      row.prev++;
    }
  });

  return [...byDriver.entries()]
    .map(([name, row]) => ({
      name,
      score: Math.max(35, Math.min(100, 100 - row.recent * penaltyPerEvent)),
      trend: row.recent < row.prev ? 'up' as const : row.recent > row.prev ? 'down' as const : 'stable' as const,
      incidents: row.recent,
      harshBraking: row.harshBraking,
      overspeeding: row.overspeeding,
      lastEvent: row.lastMs > 0 ? timeAgo(new Date(row.lastMs).toISOString()) : null,
    }))
    .sort((a, b) => a.score - b.score || b.incidents - a.incidents)
    .slice(0, 12);
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
