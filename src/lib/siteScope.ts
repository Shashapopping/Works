import type { FleetVehicle, LogEntry, TripDriver } from '../context/FleetContext';
import { assessmentDriverKey } from './driverAssessment';

export function makeScopedVehicleRegSet(vehicles: FleetVehicle[]) {
  return new Set(
    vehicles
      .map(v => v.regNo?.trim().toLowerCase())
      .filter((reg): reg is string => Boolean(reg)),
  );
}

export function makeScopedVehicleIdSet(vehicles: FleetVehicle[]) {
  return new Set(
    vehicles
      .map(v => v.id?.toString().trim())
      .filter((id): id is string => Boolean(id)),
  );
}

export function makeScopedVehicleSiteIdSet(vehicles: FleetVehicle[]) {
  return new Set(
    vehicles
      .map(v => v.siteId?.toString().trim())
      .filter((id): id is string => Boolean(id)),
  );
}

export function filterTripDriversByVehicles(tripDrivers: TripDriver[], vehicles: FleetVehicle[]) {
  const allowedRegs = makeScopedVehicleRegSet(vehicles);
  if (allowedRegs.size === 0) return [];
  return tripDrivers.filter(driver =>
    (driver.vehicles || []).some(reg => allowedRegs.has((reg || '').trim().toLowerCase())),
  );
}

/** Keep risk rollup rows for drivers tied to the scoped fleet (trips and/or asset id). */
export function filterRiskDriversByVehicles<T extends {
  driverId?: string | null;
  driverName?: string;
  assetId?: string | null;
}>(riskRows: T[], tripDrivers: TripDriver[], vehicles: FleetVehicle[]): T[] {
  if (!vehicles.length) return [];
  const allowedIds = makeScopedVehicleIdSet(vehicles);
  const allowedRegs = makeScopedVehicleRegSet(vehicles);
  const driverKeys = new Set<string>();
  for (const t of tripDrivers) {
    const key = assessmentDriverKey(t.driverId, t.driverName);
    if (key) driverKeys.add(key);
    const nameKey = (t.driverName || '').trim();
    if (nameKey) driverKeys.add(nameKey);
  }
  return riskRows.filter(row => {
    const assetId = row.assetId != null ? String(row.assetId).trim() : '';
    if (assetId && allowedIds.has(assetId)) return true;
    const key = assessmentDriverKey(row.driverId, row.driverName);
    if (key && driverKeys.has(key)) return true;
    const nameKey = (row.driverName || '').trim();
    if (nameKey && driverKeys.has(nameKey)) return true;
    if (assetId && allowedRegs.has(assetId.toLowerCase())) return true;
    return false;
  });
}

export function filterDistanceAssetsByVehicles<T extends { regNo?: string | null; assetId?: string | null }>(
  assets: T[],
  vehicles: FleetVehicle[],
) {
  const allowedRegs = makeScopedVehicleRegSet(vehicles);
  const allowedIds = makeScopedVehicleIdSet(vehicles);
  if (allowedRegs.size === 0 && allowedIds.size === 0) return [];
  return assets.filter(asset => {
    const reg = (asset.regNo || '').trim().toLowerCase();
    const id = (asset.assetId || '').toString().trim();
    return allowedRegs.has(reg) || allowedIds.has(id);
  });
}

export function summarizeEventsByLabel(events: LogEntry[]) {
  const byLabel: Record<string, number> = {};
  const assetIds = new Set<string>();

  for (const event of events) {
    if (event.type === 'panic') continue;
    const label = (event.label || '').trim();
    if (!label) continue;
    byLabel[label] = (byLabel[label] || 0) + 1;
    if (event.assetId) assetIds.add(String(event.assetId));
    else if (event.regNo) assetIds.add(event.regNo);
  }

  const incidentTotal = Object.values(byLabel).reduce((sum, count) => sum + count, 0);
  return {
    incidentTotal,
    byLabel,
    assetCount: assetIds.size,
  };
}
