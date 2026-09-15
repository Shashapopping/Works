/**
 * Tiny Home snapshot so a refresh paints last map/counts/alerts
 * instead of a blank shell (Chevron peek-first). Kept small on purpose —
 * not the full events/HOS dumps.
 */
import type { AlertItem } from './homeWidgetData';
import type { DriverDistanceSummary, Metadata, Vehicle } from '../context/FleetContext';

const KEY = 'hbm_home_snapshot_v1';
const MAX_AGE_MS = 15 * 60_000;

export type SlimHomeVehicle = Pick<
  Vehicle,
  'id' | 'regNo' | 'transporter' | 'assetName' | 'site' | 'zone' | 'make' | 'model' | 'status' | 'date' | 'panic' | 'position' | 'fuelLevel'
>;

export type HomeSnapshot = {
  at: number;
  metadata: Metadata;
  vehicles: SlimHomeVehicle[];
  alerts: AlertItem[];
  driverDistance: DriverDistanceSummary | null;
};

export function slimHomeVehicle(v: Vehicle): SlimHomeVehicle {
  return {
    id: v.id,
    regNo: v.regNo,
    transporter: v.transporter,
    assetName: v.assetName,
    site: v.site,
    zone: v.zone,
    make: v.make,
    model: v.model,
    status: v.status,
    date: v.date,
    panic: v.panic,
    position: v.position,
    fuelLevel: v.fuelLevel ?? null,
  };
}

export function readHomeSnapshot(): HomeSnapshot | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as HomeSnapshot;
    if (!parsed || typeof parsed.at !== 'number') return null;
    if (Date.now() - parsed.at > MAX_AGE_MS) return null;
    if (!Array.isArray(parsed.vehicles)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeHomeSnapshot(snap: HomeSnapshot) {
  try {
    const payload: HomeSnapshot = {
      ...snap,
      at: Date.now(),
      driverDistance: snap.driverDistance
        ? { ...snap.driverDistance, assets: [], drivers: [] }
        : null,
    };
    sessionStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    /* quota / private mode */
  }
}

export function clearHomeSnapshot() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
