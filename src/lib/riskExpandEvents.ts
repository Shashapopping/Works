import type { LogEntry } from '../context/FleetContext';
import { pagePeriodIsoBounds, type PageDateRange } from './pagePeriod';
import { filterOverspeedEvents } from './overspeedFilter';

export function parseEventsLogPayload(data: unknown): LogEntry[] {
  if (!data) return [];
  const rows = Array.isArray(data) ? data : (data as { entries?: LogEntry[] }).entries ?? [];
  return filterOverspeedEvents(rows);
}

export function assetExpandEventsUrl(
  asset: { assetId: string; regNo?: string },
  range: PageDateRange,
  customFrom: string,
  customTo: string,
): string {
  const b = pagePeriodIsoBounds(range, customFrom, customTo);
  const params = new URLSearchParams();
  params.set('limit', 'all');
  if (asset.assetId) params.set('assetId', asset.assetId);
  else if (asset.regNo) params.set('q', asset.regNo.trim());
  if (b.from) params.set('from', b.from);
  if (b.to) params.set('to', b.to);
  return `/api/events/log?${params}`;
}

export function driverExpandEventsUrl(
  driverName: string,
  range: PageDateRange,
  customFrom: string,
  customTo: string,
): string {
  const b = pagePeriodIsoBounds(range, customFrom, customTo);
  const params = new URLSearchParams();
  params.set('limit', 'all');
  params.set('driver', driverName);
  if (b.from) params.set('from', b.from);
  if (b.to) params.set('to', b.to);
  return `/api/events/log?${params}`;
}

export function formatExpandEventTime(iso: string) {
  try {
    return new Date(iso).toLocaleString('en-GB', {
      timeZone: 'Africa/Lagos',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function sortEventsNewestFirst(events: LogEntry[]) {
  return [...events].sort(
    (a, b) => new Date(b.eventTime || b.timestamp).getTime() - new Date(a.eventTime || a.timestamp).getTime(),
  );
}
