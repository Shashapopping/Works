/** Prefer reverse-geocoded address; otherwise show coordinates when we have them. */
export function eventLocationLabel(e: {
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}): string {
  const addr = (e.address || '').trim();
  if (addr && addr !== 'N/A' && addr.toLowerCase() !== 'null' && addr !== 'Unknown') {
    return addr;
  }
  const lat = e.latitude != null ? Number(e.latitude) : NaN;
  const lng = e.longitude != null ? Number(e.longitude) : NaN;
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  }
  return '—';
}

/** Brand copy: Lafarge → HBM in user-facing strings. */
export function brandLabel(value?: string | null): string {
  if (!value) return value || '';
  return String(value)
    .replace(/lafarge\s*nigeria/gi, 'HBM Nigeria')
    .replace(/\blafarge\b/gi, 'HBM');
}
