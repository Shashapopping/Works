/**
 * Fleet segment zone matchers — shared by Bulk Tankers / Cement / Quarry / Ready Mix pages.
 * Order matters for classifyFleetSegment: more specific segments first.
 */
import type { Vehicle } from '../context/FleetContext';

export type FleetSegmentId = 'tankers' | 'quarry' | 'cement' | 'readyMix';

export interface FleetSegmentDef {
  id: FleetSegmentId;
  path: string;
  title: string;
  subtitle: string;
  /** Sidebar / score card accent */
  color: string;
  totalLabel: string;
  match: (zone: string) => boolean;
}

function normZone(zone?: string | null) {
  return (zone || '').trim().toUpperCase();
}

export function isBulkTankerZone(zone?: string | null) {
  const z = normZone(zone);
  return /BULK\s*TANKERS?/.test(z);
}

export function isQuarryZone(zone?: string | null) {
  const z = normZone(zone);
  return /QUARRY/.test(z);
}

export function isReadyMixZone(zone?: string | null) {
  const z = normZone(zone);
  return /READY\s*MIX|RDYMIX/.test(z);
}

/** Cement distribution corridors — excludes bulk tankers (own page) and quarry/ready-mix. */
export function isCementZone(zone?: string | null) {
  const z = normZone(zone);
  if (isBulkTankerZone(z) || isQuarryZone(z) || isReadyMixZone(z)) return false;
  return /CEMENT|LH\s*-\s*(NORTH|EAST|WEST)|\bMDD\b|\bDD\b|SPOT\s*HIRE/.test(z);
}

export const FLEET_SEGMENTS: Record<FleetSegmentId, FleetSegmentDef> = {
  tankers: {
    id: 'tankers',
    path: '/tankers',
    title: 'Bulk Tankers',
    subtitle: 'East & West tanker zones',
    color: '#0078D4',
    totalLabel: 'Total Tankers',
    match: isBulkTankerZone,
  },
  quarry: {
    id: 'quarry',
    path: '/quarry',
    title: 'Quarry',
    subtitle: 'Ewekoro, Mfamosing & quarry haulage',
    color: '#0d9488',
    totalLabel: 'Total Quarry',
    match: isQuarryZone,
  },
  cement: {
    id: 'cement',
    path: '/cement',
    title: 'Cement',
    subtitle: 'North / East / West cement distribution',
    color: '#c2410c',
    totalLabel: 'Total Cement',
    match: isCementZone,
  },
  readyMix: {
    id: 'readyMix',
    path: '/ready-mix',
    title: 'Ready Mix',
    subtitle: 'Ready-mix plant assets',
    color: '#7c3aed',
    totalLabel: 'Total Ready Mix',
    match: isReadyMixZone,
  },
};

export function vehicleInSegment(v: Vehicle, segment: FleetSegmentId) {
  return FLEET_SEGMENTS[segment].match(v.zone);
}

export function filterVehiclesBySegment(vehicles: Vehicle[], segment: FleetSegmentId) {
  return vehicles.filter(v => vehicleInSegment(v, segment));
}
