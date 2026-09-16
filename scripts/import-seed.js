/**
 * Merge seed/week/*.jsonl into runtime log files (dedupe by eventId / trip id).
 * Safe to run on every boot — existing newer live data is kept.
 *
 * Usage: node scripts/import-seed.js
 */
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import readline from 'readline';
import { fileURLToPath } from 'url';
import { createReadStream } from 'fs';

const ROOT = process.cwd();
const SEED_DIR = path.join(ROOT, 'seed', 'week');

function readLines(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8').split('\n').map(l => l.trim()).filter(Boolean);
}

async function readTripSeedLines() {
  const gz = path.join(SEED_DIR, 'trips.jsonl.gz');
  const plain = path.join(SEED_DIR, 'trips.jsonl');
  const lines = [];
  if (fs.existsSync(gz)) {
    const rl = readline.createInterface({
      input: createReadStream(gz).pipe(zlib.createGunzip()),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      const t = line.trim();
      if (t) lines.push(t);
    }
    return lines;
  }
  return readLines(plain);
}

export async function importWeekSeed({ verbose = true } = {}) {
  if (!fs.existsSync(SEED_DIR)) {
    if (verbose) console.log('🌱 No seed/week/ directory — skip import');
    return { imported: false, reason: 'missing' };
  }

  const metaPath = path.join(SEED_DIR, 'meta.json');
  let meta = null;
  try {
    if (fs.existsSync(metaPath)) meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch { /* ignore */ }

  fs.mkdirSync(path.join(ROOT, 'public'), { recursive: true });

  const simpleTargets = [
    { seed: 'events.jsonl', dest: 'events.log', key: line => {
      try { return JSON.parse(line).eventId || line; } catch { return line; }
    } },
    { seed: 'fuel-history.jsonl', dest: 'fuel-history.log', key: line => {
      try {
        const o = JSON.parse(line);
        return o.eventId || `${o.assetId}|${o.timestamp}|${o.eventType || ''}|${o.level}`;
      } catch { return line; }
    } },
  ];

  const summary = {};
  for (const t of simpleTargets) {
    const seedPath = path.join(SEED_DIR, t.seed);
    const destPath = path.join(ROOT, t.dest);
    if (!fs.existsSync(seedPath)) {
      summary[t.dest] = { added: 0, skipped: 'no seed file' };
      continue;
    }
    const existing = readLines(destPath);
    const seen = new Set(existing.map(t.key));
    const seedLines = readLines(seedPath);
    const toAdd = [];
    for (const line of seedLines) {
      const k = t.key(line);
      if (seen.has(k)) continue;
      seen.add(k);
      toAdd.push(line);
    }
    if (toAdd.length) {
      fs.writeFileSync(destPath, `${[...toAdd, ...existing].join('\n')}\n`);
    }
    summary[t.dest] = { added: toAdd.length, existing: existing.length, seed: seedLines.length };
    if (verbose) console.log(`🌱 ${t.dest}: +${toAdd.length} from seed (${seedLines.length} seed / ${existing.length} had)`);
  }

  {
    const destPath = path.join(ROOT, 'public', 'trips.log');
    const existing = readLines(destPath);
    const tripKey = line => {
      try {
        const t = JSON.parse(line);
        return String(t.TripId ?? t.TripID ?? t.Id ?? t.tripId ?? line);
      } catch { return line; }
    };
    const seen = new Set(existing.map(tripKey));
    const seedLines = await readTripSeedLines();
    const toAdd = [];
    for (const line of seedLines) {
      const k = tripKey(line);
      if (seen.has(k)) continue;
      seen.add(k);
      toAdd.push(line);
    }
    if (toAdd.length) {
      fs.writeFileSync(destPath, `${[...toAdd, ...existing].join('\n')}\n`);
    }
    summary['public/trips.log'] = { added: toAdd.length, existing: existing.length, seed: seedLines.length };
    if (verbose) console.log(`🌱 public/trips.log: +${toAdd.length} from seed (${seedLines.length} seed / ${existing.length} had)`);
  }

  return { imported: true, meta, summary };
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  importWeekSeed({ verbose: true }).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
