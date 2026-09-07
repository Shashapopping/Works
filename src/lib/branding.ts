import { DEMO_BRANDING, DEMO, demoPlaceLabel } from '../config/demoBranding';

/** Prefer reverse-geocoded address; otherwise show coordinates when we have them. */
export function eventLocationLabel(e: {
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}): string {
  const addr = (e.address || '').trim();
  if (addr && addr !== 'N/A' && addr.toLowerCase() !== 'null' && addr !== 'Unknown') {
    return DEMO_BRANDING ? demoPlaceLabel(addr) : addr;
  }
  const lat = e.latitude != null ? Number(e.latitude) : NaN;
  const lng = e.longitude != null ? Number(e.longitude) : NaN;
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  }
  return '—';
}

/**
 * Brand copy for user-facing strings.
 * Live: Lafarge → HBM.
 * Demo: scrub HBM / Lafarge → Demo Fleet mocks (see docs/DEMO-BRANDING-RESTORE.md).
 */
export function brandLabel(value?: string | null): string {
  if (!value) return value || '';
  const raw = String(value);
  if (DEMO_BRANDING) return demoPlaceLabel(raw);
  return raw
    .replace(/lafarge\s*nigeria/gi, 'HBM Nigeria')
    .replace(/\blafarge\b/gi, 'HBM');
}

/** Product / client chrome helpers used by Login, Sidebar, etc. */
export function productName(): string {
  return DEMO_BRANDING ? DEMO.productName : 'HBM Fleet Intelligence';
}

export function clientName(): string {
  return DEMO_BRANDING ? DEMO.clientName : 'HBM Nigeria';
}

export function platformName(): string {
  return DEMO_BRANDING ? DEMO.productName : 'Fleet Intelligence Platform';
}

export function brandLogoSrc(): string | null {
  return DEMO_BRANDING ? DEMO.logoSrc : '/hbm-logo-white-card.png';
}

/** Square mark for sidebar / login chrome (Chevron-style, no badge background). */
export function brandLogoMarkSrc(): string | null {
  return DEMO_BRANDING ? DEMO.logoSrc : '/hbm-logo-white-card.png';
}

export function brandLogoAlt(): string {
  return DEMO_BRANDING ? DEMO.logoAlt : 'HBM Nigeria';
}

export function reportTitle(): string {
  return DEMO_BRANDING ? DEMO.reportTitle : 'HBM Nigeria Event Report';
}
