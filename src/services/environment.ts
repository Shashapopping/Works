import type { EnvironmentContext } from '../hooks/useSafeIQ';

const API_SECRET = import.meta.env.VITE_API_SECRET;
const authFetch = (url: string, options: RequestInit = {}) =>
  fetch(url, { ...options, headers: { ...options.headers, 'x-api-secret': API_SECRET } });

export interface ResolvedEnvironment extends EnvironmentContext {
  weather_condition?: string;
  temperature_c?: number;
  humidity_pct?: number;
  precipitation_mm?: number;
  environment_source?: { weather: string; traffic: string };
  weather_error?: string;
}

function inferRoadType(address = ''): EnvironmentContext['road_type'] {
  const a = address.toLowerCase();
  if (/expressway|highway|motorway|interstate|km\s*\d/i.test(a)) return 'highway';
  if (/port|gate|apapa|oshodi|ikeja|lagos|urban|street|road\b/i.test(a)) return 'urban';
  if (/rural|village|farm/i.test(a)) return 'rural';
  return 'highway';
}

function defaultEnvironment(address: string | undefined, reason: string): ResolvedEnvironment {
  console.warn(`[environment] weather unavailable${address ? ` for "${address}"` : ''}: ${reason}`);
  return {
    weather: 'Unavailable',
    weather_condition: 'Unknown',
    traffic_density: 'moderate',
    road_type: inferRoadType(address),
    environment_source: { weather: 'unavailable', traffic: 'heuristic' },
    weather_error: reason,
  };
}

async function requestEnvironment(params: URLSearchParams, address?: string): Promise<ResolvedEnvironment> {
  try {
    const res = await authFetch(`/api/environment?${params}`);
    if (!res.ok) return defaultEnvironment(address, `/api/environment returned ${res.status}`);
    const env: ResolvedEnvironment = await res.json();
    if (env.weather_error) console.warn(`[environment] weather unavailable: ${env.weather_error}`);
    return env;
  } catch (err) {
    return defaultEnvironment(address, `request failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function fetchIncidentEnvironment(opts: {
  latitude?: number | null;
  longitude?: number | null;
  address?: string;
  timestamp?: string;
}): Promise<ResolvedEnvironment> {
  const { latitude, longitude, address, timestamp } = opts;
  const lat = latitude != null ? Number(latitude) : NaN;
  const lng = longitude != null ? Number(longitude) : NaN;

  // No coords yet — server will try geocoding from address
  if (isNaN(lat) || isNaN(lng)) {
    if (!address) return defaultEnvironment(address, 'no coordinates or address');
    return requestEnvironment(new URLSearchParams({
      address,
      timestamp: timestamp || new Date().toISOString(),
    }), address);
  }

  return requestEnvironment(new URLSearchParams({
    lat: String(lat),
    lng: String(lng),
    address: address || '',
    timestamp: timestamp || new Date().toISOString(),
  }), address);
}
