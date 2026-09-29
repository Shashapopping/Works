/**
 * Stats worker — child process forked by stats-store.js at the lowest CPU priority.
 * Heavy SQLite census work runs here so the API process never blocks on it.
 * The parent sends one job at a time: { id, kind, params } → { id, value | error, ms }.
 */
import { computeSafetySummary, computeHosRecords } from './mix-test.js';

const handlers = {
  'safety-summary': params => computeSafetySummary(params),
  hos: params => computeHosRecords(params?.date || undefined),
};

process.on('message', (msg) => {
  if (!msg?.id) return;
  const started = Date.now();
  try {
    const handler = handlers[msg.kind];
    if (!handler) throw new Error(`Unknown stats job kind: ${msg.kind}`);
    process.send({ id: msg.id, value: handler(msg.params || {}), ms: Date.now() - started });
  } catch (err) {
    process.send({ id: msg.id, error: err?.message || String(err), ms: Date.now() - started });
  }
});

process.on('disconnect', () => process.exit(0));
process.send({ ready: true });
