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
