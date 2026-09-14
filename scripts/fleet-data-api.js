import fs from 'fs';
import path from 'path';

let cachedMtimeMs = 0;
let cachedFullText = null;
let cachedLiveText = null;

export function getFleetDataResponse({ cwd = process.cwd(), view = null } = {}) {
  const dataPath = path.join(cwd, 'public', 'data.json');
  const stat = fs.statSync(dataPath);
  if (stat.mtimeMs !== cachedMtimeMs || cachedFullText == null) {
    cachedFullText = fs.readFileSync(dataPath, 'utf8');
    cachedLiveText = null;
    cachedMtimeMs = stat.mtimeMs;
  }

  if (view !== 'live') return cachedFullText;
  if (cachedLiveText == null) {
    // Ultra-slim live merge payload — status/position only (warnings/events come from dedicated APIs).
    const live = JSON.parse(cachedFullText).map(v => ({
      id: v.id,
      status: v.status,
      date: v.date,
      panic: !!v.panic,
      fuelLevel: v.fuelLevel ?? null,
      position: v.position
        ? {
          latitude: v.position.latitude,
          longitude: v.position.longitude,
          speed: v.position.speed,
          heading: v.position.heading,
          address: v.position.address,
        }
        : null,
    }));
    cachedLiveText = JSON.stringify(live);
  }
  return cachedLiveText;
}
