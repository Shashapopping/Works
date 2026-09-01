import type { LogEntry } from '../reportExport';
import {
  connectivityBucket,
  CONNECTIVITY_EVENT_TYPES,
  isConnectivityEventType,
  type ConnectivityVehicle,
} from './connectivityCounts';

export interface FleetVehicleForConnectivity extends ConnectivityVehicle {
  id: string;
  regNo?: string;
  assetName?: string;
  site?: string;
  transporter?: string;
  zone?: string;
  driverName?: string;
  driverPhone?: string;
  address?: string;
}

export function buildConnectivityEntries(opts: {
  vehicles: FleetVehicleForConnectivity[];
  selectedTypes: Set<string>;
  matchesSite?: (vehicle: FleetVehicleForConnectivity) => boolean;
  matchesSearch?: (entry: LogEntry) => boolean;
  repeatOffenderIds?: Set<string>;
  windowHours?: number;
}): LogEntry[] {
  const wantsConnectivity = [...opts.selectedTypes].some(isConnectivityEventType);
  if (!wantsConnectivity) return [];

  const now = new Date().toISOString();
  const out: LogEntry[] = [];

  const windowHours = Math.max(1, opts.windowHours ?? 24);

  for (const v of opts.vehicles) {
    const label = connectivityBucket(v, { windowHours });
    if (!label || !opts.selectedTypes.has(label)) continue;
    if (opts.matchesSite && !opts.matchesSite(v)) continue;

    const eventTime = v.date && v.date !== 'N/A' ? v.date : now;
    const entry: LogEntry = {
      eventId: `connectivity:${v.id}:${label}`,
      label,
      type: 'warning',
      timestamp: eventTime,
      eventTime,
      assetId: v.id,
      regNo: v.regNo,
      assetName: v.assetName,
      site: v.site,
      transporter: v.transporter,
      driverName: v.driverName,
      driverPhone: v.driverPhone,
      address: v.address,
      connectivityNote: label === 'Offline' && opts.repeatOffenderIds?.has(v.id)
        ? 'Repeat offender'
        : undefined,
    };
    if (opts.matchesSearch && !opts.matchesSearch(entry)) continue;
    out.push(entry);
  }

  out.sort((a, b) => new Date(b.eventTime).getTime() - new Date(a.eventTime).getTime());
  return out;
}

export function selectedIvmsEventTypes(selected: Set<string>): string[] {
  return [...selected].filter(t => !isConnectivityEventType(t));
}

export function selectedConnectivityEventTypes(selected: Set<string>): string[] {
  return CONNECTIVITY_EVENT_TYPES.filter(t => selected.has(t));
}

export function wantsIvmsEvents(selected: Set<string>, allTypeCount: number): boolean {
  if (selected.size === 0) return false;
  if (selected.size >= allTypeCount) return true;
  return selectedIvmsEventTypes(selected).length > 0;
}
