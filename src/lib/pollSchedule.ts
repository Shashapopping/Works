/**
 * Page/card rollup polls: ~60s with 0–8s jitter so Home + several pages
 * don't all hit SQLite on the same second after login.
 */

export const PAGE_ROLLUP_MS = 60_000;
export const PAGE_ROLLUP_JITTER_MS = 8_000;

export function jitteredDelayMs(periodMs = PAGE_ROLLUP_MS, jitterMs = PAGE_ROLLUP_JITTER_MS) {
  return periodMs + Math.floor(Math.random() * (jitterMs + 1));
}

/** Repeating timeout (not setInterval) so each wait includes a new jitter. */
export function startJitteredInterval(
  fn: () => void,
  periodMs = PAGE_ROLLUP_MS,
  jitterMs = PAGE_ROLLUP_JITTER_MS,
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(() => {
      if (stopped) return;
      try {
        fn();
      } finally {
        schedule();
      }
    }, jitteredDelayMs(periodMs, jitterMs));
  };

  schedule();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
