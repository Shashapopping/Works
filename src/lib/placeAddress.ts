/** True when a MiX/Nominatim place string is a real named location (not pending/unknown/coords). */
export function isUsablePlaceAddress(address?: string | null): boolean {
  if (!address) return false;
  const a = String(address).trim();
  if (!a) return false;
  if (a === '—' || a === '-') return false;
  if (/^-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?$/.test(a)) return false;
  const lower = a.toLowerCase();
  return lower !== 'unknown'
    && lower !== 'unknown location'
    && lower !== 'locating…'
    && lower !== 'locating...'
    && lower !== 'null'
    && lower !== 'n/a';
}

export function vehiclePlaceAddress(v: {
  position?: { address?: string | null } | null;
  address?: string | null;
}): string {
  const fromPos = typeof v.position?.address === 'string' ? v.position.address.trim() : '';
  if (fromPos) return fromPos;
  return typeof v.address === 'string' ? v.address.trim() : '';
}

export function vehicleHasResolvedPlace(v: {
  position?: { address?: string | null } | null;
  address?: string | null;
}): boolean {
  return isUsablePlaceAddress(vehiclePlaceAddress(v));
}
