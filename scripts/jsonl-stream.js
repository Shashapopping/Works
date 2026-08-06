/**
 * Memory-safe JSONL helpers — avoid readFileSync of multi‑hundred‑MB logs.
 */
import fs from 'fs';

const BUF_SIZE = 1024 * 1024;

/** Yield parsed JSON objects line-by-line without holding the whole file as one string. */
export function* iterateJsonLines(filePath) {
  if (!fs.existsSync(filePath)) return;
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.alloc(BUF_SIZE);
  let leftover = '';
  try {
    let bytesRead;
    while ((bytesRead = fs.readSync(fd, buffer, 0, BUF_SIZE, null)) > 0) {
      leftover += buffer.toString('utf8', 0, bytesRead);
      const parts = leftover.split('\n');
      leftover = parts.pop() ?? '';
      for (const line of parts) {
        if (!line) continue;
        try {
          yield JSON.parse(line);
        } catch { /* skip bad line */ }
      }
    }
    if (leftover) {
      try {
        yield JSON.parse(leftover);
      } catch { /* skip */ }
    }
  } finally {
    fs.closeSync(fd);
  }
}

/** Collect lines matching an optional predicate (keeps only matches in memory). */
export function readJsonLinesFiltered(filePath, predicate = null) {
  const out = [];
  for (const row of iterateJsonLines(filePath)) {
    if (!predicate || predicate(row)) out.push(row);
  }
  return out;
}

export function readJsonLines(filePath) {
  return readJsonLinesFiltered(filePath, null);
}
