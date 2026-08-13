import { displayDriverName } from '../driverUtils';
import type { TabularReport } from '../reportTypes';

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

function fmtTime(iso?: string | null) {
  if (!iso) return 'N/A';
  try {
    return new Date(iso).toLocaleString('en-GB');
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

export function buildTripReport(opts: {
  journeys: JourneyRow[];
  reportTitle: string;
  meta: string;
  search?: string;
}): TabularReport {
  const q = (opts.search || '').trim().toLowerCase();
  const columns = [
    { header: 'Journey id', width: 18 },
    { header: 'Reg No', textForce: true, width: 14 },
    { header: 'Asset name', width: 22 },
    { header: 'Driver', width: 20 },
    { header: 'Trip start', width: 18 },
    { header: 'Trip end', width: 18 },
    { header: 'Distance km', width: 12 },
    { header: 'Driving time h', width: 12 },
    { header: 'Duration h', width: 12 },
    { header: 'Max speed kph', width: 12 },
    { header: 'Avg speed kph', width: 12 },
  ];

  const rows: string[][] = [];
  for (const j of opts.journeys) {
    const reg = j.regNo || 'N/A';
    const asset = j.assetName || 'N/A';
    const driver = displayDriverName(j.driverName, 'N/A');
    if (q) {
      const hay = `${reg} ${asset} ${driver} ${j.tripId || ''}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }
    const distanceKm = Number(j.distanceKm || 0);
    const driveSec = Number(j.drivingTimeSeconds || 0);
    const durSec = Number(j.durationSeconds || driveSec || 0);
    rows.push([
      String(j.tripId || `${j.assetId || 'asset'}-${j.tripStart || rows.length}`),
      reg,
      asset,
      driver,
      fmtTime(j.tripStart),
      fmtTime(j.tripEnd),
      distanceKm.toFixed(1),
      hours(driveSec),
      hours(durSec),
      j.maxSpeedKph != null ? String(Math.round(j.maxSpeedKph)) : '—',
      avgSpeed(distanceKm, driveSec),
    ]);
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

/** Flatten asset summaries that still include journeys (includeJourneys=1). */
export function flattenJourneysFromDistanceAssets(
  assets: Array<{
    assetId?: string;
    regNo?: string;
    assetName?: string;
    journeys?: JourneyRow[];
  }>,
): JourneyRow[] {
  const out: JourneyRow[] = [];
  for (const a of assets || []) {
    for (const j of a.journeys || []) {
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
