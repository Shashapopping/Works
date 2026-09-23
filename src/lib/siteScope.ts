import type { FleetVehicle, LogEntry, TripDriver } from '../context/FleetContext';
import { assessmentDriverKey } from './driverAssessment';
import { isExcludedFleetPlacement } from './fleetExclusions';

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

/** Resolve a driver's roster siteId from a lookup keyed by driverId and lowercased name. */
export function lookupDriverSiteId(
  siteIdByDriverKey: Map<string, string>,
  driverId?: string | null,
  driverName?: string | null,
): string | null {
  const id = (driverId || '').toString().trim();
  if (id && siteIdByDriverKey.has(id)) return siteIdByDriverKey.get(id)!;
  const name = (driverName || '').trim().toLowerCase();
  if (name && siteIdByDriverKey.has(name)) return siteIdByDriverKey.get(name)!;
  return null;
}

/**
 * HOS-style event membership for SafeIQ / alerts:
 * prefer driver roster siteId ∈ scoped vehicle SiteIds; else assetId / reg.
 */
export function eventMatchesAssignedSite(
  event: { driverId?: string | null; driverName?: string | null; assetId?: string | null; regNo?: string | null },
  vehicles: FleetVehicle[],
  siteIdByDriverKey: Map<string, string>,
): boolean {
  const allowedSiteIds = makeScopedVehicleSiteIdSet(vehicles);
  const allowedIds = makeScopedVehicleIdSet(vehicles);
  const allowedRegs = makeScopedVehicleRegSet(vehicles);
  if (allowedSiteIds.size === 0 && allowedIds.size === 0 && allowedRegs.size === 0) return false;
  const siteId = lookupDriverSiteId(siteIdByDriverKey, event.driverId, event.driverName);
  if (siteId) return allowedSiteIds.has(siteId);
  const assetId = event.assetId != null ? String(event.assetId).trim() : '';
  if (assetId && allowedIds.has(assetId)) return true;
  return !!event.regNo && allowedRegs.has(event.regNo.trim().toLowerCase());
}

/** Sorted unique scope keys for cache keys / query params. */
export function normalizeScopeKeys(keys: string[] = []) {
  return [...new Set(keys.map(k => k.trim()).filter(Boolean))].sort();
}

/**
 * Prefer explicit assetIds (matches client-filtered fleet exactly).
 * Fall back to siteScope only when IDs are not ready yet.
 */
export function appendUrlScope(
  url: string,
  opts: { siteScope?: string[]; assetIds?: string[] } = {},
) {
  const ids = normalizeScopeKeys(opts.assetIds || []);
  if (ids.length) {
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}assetIds=${encodeURIComponent(ids.join(','))}`;
  }
  const sites = normalizeScopeKeys(opts.siteScope);
  if (sites.length) {
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}siteScope=${encodeURIComponent(sites.join(','))}`;
  }
  return url;
}

/**
 * Compact site/transporter keys for rollup APIs (safety summary, risk, etc.).
 * Prefer this over expanding thousands of assetIds — large zones exceed Node's
 * ~16KB request-header limit and return empty/failed exposure (score flashes to 0).
 */
export function fleetSiteScopeOpts(selectedSites: string[]) {
  const sites = normalizeScopeKeys(selectedSites);
  if (!sites.length) return {};
  return { siteScope: sites };
}

/** Build scope opts from header filter + live fleet vehicles (full or pre-filtered). */
export function fleetScopeOpts(selectedSites: string[], vehicles: FleetVehicle[]) {
  const sites = normalizeScopeKeys(selectedSites);
  if (!sites.length) return {};
  const allowed = new Set(sites.map(s => s.toLowerCase()));
  const scoped = vehicles.filter(v => {
    const zone = ((v.zone || '').trim() || 'Unknown').toLowerCase();
    const site = (v.site || '').trim().toLowerCase();
    const transporter = (v.transporter || '').trim().toLowerCase();
    return allowed.has(zone) || allowed.has(site) || allowed.has(transporter);
  });
  const assetIds = scopedAssetIdList(scoped);
  // Prefer siteScope when the ID list would blow past typical HTTP header limits
  // (~16KB). Each MiX asset id is ~19 chars → ~500 ids keeps URLs safely under 12KB.
  if (assetIds.length && assetIds.length <= 500) return { assetIds };
  return { siteScope: sites };
}

/** Asset IDs from already site-filtered fleet vehicles. */
export function scopedAssetIdList(vehicles: FleetVehicle[]) {
  return Array.from(makeScopedVehicleIdSet(vehicles)).sort();
}

export function filterTripDriversByVehicles(tripDrivers: TripDriver[], vehicles: FleetVehicle[]) {
  const allowedRegs = makeScopedVehicleRegSet(vehicles);
  if (allowedRegs.size === 0) return [];
  return tripDrivers.filter(driver =>
    (driver.vehicles || []).some(reg => allowedRegs.has((reg || '').trim().toLowerCase())),
  );
}

/**
 * HOS-style membership: prefer driver roster siteId ∈ scoped vehicle SiteIds.
 * Fall back to trip vehicle regs only when the driver has no siteId.
 */
export function filterTripDriversByAssignedSite(tripDrivers: TripDriver[], vehicles: FleetVehicle[]) {
  const allowedSiteIds = makeScopedVehicleSiteIdSet(vehicles);
  const allowedRegs = makeScopedVehicleRegSet(vehicles);
  if (allowedSiteIds.size === 0 && allowedRegs.size === 0) return [];
  return tripDrivers.filter(driver => {
    const siteId = (driver.siteId || '').toString().trim();
    // Site scope follows the driver's roster site, not the trip vehicle.
    if (siteId) return allowedSiteIds.has(siteId);
    return (driver.vehicles || []).some(reg => allowedRegs.has((reg || '').trim().toLowerCase()));
  });
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

/**
 * HOS-style risk membership: prefer row.siteId ∈ scoped vehicle SiteIds.
 * Fall back to assetId (then trip-driver keys) when siteId is missing.
 */
export function filterRiskDriversByAssignedSite<T extends {
  driverId?: string | null;
  driverName?: string;
  assetId?: string | null;
  siteId?: string | null;
}>(riskRows: T[], tripDrivers: TripDriver[], vehicles: FleetVehicle[]): T[] {
  if (!vehicles.length) return [];
  const allowedSiteIds = makeScopedVehicleSiteIdSet(vehicles);
  const allowedIds = makeScopedVehicleIdSet(vehicles);
  const driverKeys = new Set<string>();
  for (const t of tripDrivers) {
    const key = assessmentDriverKey(t.driverId, t.driverName);
    if (key) driverKeys.add(key);
    const nameKey = (t.driverName || '').trim();
    if (nameKey) driverKeys.add(nameKey);
  }
  return riskRows.filter(row => {
    const siteId = (row.siteId || '').toString().trim();
    // Site column / scope follows the driver's roster site, not the trip vehicle.
    if (siteId) return allowedSiteIds.has(siteId);
    const assetId = row.assetId != null ? String(row.assetId).trim() : '';
    if (assetId && allowedIds.has(assetId)) return true;
    const key = assessmentDriverKey(row.driverId, row.driverName);
    if (key && driverKeys.has(key)) return true;
    const nameKey = (row.driverName || '').trim();
    return Boolean(nameKey && driverKeys.has(nameKey));
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

/** HOS rows: always drop XN / Non Operational; when site filter on, prefer roster siteId. */
export function filterHosRecordsByAssignedSite<T extends {
  site?: string | null;
  siteId?: string | null;
  assetId?: string | null;
  vehicleReg?: string | null;
}>(
  records: T[],
  vehicles: FleetVehicle[],
  siteFilterActive: boolean,
) {
  const liveIds = makeScopedVehicleIdSet(vehicles);
  const liveRegs = makeScopedVehicleRegSet(vehicles);

  const withoutExcluded = records.filter(record => {
    if (isExcludedFleetPlacement({ site: record.site, zone: record.site })) return false;
    const assetId = (record.assetId || '').toString().trim();
    if (assetId && liveIds.size > 0 && !liveIds.has(assetId)) return false;
    const reg = (record.vehicleReg || '').trim().toLowerCase();
    if (!assetId && reg && reg !== 'n/a' && liveRegs.size > 0 && !liveRegs.has(reg)) return false;
    return true;
  });

  if (!siteFilterActive) return withoutExcluded;

  const allowedSiteIds = makeScopedVehicleSiteIdSet(vehicles);
  const allowedIds = liveIds;
  const allowedRegs = liveRegs;
  if (allowedSiteIds.size === 0 && allowedIds.size === 0 && allowedRegs.size === 0) return [];
  return withoutExcluded.filter(record => {
    const siteId = (record.siteId || '').toString().trim();
    // Site column / scope follows the driver's roster site, not the trip vehicle.
    if (siteId) return allowedSiteIds.has(siteId);
    const assetId = (record.assetId || '').toString().trim();
    if (assetId && allowedIds.has(assetId)) return true;
    return allowedRegs.has((record.vehicleReg || '').trim().toLowerCase());
  });
}

/** @deprecated Prefer filterHosRecordsByAssignedSite — kept as alias for older call sites. */
export function filterHosRecordsByVehicles<T extends {
  siteId?: string | null;
  assetId?: string | null;
  vehicleReg?: string | null;
}>(
  records: T[],
  vehicles: FleetVehicle[],
  siteFilterActive: boolean,
) {
  return filterHosRecordsByAssignedSite(records, vehicles, siteFilterActive);
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
