# Speed of Dashboard — Incident Intelligence event cap

## What happened

Commit `a0d1ba6` ("Fix unbounded events query and week-selectable safety trend")
widened `FleetContext`'s boot-time events fetch from a 7-day unbounded window to
a 14-day window capped at `limit=2000`, to cut first-load latency:

```
src/context/FleetContext.tsx
- const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
- const res = await authFetch(`/api/events/log?from=...&to=...`);
+ const from = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
+ const res = await authFetch(`/api/events/log?from=...&to=...&limit=2000`);
```

That capped array (`events`, from `useFleet()`) is shared by every page on the
dashboard — home widgets, Coaching, Trends, Driver Management, Safety, and
Incident Intelligence (Total Events KPI, Event Explorer, By Driver, Response
Tracking) all read from the same context state.

## Why it broke Incident Intelligence specifically

The fleet generates roughly **3,000 events/day** (measured 2026-08-26:
~21,600 events in the last 7 days, ~43,400 in the last 14 days). The backend
returns events `ORDER BY event_time DESC`, so `limit=2000` didn't trim the
14-day window lightly — it collapsed it to roughly **the most recent 16
hours** of events. Everything older than that silently vanished from
`events`.

Incident Intelligence's Total Events KPI, Event Explorer table, By Driver
tab, and Response Tracking tab all filter this same capped array client-side
by the selected date range (`today` / `7days` / `30days` / `alltime`). Once
the array only covered ~16 hours, every range wider than "today" showed an
undercounted total and a truncated event list — the page looked frozen /
locked rather than just "a bit low."

Other pages that only look at recent activity (home widgets, Coaching, etc.)
weren't visibly affected, since they don't need more than the capped window.
`Driver Management` (default range `30days`) has the same latent bug — it
reads from the same capped `events` — but wasn't reported broken because it
wasn't checked yet.

## Fix applied so far

`src/pages/IncidentIntelligence.tsx` now fetches its own event set scoped to
the selected date range (`isoIncidentRange(dateRange)`), independent of the
capped `FleetContext` boot feed, using the same stale-while-revalidate
pattern (`authCachedJson` + `cachePeek`, 60s TTL) already used in
`ReportsPage.tsx`. `FleetContext`'s capped boot fetch was left untouched so
every other page keeps its fast first paint.

This fixes correctness for Incident Intelligence, but it re-opens the
original performance question the 2000-cap was meant to solve: fetching an
unbounded row set for a 7-day or 30-day range means pulling ~21,000–90,000+
JSON rows into the browser when that tab is opened. At this event volume,
that is a real "will this feel slow" risk for anything wider than "today"
(~3,000 rows).

## Not yet applied — same bug, deferred by request

Driver Management, Safety (WeeklySafetyTrend / WorstPerformers, which is the
"week-selectable safety trend" feature from the same commit), and any other
page reading `events` for a range wider than the capped boot window still
have this bug. Left alone for now to avoid stacking too many changes at
once.

## Better long-term direction (not implemented)

Two different needs are currently both being served by dumping raw event
rows into the browser, and they don't have to be:

1. **Aggregate numbers** (Total Events KPI, byLabel breakdown, weekly safety
   trend, worst performers) don't need row-level data at all. The backend
   already has `getSafetySummary()` (`GET /api/safety/summary?from=&to=`),
   which does `COUNT`/`GROUP BY` in SQLite and returns `incidentTotal` /
   `byLabel` directly — cheap regardless of range size, no row transfer.
   Swapping these KPIs to that endpoint would be strictly faster than either
   the pre-fix or post-fix behavior.

2. **Row-level views** (Event Explorer's table, per-driver consequence
   scoring) do need actual event rows, but should be paginated server-side
   (`/api/events/log?format=page&limit=&offset=`, which already returns an
   accurate `total` via `countMatchingEvents()`) instead of fetched
   unbounded. "Today" (~3k rows) is cheap enough to pull whole; 7-day/30-day
   ranges are not.

Doing this properly means touching Driver Management, Incident Intelligence,
Response Tracking, and Safety together, which is more change than wanted
right now — documented here so it isn't lost.

## Speed plan (keep / do) — 2026-08-31

### Leave trip storage as-is

| App | Keep |
|-----|------|
| **HBM** | SQLite columns only; no full-trip JSON payload; no CNL-style trip RAM cache |
| **CNL** | 1-day RAM cache + slim JSON `payload` (right for smaller fleet / richer trip UI) |

Do **not** copy CNL’s trip-in-RAM or payload-blob model into HBM for speed — at HBM volume (~36k trips/day, ~878k in DB) that adds memory risk without fixing the real UI slowness.

HBM already slims trips on ingest (`slimTrip` → flat columns). CNL slims too but still keeps a ~1.3 KB avg JSON payload for SubTrips/positions/fuel detail.

### What will make HBM much faster

1. **Aggregates in SQLite, not in the browser** — KPIs/summaries via endpoints like `GET /api/safety/summary?from=&to=` (`COUNT` / `GROUP BY`), not downloading tens of thousands of event rows for totals.
2. **Paginate row tables** — Event Explorer / long lists: server `limit` + `offset` (and `total`), not full 7–30 day dumps.
3. **Keep the boot feed small** — `FleetContext` capped events for first paint; heavy pages fetch their own scoped data (Incident Intelligence pattern).
4. **Only add a 1-day trip RAM cache if measured** — if a specific page is slow from repeated SQLite trip reads; not as a default “make it fast” move.

### Also planned (broader work)

- UI changes and new pages (separate from trip-storage decisions)
- Wire more pages off the capped shared `events` array onto summary + paginated APIs (Driver Management, Safety trends, etc. — see sections above)

### Address cache (HBM-only, keep)

`public/address-cache.json` (~1.5 MB): Nominatim reverse-geocode grid + sticky per-asset addresses. Feeds `data.json` `position.address` (map, fleet tables, etc.). Dirty-flag saves; skips re-geocode when grid/asset already has a usable address. Valid — do not drop when porting CNL UI.

## Implemented on `rough` (2026-08-31)

Chevron-style speed pass (safe, no trip-RAM change):

1. **Boot events capped at 500** (`fleet:events:boot-v4`) — Chevron-scale first paint; heavy pages use summary / paginated APIs.
2. **Boot prefetch expanded** — distance ranges, safety summary (+ prev30d), risk drivers, fuel week, KPI, HOS, trips/session.
3. **Peek-first revisit** — FleetContext safety exposure; ReadyMix trips/session; Tankers census; Reports default preview; Fatigue already had HOS peek.
4. **Incident Intelligence**
   - KPIs → `/api/safety/summary` (SQL aggregates)
   - Event Explorer → server `format=page` pagination
   - By Driver → `/api/risk/drivers`
   - Response Tracking → `/api/risk/drivers` (+ 7d window totals); **lazy expand** loads 10 events per driver
5. **Safety Worst Performers** → `/api/risk/drivers?range=30d` (not capped boot events)
6. **Driver Management** → scores from `/api/risk/drivers` + trip distance; **lazy expand** loads recent events
7. **Sidebar hover** → JS chunk preload **and** sequential API warm for heavy routes

### Still deferred

- Documents / Settings admin fetches — lower priority.
- Safety weekly trend could move to SQL day-buckets later (already uncapped for selected weeks).

### Accuracy pass (boot feed must not undercount)

Pages that need period truth no longer read `FleetContext` boot events:

| Page | Source |
|------|--------|
| Coaching / Training | `/api/risk/drivers?range=30d` + trip distance |
| Trends | `/api/events/log?…&limit=all` for selected period |
| Tankers KPIs | `/api/safety/summary` census; list uses `limit=all` then filter |
| Fleet segments | summary 30d + `limit=all` events filtered to assets |
| Reports & Reviews | 90d `limit=all` for weekly UI + exports |
| ARIA Intelligence | risk drivers + safety summary + paginated recent rows |

Boot `limit=500` remains for first paint / live widgets only.

## Server 504s (2026-09-28)

### What was happening

- The droplet (1 vCPU, 2 GB RAM, 1.5 GB `fleet.db`) runs one Node process. better-sqlite3 is synchronous, so a heavy query freezes every request — pages, map, notifications, even `/` and images — until nginx gives up with a 504.
- 504 bursts lasted ~10 minutes at a time (e.g. 11:37–11:46 and 12:00–12:09 UTC); the first request to time out in each burst was `/api/safety/summary` (30d / prev30d).
- Measured on the droplet, one 30d safety summary:
  - distance totals: 16s (1.19M trips in 30 days)
  - HOS held minutes (replays every driver's trips): 41s
  - scoring event counts (3 passes over 330k events): 35s
- In production the summary had a 90s in-memory cache per filter key. Any request after 90s, and every new site filter (e.g. `siteScope=JOZA,...`), recomputed it inside the request.
- `/api/hos` took ~20s and also shows up in the 504 lists.

### Applied

- nginx `hbm-dashboard`: `proxy_read_timeout 120s` / `proxy_send_timeout 120s` / `proxy_connect_timeout 10s`; stray `.bak` configs moved out of `sites-enabled` to `/root/nginx-backups/` (they caused "conflicting server name" warnings).
- Stored stats (`scripts/stats-store.js` + `scripts/stats-worker.js`):
  - `/api/safety/summary` and `/api/hos` never compute on a request; they return the stored copy (RAM + `stats_cache` table, so restarts serve instantly).
  - Calculation runs in a separate Node process at lowest priority (`ionice -c3 nice -n 19` on Linux), one job at a time with a 2s pause, so the API process keeps the CPU.
  - Refresh: 30d summaries (every filter used in the last 24h) and today's HOS every 10 minutes; prev30d and past-day HOS once after local midnight; custom `from/to` windows on request when older than 10 minutes (bucketed to 10-minute boundaries so "now"-based windows share one key).
  - First request for a never-seen key waits for the worker up to 100s (other users unaffected), else 503 + `Retry-After: 30`.

### Next: one 10-minute stats job for every aggregate

The safety summary, risk lists, distance totals, trends and HOS are all the same underlying data (trips + events) at different levels of detail, but each endpoint re-scans 1–2M raw rows on its own.

- Build per-truck, per-day totals once and store them in SQLite (+ RAM):
  - `safety_distance_daily(day, asset_id, driver_id, distance_km, trip_count)` — same bucketing as `tripRangeWhere`
  - `safety_event_daily(day, asset_id, driver_id, label, n)` — `SCORING_LABELS` + overspeed filter
  - `safety_hos_daily(day, driver_id, asset_id, violation_minutes)` — 24h lookback across midnight; over-limit minutes attributed to the day and truck being driven
  - `safety_rollup_days(day, built_at)`
- Closed days are built once (nightly rebuild of the last 3 days for late MiX syncs); only today is rebuilt every 10 minutes (a few seconds of work). Boot backfills missing days one per tick. CLI `scripts/rebuild-safety-rollups.js --from --to` after `backfill-week.js`.
- Every stats endpoint (safety summary, `/api/risk/drivers`, `/api/driver-distance` summaries, `/api/events/trends`, HOS) becomes a sum over stored rows for the scope — milliseconds, any site filter.
- Live feed stays on the 30s poll: positions/map (`/api/data`), live alerts, notifications, trips sync.
- ~3,200 trucks × 60 days ≈ a few hundred thousand small rows (20–40 MB). With this the stats worker may no longer be needed.
- Expected differences: distance and event counts identical; site-filtered HOS may move slightly (counts the driver's full continuous driving, no artificial reset at the window start).

### Still freezing the main process (not yet moved)

- `/api/events/log` over 7–14 days (thousands of `assetIds` in the query string).
- `/api/driver-distance` 30d, `/api/fuel/consumption`, `/api/utilization`.

### Other findings to action

- HOS memory: with >900 live assets, `forEachDriverTripGroupInRange` buffers all ~1.2M trip rows before processing; stream per driver (temp-table scope + `ORDER BY driver_id`) instead.
- Serve `dist/` static files straight from nginx so the login page never waits on Node.
- CNL / JMG nginx proxy to `localhost:3000/3001` resolves to IPv6 `[::1]` and gets connection refused; point them at `127.0.0.1`.
- MiX upstream: intermittent "Trips endpoint 403" (HTML page), "Authentication server returned HTML, not JSON", and empty position responses — investigate throttling.
