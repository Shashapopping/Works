import type { Vehicle } from '../context/FleetContext';
import { brandLabel } from './branding';

export interface FleetLocationHub {
  key: string;
  label: string;
  regionHint: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  assetCount: number;
  movingCount: number;
}

const REGION_HINTS: Record<string, string> = {
  'QUARRY EWEKORO': 'Ewekoro, Ogun State',
  'QUARRY MFAMOSING': 'Mfamosing, Cross River',
  'ALTERNATIVE': 'Alternative fuels corridor',
  'CEMENT': 'Cement distribution',
  'INBOUND': 'Inbound logistics',
  'LH CUSTOMER ASSETS': 'Customer sites',
  'LH QUARRY': 'Quarry haulage',
  'READY MIX': 'Ready-mix plants',
  'BULK TANKER': 'Bulk tanker routes',
  'BULK TANKERS': 'Bulk tanker routes',
};

function titleCaseZone(zone: string) {
  return zone
    .toLowerCase()
    .split(/\s+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function cityFromAddress(address?: string): string | null {
  if (!address) return null;
  const parts = address.split(',').map(p => p.trim()).filter(Boolean);
  if (parts.length >= 2) return parts[parts.length - 2] || parts[0];
  return parts[0] || null;
}

/**
 * Build rotating location hubs from live fleet positions (Nigeria-wide).
 * Prefers zone clusters; falls back to address city when zone is weak.
 */
export function deriveFleetLocationHubs(vehicles: Vehicle[], limit = 8): FleetLocationHub[] {
  const active = vehicles.filter(v => {
    if (!v.position?.latitude || !v.position?.longitude) return false;
    const s = v.status;
    return s === 'Moving' || s === 'Idle' || s === 'Excessive Idle' || s === 'Stationary';
  });

  type Acc = {
    key: string;
    label: string;
    regionHint: string;
    address: string;
    latSum: number;
    lngSum: number;
    n: number;
    moving: number;
  };

  const byKey = new Map<string, Acc>();

  active.forEach(v => {
    const zone = (v.zone || '').trim().toUpperCase();
    const city = cityFromAddress(v.position?.address);
    const key = zone && zone !== 'N/A' && zone !== 'UNKNOWN'
      ? `zone:${zone}`
      : city
      ? `city:${city.toLowerCase()}`
      : null;
    if (!key) return;

    const label = brandLabel(
      zone && zone !== 'N/A' && zone !== 'UNKNOWN'
        ? titleCaseZone(zone)
        : city!,
    );
    const regionHint = brandLabel(
      (zone && REGION_HINTS[zone])
        || (city ? `${city}, Nigeria` : 'Nigeria'),
    );

    const lat = Number(v.position!.latitude);
    const lng = Number(v.position!.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, {
        key,
        label,
        regionHint,
        address: v.position?.address || label,
        latSum: lat,
        lngSum: lng,
        n: 1,
        moving: v.status === 'Moving' ? 1 : 0,
      });
    } else {
      prev.latSum += lat;
      prev.lngSum += lng;
      prev.n += 1;
      if (v.status === 'Moving') prev.moving += 1;
      if (v.position?.address && prev.address.length < 8) prev.address = v.position.address;
    }
  });

  return [...byKey.values()]
    .map(a => ({
      key: a.key,
      label: a.label,
      regionHint: a.regionHint,
      address: brandLabel(a.address),
      latitude: a.latSum / a.n,
      longitude: a.lngSum / a.n,
      assetCount: a.n,
      movingCount: a.moving,
    }))
    .sort((a, b) => b.assetCount - a.assetCount || b.movingCount - a.movingCount)
    .slice(0, limit);
}
