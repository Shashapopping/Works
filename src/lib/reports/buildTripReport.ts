import { displayDriverName } from '../driverUtils';
import type { TabularReport } from '../reportTypes';

export type TripReportGroupBy = 'asset' | 'driver';

export interface JourneyRow {
  tripId?: string | null;
  assetId?: string | null;
  regNo?: string | null;
  assetName?: string | null;
  driverId?: string | null;
  driverName?: string | null;
  tripStart?: string | null;
  tripEnd?: string | null;
  distanceKm?: number;
  drivingTimeSeconds?: number;
  durationSeconds?: number;
  maxSpeedKph?: number | null;
}

function fmtDateTime(iso?: string | null) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return String(iso);
  }
}

function hours(seconds?: number) {
  if (!seconds || seconds <= 0) return '0';
  return (seconds / 3600).toFixed(2);
}

function avgSpeed(distanceKm: number, drivingTimeSeconds: number) {
  if (!drivingTimeSeconds || drivingTimeSeconds <= 0) return '—';
  return (distanceKm / (drivingTimeSeconds / 3600)).toFixed(1);
}

function groupKey(j: JourneyRow, groupBy: TripReportGroupBy): string {
  if (groupBy === 'driver') {
    return (j.driverId && String(j.driverId)) || j.driverName || 'Unknown driver';
  }
  return (j.assetId && String(j.assetId)) || j.regNo || 'Unknown asset';
}

function groupLabel(j: JourneyRow, groupBy: TripReportGroupBy): string {
  if (groupBy === 'driver') {
    return displayDriverName(j.driverName, 'Unknown driver');
  }
  const reg = j.regNo && j.regNo !== 'N/A' ? j.regNo : null;
  const name = j.assetName && j.assetName !== 'N/A' ? j.assetName : null;
  if (reg && name) return `${reg} · ${name}`;
  return reg || name || j.assetId || 'Unknown asset';
}

/**
 * Trip distance report — grouped by asset or driver.
 * Columns limited to start/end + distance metrics (no journey-id fluff).
 */
export function buildTripReport(opts: {
  journeys: JourneyRow[];
  reportTitle: string;
  meta: string;
  search?: string;
  groupBy?: TripReportGroupBy;
}): TabularReport {
  const q = (opts.search || '').trim().toLowerCase();
  const groupBy: TripReportGroupBy = opts.groupBy === 'driver' ? 'driver' : 'asset';

  const columns = [
    { header: groupBy === 'driver' ? 'Driver' : 'Asset', width: 28 },
    { header: groupBy === 'driver' ? 'Reg No' : 'Driver', textForce: true, width: 18 },
    { header: 'Trip start', width: 18 },
    { header: 'Trip end', width: 18 },
    { header: 'Distance km', width: 12 },
    { header: 'Driving time h', width: 12 },
    { header: 'Duration h', width: 12 },
    { header: 'Max speed kph', width: 12 },
    { header: 'Avg speed kph', width: 12 },
  ];

  const filtered = (opts.journeys || []).filter(j => {
    if (!q) return true;
    const hay = `${j.regNo || ''} ${j.assetName || ''} ${j.driverName || ''} ${j.assetId || ''}`.toLowerCase();
    return hay.includes(q);
  });

  const buckets = new Map<string, { label: string; trips: JourneyRow[] }>();
  for (const j of filtered) {
    const key = groupKey(j, groupBy);
    if (!buckets.has(key)) {
      buckets.set(key, { label: groupLabel(j, groupBy), trips: [] });
    }
    buckets.get(key)!.trips.push(j);
  }

  const ordered = Array.from(buckets.entries()).sort((a, b) => {
    const da = a[1].trips.reduce((s, t) => s + Number(t.distanceKm || 0), 0);
    const db = b[1].trips.reduce((s, t) => s + Number(t.distanceKm || 0), 0);
    return db - da;
  });

  const rows: string[][] = [];
  for (const [, bucket] of ordered) {
    const trips = [...bucket.trips].sort((x, y) => {
      const ax = x.tripStart ? new Date(x.tripStart).getTime() : 0;
      const ay = y.tripStart ? new Date(y.tripStart).getTime() : 0;
      return ay - ax;
    });
    const totalKm = trips.reduce((s, t) => s + Number(t.distanceKm || 0), 0);
    const totalDrive = trips.reduce((s, t) => s + Number(t.drivingTimeSeconds || 0), 0);
    const totalDur = trips.reduce(
      (s, t) => s + Number(t.durationSeconds || t.drivingTimeSeconds || 0),
      0,
    );
    const maxSpd = trips.reduce(
      (m, t) => Math.max(m, t.maxSpeedKph != null ? Number(t.maxSpeedKph) : 0),
      0,
    );

    // Group summary row
    rows.push([
      bucket.label,
      `${trips.length} trip${trips.length === 1 ? '' : 's'}`,
      '—',
      '—',
      totalKm.toFixed(1),
      hours(totalDrive),
      hours(totalDur),
      maxSpd > 0 ? String(Math.round(maxSpd)) : '—',
      avgSpeed(totalKm, totalDrive),
    ]);

    for (const j of trips) {
      const distanceKm = Number(j.distanceKm || 0);
      const driveSec = Number(j.drivingTimeSeconds || 0);
      const durSec = Number(j.durationSeconds || driveSec || 0);
      const secondary =
        groupBy === 'driver'
          ? (j.regNo && j.regNo !== 'N/A' ? j.regNo : '—')
          : displayDriverName(j.driverName, '—');
      rows.push([
        '', // under parent group
        secondary,
        fmtDateTime(j.tripStart),
        fmtDateTime(j.tripEnd),
        distanceKm.toFixed(1),
        hours(driveSec),
        hours(durSec),
        j.maxSpeedKph != null ? String(Math.round(j.maxSpeedKph)) : '—',
        avgSpeed(distanceKm, driveSec),
      ]);
    }
  }

  return {
    reportType: 'trips',
    title: opts.reportTitle,
    meta: opts.meta,
    columns,
    rows,
    rowCount: rows.length,
    archiveType: 'Trips',
  };
}

/** Prefer raw MiX trips; fall back to merged journeys. */
export function flattenJourneysFromDistanceAssets(
  assets: Array<{
    assetId?: string;
    regNo?: string;
    assetName?: string;
    trips?: JourneyRow[];
    journeys?: JourneyRow[];
  }>,
): JourneyRow[] {
  const out: JourneyRow[] = [];
  for (const a of assets || []) {
    const list = (a.trips && a.trips.length > 0) ? a.trips : (a.journeys || []);
    for (const j of list) {
      out.push({
        ...j,
        assetId: j.assetId || a.assetId,
        regNo: j.regNo || a.regNo,
        assetName: j.assetName || a.assetName,
      });
    }
  }
  return out.sort((x, y) => {
    const ax = x.tripStart ? new Date(x.tripStart).getTime() : 0;
    const ay = y.tripStart ? new Date(y.tripStart).getTime() : 0;
    return ay - ax;
  });
}
