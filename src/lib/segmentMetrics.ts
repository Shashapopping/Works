import type { Vehicle, TripAsset, LogEntry } from '../context/FleetContext';
import { filterVehiclesBySegment, type FleetSegmentId } from './fleetSegments';
import { brandLabel } from './branding';

export const STATUS_COLOR: Record<string, string> = {
  Moving: '#16a34a',
  Idle: '#d97706',
  'Excessive Idle': '#CC0000',
  Stationary: '#0d9488',
  Parked: '#7C3AED',
  Offline: '#6B7A8D',
  Inactive: '#6878A0',
};

/** Nominal payload per quarry haul cycle (tonnes) — proxy until weighbridge integration. */
export const QUARRY_NOMINAL_TONNES = 25;

export function segmentVehicles(all: Vehicle[], segment: FleetSegmentId) {
  return filterVehiclesBySegment(all, segment);
}

export function segmentTripAssets(vehicles: Vehicle[], assets: TripAsset[] = []) {
  const ids = new Set(vehicles.map(v => v.id?.toString()));
  return assets.filter(a => ids.has(a.assetId?.toString()));
}

export function countByStatus(vehicles: Vehicle[]) {
  const counts: Record<string, number> = {};
  for (const v of vehicles) counts[v.status] = (counts[v.status] ?? 0) + 1;
  return counts;
}

export function groupByZone(vehicles: Vehicle[]) {
  const map: Record<string, Vehicle[]> = {};
  for (const v of vehicles) {
    const z = (v.zone || 'Unknown').trim();
    if (!map[z]) map[z] = [];
    map[z].push(v);
  }
  return Object.entries(map).sort((a, b) => b[1].length - a[1].length);
}

export function utilizationPct(vehicles: Vehicle[]) {
  const deployable = vehicles.filter(v => v.status !== 'Offline' && v.status !== 'Inactive');
  const moving = vehicles.filter(v => v.status === 'Moving').length;
  return deployable.length ? Math.round((moving / deployable.length) * 100) : 0;
}

export function quarrySiteLabel(zone?: string | null) {
  const z = (zone || '').toUpperCase();
  if (/EWEKORO/.test(z)) return 'Ewekoro';
  if (/MFAMOSING/.test(z)) return 'Mfamosing';
  return 'Other quarry';
}

export function quarryThroughput(assets: TripAsset[]) {
  const journeys = assets.reduce((s, a) => s + a.journeyCount, 0);
  const distanceKm = assets.reduce((s, a) => s + a.totalDistanceKm, 0);
  const drivingSec = assets.reduce((s, a) => s + a.totalDrivingTimeSeconds, 0);
  const estTonnes = journeys * QUARRY_NOMINAL_TONNES;
  const avgCycleMin = journeys > 0 ? Math.round(drivingSec / journeys / 60) : null;
  const tripsPerTruck = assets.length ? (journeys / assets.length).toFixed(1) : '0';
  return { journeys, estTonnes, distanceKm, avgCycleMin, tripsPerTruck, activeHaulers: assets.length };
}

export function cementCorridor(zone?: string | null) {
  const z = (zone || '').toUpperCase();
  if (/HBM\s*-\s*NORTH|\bNORTH\b/.test(z)) return 'North';
  if (/EAST\s*INBOUND|\bEAST\b/.test(z)) return 'East';
  if (/WEST\s*INBOUND|\bWEST\b/.test(z)) return 'West';
  if (/\bMDD\b/.test(z)) return 'MDD Transporters';
  if (/\bDD\b/.test(z)) return 'DD Distribution';
  if (/SPOT\s*HIRE/.test(z)) return 'Spot Hire';
  if (/INBOUND/.test(z)) return 'Inbound';
  if (/DEPOT/.test(z)) return 'Depots';
  return 'Other';
}

export function isSpotHireVehicle(v: Vehicle) {
  const z = (v.zone || '').toUpperCase();
  const site = (v.site || '').toUpperCase();
  return /SPOT\s*HIRE/.test(z) || /SPOT/.test(site) || /NON LH/.test(site);
}

/**
 * Ready-mix plant hub from MiX organisation `site` (primary) + zone/address fallback.
 * MiX sites.json has no lat/lng — plant assignment lives on the vehicle's `site` field
 * (e.g. "TRULUCK/LAGOS PLANT"). Zone is usually just "READY MIX".
 */
export function readyMixPlant(v: Pick<Vehicle, 'site' | 'zone'> | string | null | undefined) {
  const site = typeof v === 'string' || v == null ? '' : (v.site || '');
  const zone = typeof v === 'string' ? v : (v?.zone || '');
  const text = `${site} ${zone}`.toUpperCase();

  if (/SPOT\s*HIRE|SPOT/.test(text)) return 'Spot / Hire';
  if (/LAGOS|OREGUN|IKEJA|LEKKI|VICTORIA|ETI.?OSA|AJAH/.test(text)) return 'Lagos';
  if (/ABUJA|IDU/.test(text)) return 'Abuja';
  if (/\bPH\b|PORT\s*HARCOURT|TRANS.?AMADI/.test(text)) return 'Port Harcourt';
  if (/EWEKORO|OGUN|ABEOKUTA|SHAGAMU|SAGAMU/.test(text)) return 'Ewekoro';
  if (/ASHAKA|CALABAR/.test(text)) return 'Other plant';
  if (/READY\s*MIX|RDYMIX|RMX|PLANT|PUMP/.test(text)) return 'Ready Mix (unassigned hub)';
  return site.trim() || zone.trim() || 'Unassigned';
}

/** Prefer reverse-geocoded address; if MiX returns "Unknown", use site/zone then coordinates. */
export function locationLabel(v: Pick<Vehicle, 'position' | 'zone' | 'site'>) {
  const addr = v.position?.address?.trim();
  if (addr && addr !== 'Unknown' && addr.toLowerCase() !== 'n/a') return brandLabel(addr);
  const siteOrZone = (v.site || v.zone || '').trim();
  if (siteOrZone) return brandLabel(siteOrZone);
  const lat = v.position?.latitude;
  const lng = v.position?.longitude;
  if (lat != null && lng != null && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) {
    return `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`;
  }
  return '—';
}

export function tankerCorridor(zone?: string | null): 'East' | 'West' | 'Other' {
  const z = (zone || '').toUpperCase();
  if (/EAST/.test(z)) return 'East';
  if (/WEST/.test(z)) return 'West';
  return 'Other';
}

export function segmentEvents(vehicles: Vehicle[], events: LogEntry[]) {
  const ids = new Set(vehicles.map(v => v.id?.toString()));
  const regs = new Set(vehicles.map(v => v.regNo).filter(Boolean));
  return events.filter(e =>
    (e.assetId != null && ids.has(e.assetId.toString())) || (e.regNo != null && regs.has(e.regNo)),
  );
}

export function overspeedCount(events: LogEntry[], days = 30) {
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  return events.filter(e => {
    const t = new Date(e.eventTime || e.timestamp).getTime();
    return t >= since && (e.label === 'Overspeeding' || e.label === 'Overspeed Tiered');
  }).length;
}

/**
 * Dispatch state for ready-mix.
 *
 * Prefer GPS geofence + true stop (speed ≈ 0) over MiX site-name heuristics.
 * Optional open-trip set confirms a vehicle is still on a delivery cycle
 * (stopped away from plant → jobsite; near plant while loading still counts as plant).
 */
export const READY_MIX_PLANT_RADIUS_M = 1500;

/** Seed pins from observed idle clusters (Lagos yards, Sagamu corridor, Abuja, PH). */
export const READY_MIX_PLANT_SEEDS: Array<{ id: string; label: string; lat: number; lng: number }> = [
  { id: 'lagos-lekki', label: 'Lagos plant cluster', lat: 6.435, lng: 3.448 },
  { id: 'lagos-ikeja', label: 'Lagos north cluster', lat: 6.583, lng: 3.377 },
  { id: 'sagamu-yard', label: 'Sagamu / Lagos corridor yard', lat: 6.814, lng: 3.617 },
  { id: 'truluck-lagos', label: 'Truluck Lagos yard', lat: 6.871, lng: 3.216 },
  { id: 'abuja', label: 'Abuja plant', lat: 9.036, lng: 7.385 },
  { id: 'ph', label: 'Port Harcourt plant', lat: 4.802, lng: 7.041 },
  { id: 'epe', label: 'Epe / pump yard', lat: 6.600, lng: 3.951 },
];

export function haversineMeters(
  lat1: number, lng1: number, lat2: number, lng2: number,
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Refine plant pins by clustering stopped mixers currently on plant-named MiX sites. */
export function deriveReadyMixPlantPins(vehicles: Vehicle[]) {
  type Acc = { lat: number; lng: number; n: number; sites: Record<string, number> };
  const cells = new Map<string, Acc>();

  for (const v of vehicles) {
    const lat = v.position?.latitude;
    const lng = v.position?.longitude;
    if (lat == null || lng == null || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) continue;
    const site = (v.site || '').toUpperCase();
    if (!/PLANT|READY\s*MIX|RDYMIX|RMX|PUMP/.test(site)) continue;
    if (!['Idle', 'Stationary', 'Excessive Idle', 'Parked'].includes(v.status)) continue;
    const speed = Number((v.position as { speed?: number } | undefined)?.speed ?? 0);
    if (speed >= 5) continue;

    const key = `${Number(lat).toFixed(2)},${Number(lng).toFixed(2)}`;
    const acc = cells.get(key) || { lat: 0, lng: 0, n: 0, sites: {} };
    acc.lat += Number(lat);
    acc.lng += Number(lng);
    acc.n += 1;
    acc.sites[v.site || 'Plant'] = (acc.sites[v.site || 'Plant'] || 0) + 1;
    cells.set(key, acc);
  }

  const derived = [...cells.entries()]
    .filter(([, a]) => a.n >= 2)
    .map(([key, a]) => {
      const topSite = Object.entries(a.sites).sort((x, y) => y[1] - x[1])[0]?.[0] || 'Plant yard';
      return {
        id: `live:${key}`,
        label: topSite,
        lat: a.lat / a.n,
        lng: a.lng / a.n,
      };
    });

  return [...READY_MIX_PLANT_SEEDS, ...derived];
}

export function isNearReadyMixPlant(
  v: Vehicle,
  pins: Array<{ lat: number; lng: number }> = READY_MIX_PLANT_SEEDS,
  radiusM = READY_MIX_PLANT_RADIUS_M,
): boolean {
  const lat = v.position?.latitude;
  const lng = v.position?.longitude;
  if (lat == null || lng == null || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) {
    return false;
  }
  const la = Number(lat);
  const ln = Number(lng);
  return pins.some(p => haversineMeters(la, ln, p.lat, p.lng) <= radiusM);
}

/** True stop: not Moving and GPS speed under 5 km/h (filters stale “Parked” while rolling). */
export function isTrulyStopped(v: Vehicle): boolean {
  if (v.status === 'Moving') return false;
  if (v.status === 'Offline' || v.status === 'Inactive') return false;
  const speed = Number((v.position as { speed?: number } | undefined)?.speed);
  if (Number.isFinite(speed) && speed >= 5) return false;
  return ['Idle', 'Stationary', 'Excessive Idle', 'Parked'].includes(v.status);
}

export type ReadyMixDispatchOpts = {
  plantPins?: Array<{ lat: number; lng: number }>;
  /** Asset IDs with an open / in-progress MiX trip (no TripEnd yet). */
  openTripAssetIds?: Set<string>;
};

export function readyMixDispatchState(
  v: Vehicle,
  opts: ReadyMixDispatchOpts = {},
): 'transit' | 'plant' | 'jobsite' | 'parked' | 'offline' {
  if (v.status === 'Offline' || v.status === 'Inactive') return 'offline';

  const speed = Number((v.position as { speed?: number } | undefined)?.speed);
  const rolling = v.status === 'Moving' || (Number.isFinite(speed) && speed >= 5);
  if (rolling) return 'transit';

  const pins = opts.plantPins ?? READY_MIX_PLANT_SEEDS;
  const hasCoords = v.position?.latitude != null && v.position?.longitude != null;
  const nearPlant = hasCoords ? isNearReadyMixPlant(v, pins) : false;
  const stopped = isTrulyStopped(v);
  const assetId = v.id?.toString();
  const onOpenTrip = !!(assetId && opts.openTripAssetIds?.has(assetId));

  // GPS confirm: truly stopped inside plant radius → at plant (loading / waiting batch)
  if (stopped && nearPlant) return 'plant';

  // Stopped away from plant: open trip strengthens jobsite (pour / wait); else still jobsite
  if (stopped && hasCoords && !nearPlant) {
    if (v.status === 'Parked' && !onOpenTrip) return 'parked';
    return 'jobsite';
  }

  // No GPS — fall back to MiX site/zone name (legacy)
  if (!hasCoords) {
    if (v.status === 'Parked') return 'parked';
    const site = (v.site || '').toUpperCase();
    const zone = (v.zone || '').toUpperCase();
    const atAssignedPlant =
      /PLANT|READY\s*MIX|RDYMIX|RMX|PUMP/.test(site) ||
      /READY\s*MIX|RDYMIX/.test(zone);
    if (atAssignedPlant && (v.status === 'Idle' || v.status === 'Stationary' || v.status === 'Excessive Idle')) {
      return 'plant';
    }
    return 'jobsite';
  }

  if (v.status === 'Parked') return 'parked';
  return 'jobsite';
}

/** Trips with a start but no end = still on a delivery cycle. */
export function openTripAssetIdsFromSession(
  trips: Array<{ AssetId?: string | null; assetId?: string | null; TripEnd?: string | null; tripEnd?: string | null }>,
): Set<string> {
  const ids = new Set<string>();
  for (const t of trips) {
    const end = t.TripEnd ?? t.tripEnd;
    if (end) continue;
    const id = (t.AssetId ?? t.assetId)?.toString();
    if (id) ids.add(id);
  }
  return ids;
}
