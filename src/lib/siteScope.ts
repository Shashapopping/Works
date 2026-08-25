import type { FleetVehicle, LogEntry, TripDriver } from '../context/FleetContext';

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

export function filterTripDriversByVehicles(tripDrivers: TripDriver[], vehicles: FleetVehicle[]) {
  const allowedRegs = makeScopedVehicleRegSet(vehicles);
  if (allowedRegs.size === 0) return [];
  return tripDrivers.filter(driver =>
    (driver.vehicles || []).some(reg => allowedRegs.has((reg || '').trim().toLowerCase())),
  );
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
