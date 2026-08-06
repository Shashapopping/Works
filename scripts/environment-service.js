const WMO_LABELS = {
  0: 'Clear', 1: 'Mainly Clear', 2: 'Partly Cloudy', 3: 'Overcast',
  45: 'Foggy', 48: 'Foggy', 51: 'Light Drizzle', 53: 'Drizzle', 55: 'Heavy Drizzle',
  61: 'Light Rain', 63: 'Rain', 65: 'Heavy Rain',
  71: 'Light Snow', 73: 'Snow', 75: 'Heavy Snow',
  80: 'Light Showers', 81: 'Showers', 82: 'Heavy Showers',
  95: 'Thunderstorm', 96: 'Thunderstorm', 99: 'Severe Thunderstorm',
};

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
  try {
    for (const term of addressSearchTerms(address)) {
      const meteo = await geocodeWithOpenMeteo(term);
      if (meteo) return meteo;
    }
    for (const term of addressSearchTerms(address)) {
      const nominatim = await geocodeWithNominatim(term);
      if (nominatim) return nominatim;
    }
    return null;
  } catch {
    return null;
  }
}

export async function fetchWeather(lat, lng) {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(lat));
  url.searchParams.set('longitude', String(lng));
  url.searchParams.set('current', 'temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m');
  url.searchParams.set('timezone', 'Africa/Lagos');

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const data = await res.json();
  const c = data.current;
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

async function fetchGoogleTrafficDensity(lat, lng, apiKey, roadType) {
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

  const ratio = leg.duration_in_traffic.value / leg.duration.value;
  const density = ratio >= 1.35 ? 'heavy' : ratio >= 1.1 ? 'moderate' : 'light';
  const delayPct = Math.max(0, Math.round((ratio - 1) * 100));
  const description = density === 'heavy'
    ? `Severe congestion (${delayPct}% slower than normal)`
    : density === 'moderate'
      ? `Slow-moving traffic (${delayPct}% slower than normal)`
      : 'Free-flowing traffic';

  return {
    density,
    road_type: roadType,
    source: 'google',
    description,
    delay_pct: delayPct,
  };
}

export async function fetchTrafficDensity(lat, lng, { address, timestamp, googleApiKey, tomTomApiKey } = {}) {
  const roadType = inferRoadType(address);

  if (tomTomApiKey) {
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
    return fallback;
  }

  const [weatherResult, trafficResult] = await Promise.allSettled([
    fetchWeather(resolvedLat, resolvedLng),
    fetchTrafficDensity(resolvedLat, resolvedLng, { address, timestamp, googleApiKey, tomTomApiKey }),
  ]);

  const weather = weatherResult.status === 'fulfilled' ? weatherResult.value : null;
  const traffic = trafficResult.status === 'fulfilled' ? trafficResult.value : null;

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
  };
}
