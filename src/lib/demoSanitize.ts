import {
  DEMO_BRANDING,
  demoPhoneLabel,
  demoPlaceLabel,
} from '../config/demoBranding';
import type { SafetyNotification } from '../hooks/useSafeIQ';

function scrubPlace(value?: string | null): string | undefined {
  if (value == null || value === '') return value ?? undefined;
  return demoPlaceLabel(String(value));
}

/** LogEntry-shaped scrub (avoids circular import with FleetContext). */
export function sanitizeLogEntry<T extends {
  driverName?: string;
  driverPhone?: string;
  transporter?: string;
  address?: string;
  assetName?: string;
}>(e: T): T {
  if (!DEMO_BRANDING) return e;
  return {
    ...e,
    driverName: e.driverName,
    driverPhone: e.driverPhone ? demoPhoneLabel(e.driverPhone) : e.driverPhone,
    transporter: scrubPlace(e.transporter) ?? e.transporter,
    address: scrubPlace(e.address) ?? e.address,
    assetName: scrubPlace(e.assetName) ?? e.assetName,
  };
}

export function sanitizeVehicle<T extends {
  transporter?: string;
  assetName?: string;
  site?: string;
  zone?: string;
  position?: { latitude: number; longitude: number; address?: string };
}>(v: T): T {
  if (!DEMO_BRANDING) return v;
  return {
    ...v,
    transporter: scrubPlace(v.transporter) ?? v.transporter,
    assetName: scrubPlace(v.assetName) ?? v.assetName,
    site: scrubPlace(v.site) ?? v.site,
    zone: scrubPlace(v.zone) ?? v.zone,
    position: v.position
      ? { ...v.position, address: scrubPlace(v.position.address) ?? v.position.address }
      : v.position,
  };
}

export function sanitizeNotification(n: SafetyNotification): SafetyNotification {
  if (!DEMO_BRANDING) return n;
  return {
    ...n,
    driver: {
      ...n.driver,
      name: n.driver.name,
    },
    location: scrubPlace(n.location) ?? n.location,
  };
}

export function sanitizeDriverDistance<T extends {
  drivers: Array<{ driverName: string; driverPhone: string; [k: string]: unknown }>;
  assets: Array<{ assetName?: string; drivers: string[]; [k: string]: unknown }>;
} | null>(summary: T): T {
  if (!DEMO_BRANDING || !summary) return summary;
  return {
    ...summary,
    drivers: summary.drivers.map(d => ({
      ...d,
      driverName: d.driverName,
      driverPhone: d.driverPhone ? demoPhoneLabel(d.driverPhone) : d.driverPhone,
    })),
    assets: summary.assets.map(a => ({
      ...a,
      assetName: scrubPlace(a.assetName) ?? a.assetName,
      drivers: a.drivers,
    })),
  };
}

export function sanitizeVaultRecord<T extends { driverName: string; location: string }>(r: T): T {
  if (!DEMO_BRANDING) return r;
  return {
    ...r,
    driverName: r.driverName,
    location: scrubPlace(r.location) ?? r.location,
  };
}

export function sanitizeDriverScore<T extends { name: string }>(d: T): T {
  return d;
}

/** Scrub a TripDriver row from /api/driver-distance (page-local fetches). */
export function sanitizeTripDriver<T extends {
  driverName: string;
  driverPhone?: string;
}>(d: T): T {
  if (!DEMO_BRANDING) return d;
  return {
    ...d,
    driverName: d.driverName,
    driverPhone: d.driverPhone ? demoPhoneLabel(d.driverPhone) : d.driverPhone,
  };
}
