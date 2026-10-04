const WMO_LABELS = {
  0: 'Clear', 1: 'Mainly Clear', 2: 'Partly Cloudy', 3: 'Overcast',
  45: 'Foggy', 48: 'Foggy', 51: 'Light Drizzle', 53: 'Drizzle', 55: 'Heavy Drizzle',
  61: 'Light Rain', 63: 'Rain', 65: 'Heavy Rain',
  71: 'Light Snow', 73: 'Snow', 75: 'Heavy Snow',
  80: 'Light Showers', 81: 'Showers', 82: 'Heavy Showers',
  95: 'Thunderstorm', 96: 'Thunderstorm', 99: 'Severe Thunderstorm',
};

// Open-Meteo rejects bursts with 429 "Too many concurrent requests"; the dashboard
// fires one call per hub + per SafeIQ card at once, so cap in-flight calls and retry.
const WEATHER_MAX_CONCURRENT = 3;
const WEATHER_RETRY_DELAYS_MS = [400, 1200, 2500];
const WEATHER_TIMEOUT_MS = 8000;
const WEATHER_CACHE_TTL_MS = 10 * 60 * 1000;
const GEOCODE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// Home strip asks for ~6 hubs per page load; cache keeps paid traffic lookups inside free tiers.
const TRAFFIC_CACHE_TTL_MS = 10 * 60 * 1000;
const TRAFFIC_TIMEOUT_MS = 8000;
const LIVE_TRAFFIC_MAX_AGE_MS = 30 * 60 * 1000;
const TRAFFIC_CACHE_MAX = 1000;

const weatherCache = new Map();
const weatherInFlight = new Map();
const geocodeCache = new Map();
const trafficCache = new Map();
const trafficInFlight = new Map();

let weatherActive = 0;
const weatherQueue = [];

function acquireWeatherSlot() {
  if (weatherActive < WEATHER_MAX_CONCURRENT) {
    weatherActive++;
    return Promise.resolve();
  }
  return new Promise(resolve => weatherQueue.push(resolve));
}

function releaseWeatherSlot() {
  const next = weatherQueue.shift();
  if (next) next();
  else weatherActive--;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function cacheGet(map, key) {
  const hit = map.get(key);
  if (!hit) return undefined;
  if (hit.expires < Date.now()) { map.delete(key); return undefined; }
  return hit.value;
}

function inferRoadType(address = '') {
  const a = address.toLowerCase();
  if (/expressway|highway|motorway|interstate|km\s*\d/i.test(a)) return 'highway';
  if (/port|gate|apapa|oshodi|ikeja|lagos|urban|street|road\b/i.test(a)) return 'urban';
  if (/rural|village|farm/i.test(a)) return 'rural';
  return 'highway';
}

function inferTrafficHeuristic(lat, lng, roadType, timestamp) {
  const hour = new Date(timestamp || Date.now()).getUTCHours() + 1; // WAT ≈ UTC+1
  const isWeekend = [0, 6].includes(new Date(timestamp || Date.now()).getUTCDay());
  const isLagosCorridor = lat >= 6.3 && lat <= 6.7 && lng >= 3.1 && lng <= 3.6;

  let score = 0;
  if (!isWeekend && ((hour >= 7 && hour <= 9) || (hour >= 16 && hour <= 19))) score += 2;
  if (isLagosCorridor) score += 1;
  if (roadType === 'highway') score += 1;
  if (roadType === 'urban' && hour >= 10 && hour <= 15) score += 1;
  if (hour >= 22 || hour <= 5) score -= 2;

  if (score >= 3) return 'heavy';
  if (score >= 1) return 'moderate';
  return 'light';
}

function addressSearchTerms(address) {
  const parts = address.split(',').map(s => s.trim()).filter(Boolean);
  const terms = [address];
  if (parts.length >= 2) terms.push(parts.slice(-2).join(', '));
  if (parts.length >= 3) terms.push(parts.slice(-3).join(', '));
  return [...new Set(terms)];
}

async function geocodeWithOpenMeteo(term) {
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.searchParams.set('name', term);
  url.searchParams.set('count', '1');
  url.searchParams.set('language', 'en');
  url.searchParams.set('format', 'json');

  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const hit = data.results?.[0];
  if (!hit) return null;
  return { lat: hit.latitude, lng: hit.longitude };
}

async function geocodeWithNominatim(term) {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', term);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '1');
  url.searchParams.set('countrycodes', 'ng');

  const res = await fetch(url, {
    headers: { 'User-Agent': 'BPL-HBM-Dashboard/1.0 (fleet-safety)' },
  });
  if (!res.ok) return null;
  const data = await res.json();
  const hit = data?.[0];
  if (!hit) return null;
  return { lat: parseFloat(hit.lat), lng: parseFloat(hit.lon) };
}

export async function geocodeAddress(address) {
  if (!address || address === 'Unknown location') return null;
  const key = address.trim().toLowerCase();
  const cached = cacheGet(geocodeCache, key);
  if (cached !== undefined) return cached;
  try {
    let hit = null;
    for (const term of addressSearchTerms(address)) {
      hit = await geocodeWithOpenMeteo(term);
      if (hit) break;
    }
    if (!hit) {
      for (const term of addressSearchTerms(address)) {
        hit = await geocodeWithNominatim(term);
        if (hit) break;
      }
    }
    if (hit) geocodeCache.set(key, { value: hit, expires: Date.now() + GEOCODE_CACHE_TTL_MS });
    else console.warn(`[environment] geocode found no match for "${address}"`);
    return hit;
  } catch (err) {
    console.warn(`[environment] geocode failed for "${address}": ${err?.message || err}`);
    return null;
  }
}

async function requestOpenMeteo(lat, lng) {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(lat));
  url.searchParams.set('longitude', String(lng));
  url.searchParams.set('current', 'temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m');
  url.searchParams.set('timezone', 'Africa/Lagos');

  let lastError;
  for (let attempt = 0; attempt <= WEATHER_RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) await sleep(WEATHER_RETRY_DELAYS_MS[attempt - 1]);
    await acquireWeatherSlot();
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(WEATHER_TIMEOUT_MS) });
      if (res.ok) {
        const data = await res.json();
        if (!data?.current) throw new Error('Open-Meteo response missing "current"');
        return data.current;
      }
      const body = await res.text().catch(() => '');
      let reason = '';
      try { reason = JSON.parse(body)?.reason || ''; } catch { /* non-JSON body */ }
      const httpError = new Error(`Open-Meteo ${res.status}${reason ? ` (${reason})` : ''}`);
      httpError.retryable = res.status === 429 || res.status >= 500;
      throw httpError;
    } catch (err) {
      lastError = err;
      if (err?.retryable === false) throw err;
    } finally {
      releaseWeatherSlot();
    }
  }
  throw lastError;
}

export async function fetchWeather(lat, lng) {
  const key = `${Number(lat).toFixed(2)},${Number(lng).toFixed(2)}`;
  const cached = cacheGet(weatherCache, key);
  if (cached) return cached;
  if (weatherInFlight.has(key)) return weatherInFlight.get(key);

  const pending = requestOpenMeteo(lat, lng)
    .then(current => {
      const weather = summarizeWeather(current);
      weatherCache.set(key, { value: weather, expires: Date.now() + WEATHER_CACHE_TTL_MS });
      return weather;
    })
    .finally(() => weatherInFlight.delete(key));
  weatherInFlight.set(key, pending);
  return pending;
}

function summarizeWeather(c) {
  const condition = WMO_LABELS[c.weather_code] || 'Unknown';
  const temp = Math.round(c.temperature_2m);
  const humidity = Math.round(c.relative_humidity_2m);
  const precip = c.precipitation ?? 0;
  const wind = Math.round(c.wind_speed_10m);

  const parts = [condition, `${temp}°C`];
  if (humidity >= 70) parts.push('Humid');
  if (precip > 0) parts.push(`${precip}mm rain`);
  if (wind >= 30) parts.push(`Wind ${wind} km/h`);

  return {
    summary: parts.join(' · '),
    condition,
    temperature_c: temp,
    humidity_pct: humidity,
    precipitation_mm: precip,
    wind_speed_kmh: wind,
  };
}

const MAPBOX_CONGESTION = { low: 'light', moderate: 'moderate', heavy: 'heavy', severe: 'heavy' };
// The probe destination can land across water/barriers and produce long detours; judge only the road near the point.
const MAPBOX_PROBE_WINDOW_M = 1500;

/**
 * Mapbox driving-traffic over a ~1 km probe route. Unlike TomTom, Mapbox has live traffic for Nigeria.
 * Congestion is weighted by segment length; all-"unknown" segments mean no data, so fall through.
 */
async function fetchMapboxTrafficDensity(lat, lng, token, roadType) {
  const coords = `${lng},${lat};${lng + 0.008},${lat + 0.008}`;
  const url = new URL(`https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${coords}`);
  url.searchParams.set('annotations', 'congestion,distance,duration');
  url.searchParams.set('overview', 'full');
  url.searchParams.set('access_token', token);

  const res = await fetch(url, { signal: AbortSignal.timeout(TRAFFIC_TIMEOUT_MS) });
  if (!res.ok) {
    console.warn(`[environment] Mapbox traffic ${res.status}`);
    return null;
  }
  const route = (await res.json()).routes?.[0];
  const leg = route?.legs?.[0];
  const levels = leg?.annotation?.congestion ?? [];
  const lengths = leg?.annotation?.distance ?? [];
  const durations = leg?.annotation?.duration ?? [];
  const weight = { light: 0, moderate: 0, heavy: 0 };
  let meters = 0;
  let seconds = 0;
  for (let i = 0; i < levels.length && meters < MAPBOX_PROBE_WINDOW_M; i++) {
    const len = lengths[i] || 0;
    meters += len;
    seconds += durations[i] || 0;
    const density = MAPBOX_CONGESTION[levels[i]];
    if (density) weight[density] += len || 1;
  }
  const known = weight.light + weight.moderate + weight.heavy;
  if (!known || !(seconds > 0)) return null;

  const density = weight.heavy / known >= 0.3 ? 'heavy'
    : (weight.heavy + weight.moderate) / known >= 0.3 ? 'moderate'
    : 'light';
  const speed = Math.round((meters / seconds) * 3.6);
  const typical = route.duration_typical > 0 ? route.duration_typical : null;
  const delayPct = typical && route.duration > 0 ? Math.max(0, Math.round((route.duration / typical - 1) * 100)) : undefined;
  const description = density === 'heavy'
    ? `Severe congestion (${speed} km/h)`
    : density === 'moderate'
      ? `Slow-moving traffic (${speed} km/h)`
      : `Free-flowing traffic (${speed} km/h)`;

  return {
    density,
    road_type: roadType,
    source: 'mapbox',
    description,
    current_speed_kmh: speed,
    ...(delayPct != null ? { delay_pct: delayPct } : {}),
  };
}

async function fetchTomTomTrafficDensity(lat, lng, apiKey, roadType) {
  const url = new URL('https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json');
  url.searchParams.set('point', `${lat},${lng}`);
  url.searchParams.set('unit', 'KMPH');
  url.searchParams.set('key', apiKey);

  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const flow = data.flowSegmentData;
  if (!flow?.currentSpeed || !flow?.freeFlowSpeed) return null;

  const ratio = flow.currentSpeed / flow.freeFlowSpeed;
  const density = ratio <= 0.45 ? 'heavy' : ratio <= 0.75 ? 'moderate' : 'light';
  const delayPct = Math.max(0, Math.round((1 - ratio) * 100));
  const description = density === 'heavy'
    ? `Severe congestion (${Math.round(flow.currentSpeed)} km/h)`
    : density === 'moderate'
      ? `Slow-moving traffic (${Math.round(flow.currentSpeed)} km/h)`
      : `Free-flowing traffic (${Math.round(flow.currentSpeed)} km/h)`;

  return {
    density,
    road_type: roadType,
    source: 'tomtom',
    description,
    current_speed_kmh: Math.round(flow.currentSpeed),
    free_flow_speed_kmh: Math.round(flow.freeFlowSpeed),
    delay_pct: delayPct,
  };
}

function googleTrafficResult(ratio, roadType) {
  const density = ratio >= 1.35 ? 'heavy' : ratio >= 1.1 ? 'moderate' : 'light';
  const delayPct = Math.max(0, Math.round((ratio - 1) * 100));
  const description = density === 'heavy'
    ? `Severe congestion (${delayPct}% slower than normal)`
    : density === 'moderate'
      ? `Slow-moving traffic (${delayPct}% slower than normal)`
      : 'Free-flowing traffic';
  return { density, road_type: roadType, source: 'google', description, delay_pct: delayPct };
}

/** Routes API (current Google product); the legacy Directions API is often not enabled on new projects. */
async function fetchGoogleRoutesTrafficDensity(lat, lng, apiKey, roadType) {
  const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'routes.duration,routes.staticDuration',
    },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: lat, longitude: lng } } },
      destination: { location: { latLng: { latitude: lat + 0.008, longitude: lng + 0.008 } } },
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_AWARE',
    }),
  });
  if (!res.ok) return null;
  const route = (await res.json()).routes?.[0];
  const withTraffic = parseFloat(route?.duration);
  const baseline = parseFloat(route?.staticDuration);
  if (!(withTraffic > 0) || !(baseline > 0)) return null;
  return googleTrafficResult(withTraffic / baseline, roadType);
}

async function fetchGoogleTrafficDensity(lat, lng, apiKey, roadType) {
  try {
    const routes = await fetchGoogleRoutesTrafficDensity(lat, lng, apiKey, roadType);
    if (routes) return routes;
  } catch { /* fall back to legacy Directions */ }

  const destLat = lat + 0.008;
  const destLng = lng + 0.008;
  const url = new URL('https://maps.googleapis.com/maps/api/directions/json');
  url.searchParams.set('origin', `${lat},${lng}`);
  url.searchParams.set('destination', `${destLat},${destLng}`);
  url.searchParams.set('departure_time', 'now');
  url.searchParams.set('traffic_model', 'best_guess');
  url.searchParams.set('key', apiKey);

  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const leg = data.routes?.[0]?.legs?.[0];
  if (!leg?.duration_in_traffic || !leg?.duration) return null;

  return googleTrafficResult(leg.duration_in_traffic.value / leg.duration.value, roadType);
}

/** TomTom flow returns "Point too far from nearest existing segment" everywhere in Nigeria (no coverage). */
function isInNigeria(lat, lng) {
  return lat >= 4 && lat <= 14 && lng >= 2.6 && lng <= 14.7;
}

async function fetchLiveTraffic(lat, lng, roadType, { googleApiKey, tomTomApiKey }) {
  const mapboxToken = process.env.MAPBOX_TOKEN || process.env.MAPBOX_ACCESS_TOKEN;
  if (mapboxToken) {
    try {
      const traffic = await fetchMapboxTrafficDensity(lat, lng, mapboxToken, roadType);
      if (traffic) return traffic;
    } catch { /* fall through to TomTom/Google/heuristic */ }
  }

  if (tomTomApiKey && !isInNigeria(lat, lng)) {
    try {
      const traffic = await fetchTomTomTrafficDensity(lat, lng, tomTomApiKey, roadType);
      if (traffic) return traffic;
    } catch { /* fall through to Google/heuristic */ }
  }

  if (googleApiKey) {
    try {
      const traffic = await fetchGoogleTrafficDensity(lat, lng, googleApiKey, roadType);
      if (traffic) return traffic;
    } catch { /* fall through to heuristic */ }
  }

  return null;
}

/** Live provider results (and misses) are cached per ~1 km cell; the heuristic depends on timestamp so it isn't. */
function cachedLiveTraffic(lat, lng, roadType, keys) {
  const key = `${lat.toFixed(2)},${lng.toFixed(2)},${roadType}`;
  const hit = trafficCache.get(key);
  if (hit && hit.expires > Date.now()) return Promise.resolve(hit.value);
  if (trafficInFlight.has(key)) return trafficInFlight.get(key);
  const pending = fetchLiveTraffic(lat, lng, roadType, keys)
    .then(value => {
      if (trafficCache.size >= TRAFFIC_CACHE_MAX) {
        const now = Date.now();
        for (const [k, v] of trafficCache) if (v.expires <= now) trafficCache.delete(k);
        if (trafficCache.size >= TRAFFIC_CACHE_MAX) trafficCache.delete(trafficCache.keys().next().value);
      }
      trafficCache.set(key, { value, expires: Date.now() + TRAFFIC_CACHE_TTL_MS });
      return value;
    })
    .finally(() => trafficInFlight.delete(key));
  trafficInFlight.set(key, pending);
  return pending;
}

export async function fetchTrafficDensity(lat, lng, { address, timestamp, googleApiKey, tomTomApiKey } = {}) {
  const roadType = inferRoadType(address);
  // Live providers only know traffic now — don't stamp current traffic onto an older incident.
  const at = timestamp ? Date.parse(timestamp) : Date.now();
  const isRecent = !Number.isFinite(at) || Math.abs(Date.now() - at) <= LIVE_TRAFFIC_MAX_AGE_MS;
  const live = isRecent ? await cachedLiveTraffic(lat, lng, roadType, { googleApiKey, tomTomApiKey }) : null;
  if (live) return live;

  const density = inferTrafficHeuristic(lat, lng, roadType, timestamp);
  const description = density === 'heavy'
    ? 'Likely congested traffic'
    : density === 'moderate'
      ? 'Likely moderate traffic'
      : 'Likely free-flowing traffic';

  return {
    density,
    road_type: roadType,
    source: 'heuristic',
    description,
  };
}

export async function resolveEnvironment({ lat, lng, address, timestamp, googleApiKey, tomTomApiKey }) {
  const roadType = inferRoadType(address);
  let resolvedLat = lat != null ? Number(lat) : null;
  let resolvedLng = lng != null ? Number(lng) : null;

  if ((resolvedLat == null || resolvedLng == null || isNaN(resolvedLat) || isNaN(resolvedLng)) && address) {
    const geo = await geocodeAddress(address);
    if (geo) {
      resolvedLat = geo.lat;
      resolvedLng = geo.lng;
    }
  }

  const fallback = {
    weather: 'Unavailable',
    weather_condition: 'Unknown',
    traffic_density: inferTrafficHeuristic(resolvedLat, resolvedLng, roadType, timestamp),
    traffic_description: 'Estimated traffic conditions',
    road_type: roadType,
    environment_source: { weather: 'unavailable', traffic: 'heuristic' },
  };

  if (resolvedLat == null || resolvedLng == null || isNaN(resolvedLat) || isNaN(resolvedLng)) {
    const reason = address ? 'no coordinates; address could not be geocoded' : 'no coordinates or address';
    console.warn(`[environment] weather unavailable: ${reason}`);
    return { ...fallback, weather_error: reason };
  }

  const [weatherResult, trafficResult] = await Promise.allSettled([
    fetchWeather(resolvedLat, resolvedLng),
    fetchTrafficDensity(resolvedLat, resolvedLng, { address, timestamp, googleApiKey, tomTomApiKey }),
  ]);

  const weather = weatherResult.status === 'fulfilled' ? weatherResult.value : null;
  const traffic = trafficResult.status === 'fulfilled' ? trafficResult.value : null;
  if (trafficResult.status === 'rejected') {
    console.warn(`[environment] traffic lookup failed: ${trafficResult.reason?.message || trafficResult.reason}`);
  }
  const weatherError = weatherResult.status === 'rejected'
    ? (weatherResult.reason?.name === 'TimeoutError' ? 'Open-Meteo timed out' : weatherResult.reason?.message || String(weatherResult.reason))
    : undefined;
  if (weatherError) {
    console.warn(`[environment] weather unavailable at ${resolvedLat.toFixed(3)},${resolvedLng.toFixed(3)}: ${weatherError}`);
  }

  return {
    weather: weather?.summary ?? 'Unavailable',
    weather_condition: weather?.condition ?? 'Unknown',
    temperature_c: weather?.temperature_c,
    humidity_pct: weather?.humidity_pct,
    precipitation_mm: weather?.precipitation_mm,
    traffic_density: traffic?.density ?? fallback.traffic_density,
    traffic_description: traffic?.description ?? fallback.traffic_description,
    current_speed_kmh: traffic?.current_speed_kmh,
    free_flow_speed_kmh: traffic?.free_flow_speed_kmh,
    traffic_delay_pct: traffic?.delay_pct,
    road_type: traffic?.road_type ?? roadType,
    environment_source: {
      weather: weather ? 'open-meteo' : 'unavailable',
      traffic: traffic?.source ?? 'heuristic',
    },
    ...(weatherError ? { weather_error: weatherError } : {}),
  };
}
