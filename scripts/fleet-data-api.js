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
    const live = JSON.parse(cachedFullText).map(v => ({
      id: v.id,
      status: v.status,
      date: v.date,
      panic: v.panic,
      warnings: v.warnings,
      fuelLevel: v.fuelLevel,
      position: v.position,
      activeEvents: v.activeEvents,
    }));
    cachedLiveText = JSON.stringify(live);
  }
  return cachedLiveText;
}
