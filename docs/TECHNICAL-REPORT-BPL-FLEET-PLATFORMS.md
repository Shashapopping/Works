# Technical Report: BPL Fleet Intelligence Platforms  
## Chevron (CNL) · JMG · HBM (ex-Lafarge)

**Document type:** Engineering inventory (raw technical source for later portfolio editing)  
**Authoring basis:** Codebases under `Documents/Code2` — `BPL-Chevron-Dashboard V1`, `JMG-Dashboard V2`, `Larfarge-Dashboard Scaffold 1` (HBM)  
**Package family name:** `BplDash` (Best Practices Ltd)  
**Date of inventory:** August 2026  

---

## 1. Executive technical summary

Three production-oriented fleet telematics dashboards were built as a **shared product family** for Best Practices Ltd (BPL), each branded for a different Nigerian fleet operator but sharing a common architectural spine:

| Platform | Branding in product | Primary ops focus | Runtime maturity |
|----------|---------------------|-------------------|------------------|
| **Chevron / CNL** | CNL Tracking Dashboard | Panic + live status console | Narrow SPA; Clerk UI auth; Express + SQLite events |
| **JMG** | JMG / BPL Fleet (mixed branding in repo) | Multi-page fleet + safety + SafeIQ | Express + JSONL logs; SQLite prepared but not fully wired in server |
| **HBM** | HBM Fleet Intelligence (rebrand from Lafarge) | Full platform: segments, fuel, KPI, RBAC, reports, documents | Express + SQLite primary store; custom session auth; richest feature set |

**Shared core idea:** Poll **MiX Telematics Integrate (ZA)** on a short interval, materialize fleet state for a React SPA, and surface HSE / operations workflows (panic, IVMS events, drivers, maps, exports).

**Deployment pattern (all three):** DigitalOcean droplet(s), nginx reverse proxy, **PM2** Node processes, GitHub Actions SSH deploy on `main`.

---

## 2. Product lineage and multi-tenant ops model

### 2.1 Evolution

```
Chevron V1 (CNL panic console)
    → expands into multi-page BPL scaffold
        → JMG V2 (JSONL-heavy sibling)
        → HBM / Lafarge scaffold (SQLite + auth + segments + fuel/KPI engines)
```

Evidence of lineage:

- Same npm package name: `BplDash@0.1.0`
- Same dual server pattern: **Express `server.js`** (prod) + **Vite connect middleware** (dev) importing `scripts/mix-test.js`
- Same API secret header pattern: `x-api-secret`
- Shared component DNA: `AnomaliesTable`, `DriverRiskPanel`, `FleetContext`, Leaflet `MapView`, BPL CSS tokens (`bpl-*`, `--cd-*`)
- SQLite comments explicitly isolate DBs: HBM `fleet.db` “separate from Chevron/JMG”; JMG “separate from Chevron/Lafarge”
- Droplet ops note (HBM cutover docs / deploy): historically **CNL + JMG run** while HBM process may be stopped pending cutover

### 2.2 Client / org separation

| Concern | Chevron | JMG | HBM |
|---------|---------|-----|-----|
| MiX org env | `CHEVRON_ORG_ID` | `LAFARGE_ORG_ID` (legacy name in poller) | `LAFARGE_ORG_ID` (cutover plans `HBM_ORG_ID` alias) |
| App paths (typical) | `/var/www/cnl-dashboard` | PM2 app via secrets | `/var/www/hbm-dashboard` (from `larfarge-dashboard`) |
| PM2 names | `cnl-dashboard` | via `PM2_APP_NAME` | `HBM-Dashboard` / `hbm-dashboard` |
| Public host pattern | CNL deploy workflow | BPL deploy workflow | `larfarge…` → target `hbm.bestpracticesltd.com.ng` |

---

## 3. System architecture (common)

### 3.1 High-level topology

```
Browser (HashRouter SPA)
    │  credentials / x-api-secret (fleet APIs)
    │  session cookie (HBM auth APIs)
    ▼
Node process (Express :PORT or Vite :5173)
    ├── Static dist/ (prod)
    ├── REST APIs
    ├── MiX poller loop (mix-test.js)
    ├── Persistence (JSON files and/or SQLite fleet.db)
    └── Optional: email scheduler, environment lookups
            │
            ▼
    MiX Telematics (identity.za + integrate.za)
```

### 3.2 Dev vs production API parity

- **Development:** Vite plugin (commonly named `mix-data-poller`) registers middleware for `/api/*` and starts polling so the SPA works without a separate Express process.
- **Production:** `node server.js` serves built assets and the same route family.
- Implication: engine modules under `scripts/` must stay isomorphic to both hosts (no browser-only assumptions in poller/engines).

### 3.3 Security layers

1. **Fleet data APIs** — shared secret header `x-api-secret` (`API_SECRET` / `VITE_API_SECRET`).
2. **User identity**
   - Chevron: **Clerk** (`ClerkProvider`, hash SignIn).
   - JMG: Clerk dependency present; **not mounted** in entry (auth incomplete / copy-only RBAC in Settings).
   - HBM: **Custom enterprise auth** — SQLite users/roles/sessions, httpOnly cookie `bpl_session`, bcrypt hashes, rate-limited login, force password change, Settings → Users/Roles.
3. **Secrets placement**
   - `VITE_*` may ship via CI for frontend bake.
   - `MIX_*`, org IDs, Resend keys, bootstrap passwords stay on droplet `.env` only.
   - Explicit ops rule: **do not Vite-build on 1GB droplet** (OOM); build in CI, SCP `dist/`.

---

## 4. Technology stacks by platform

### 4.1 Frontend (all)

| Layer | Choice |
|-------|--------|
| UI library | React 18 |
| Language | TypeScript |
| Bundler | Vite 6 (`@vitejs/plugin-react`) |
| Routing | `react-router-dom` HashRouter (JMG/HBM); Chevron uses view toggle without router |
| Icons | lucide-react |
| Charts | recharts |
| Maps | leaflet + leaflet.markercluster |
| Component primitives | Radix UI + CVA / clsx / tailwind-merge (shadcn-style dependency set) |
| Exports | jspdf + jspdf-autotable, xlsx-js-style (plus CDN copies in some `index.html`s) |
| Toasts / UX extras | sonner, cmdk, vaul, embla-carousel, next-themes, react-hook-form |

### 4.2 Backend (all)

| Layer | Choice |
|-------|--------|
| HTTP | Express 5 |
| Env | dotenv |
| HTTP client | node-fetch (MiX) |
| Process manager | PM2 (`--max-old-space-size=768` on HBM) |
| Reverse proxy | nginx → localhost app port |

### 4.3 Persistence divergence

| Store | Chevron | JMG | HBM |
|-------|---------|-----|-----|
| Live fleet snapshot | `public/data.json`, `metadata.json` | same | same |
| Events / panic | SQLite `events`, `panic`, `acknowledged` | Primarily `events.log` / `panic.log` (+ SQLite scripts unused by server) | SQLite primary; Vite events API fixed to read SQLite |
| Trips | Limited / session files | `trips.log`, session JSON | SQLite `trips` (600k+ rows observed in ops) |
| Fuel history | Limited | `fuel-history.log` | SQLite `fuel_history` |
| Auth | Clerk (external) | Incomplete | SQLite `users`, `sessions`, `roles`, `role_permissions`, `auth_audit` |
| Documents | — | Placeholder page | SQLite + `data/documents/` filesystem archive |
| Automations | — | — | `report_automations` + Resend scheduler |

### 4.4 Notable HBM-only runtime packages

- `better-sqlite3` (wired end-to-end)
- `bcryptjs`, cookie/session handling, rate limiting patterns
- `resend` (invite + automated report email)
- Document archive module (`scripts/documents.js`)

---

## 5. MiX Telematics integration (shared core)

### 5.1 Protocol

- **Identity:** OAuth token against `identity.za.mixtelematics.com`
- **API:** Integrate host `integrate.za.mixtelematics.com`
- **Credentials:** `MIX_USERNAME`, `MIX_PASSWORD`, `MIX_CLIENT_ID`, `MIX_CLIENT_SECRET`
- **Organisation scope:** org ID env per client

### 5.2 Poll loop (`scripts/mix-test.js`)

Typical cycle (interval differs by fork: **~10s** Chevron/JMG, **~30s** HBM in recent runs):

1. Authenticate / refresh token  
2. Fetch vehicles / positions / organisation groups  
3. Fetch active events (panic, idle, overspeed, harsh events, fuel probe tickers, etc.)  
4. Persist warnings / panic / KPI-classified events  
5. Fetch incremental trips using a **since-token** (with lookback constraints; HBM restores token from `trips-session.json`)  
6. Write `public/data.json` + metadata for SPA consumption  
7. Classify vehicle status: Moving, Idle, Excessive Idle, Stationary, Parked, Inactive, Offline, Panic  

### 5.3 Event taxonomy (representative)

- Panic  
- Harsh braking / acceleration / cornering  
- Overspeeding / overspeed tiered  
- Idle / excessive idle  
- Fuel probe 1-min / 5-min tickers, trip start/end fuel events  
- Fatigue / loaded / offload (KPI constants; Chevron guidance referenced for DMS yawning)  

Unknown EventTypeIds are logged for discovery without crashing the poller.

### 5.4 Data volume characteristics (HBM ops observations)

- Vehicles on wire: ~7,000+  
- Drivers lookup: ~14,000  
- Trips in SQLite: hundreds of thousands  
- Events: tens of thousands in rolling window  

These volumes drove concrete engineering work: trip queries filtered by quarry asset IDs, fuel matching via indexed binary search, consumption result caching, and avoiding full-table scans on every API hit.

---

## 6. Platform feature matrices

### 6.1 Chevron (CNL) — V1 console

**Shape:** Single signed-in shell; table vs map toggle.

**Features:**

- Live anomaly / status table (`AnomaliesTable`)
- Leaflet clustered map (`MapView`)
- Panic UX: flashing banner, `speechSynthesis` voice loop, mute, acknowledge (SQLite)
- Event log panel with filters
- Driver risk panel
- Download modal: CSV / Excel / PDF fleet reports
- Dark theme (`cd-theme` localStorage)
- Decommissioned-vehicle exclusions; weekly driver/vehicle cache refresh

**Auth:** Clerk publishable key on frontend; API still secret-gated.

### 6.2 JMG — V2 multi-page

**Shape:** Hash-routed AppShell with many pages (scaffold for full ops product).

**Routes (representative):** Dashboard, Fleet, Drivers (+ coaching/training/certs tabs), Incidents (+ analysis/response), Safety, Trips/Dispatch, ARIA / SafeIQ, Reports/Documents, Tankers, Maintenance, Settings.

**Features beyond CNL:**

- SafeIQ / ARIA (Anthropic Claude via browser `VITE_ANTHROPIC_API_KEY`) — severity, root cause, coaching
- Fuel history API from probe logs
- Driver distance / trips session
- Environment context API (weather + traffic at incident coords)
- FeatureGate stub (pass-through)

**Persistence gap:** SQLite migration scripts exist; production Express path still largely JSON/JSONL.

### 6.3 HBM — full intelligence platform

**Shape:** Multi-segment fleet intelligence product with enterprise auth and durable storage.

**Additional / hardened capabilities:**

| Area | Technical implementation |
|------|--------------------------|
| Fleet segments | Quarry, Cement, Bulk Tankers, Ready Mix (`fleetSegments.ts`, dedicated pages) |
| Ready-mix “at plant” | Haversine geofence (~1.5 km) + idle/speed heuristics + open-trip jobsite logic (`segmentMetrics.ts`) |
| Fuel monitoring | Live probe levels, zone filters, charts (`FuelChart`, `/api/fuel/history`) |
| Fuel consumption | Trip-edge probe matching, L/km, L/h, refuel & suspect-drop detection (`consumption-engine.js`) |
| Quarry KPI | Loaded/offload pairing, utilization, harsh/overspeed/fatigue scopes (`kpi-engine.js`) |
| Driver consequence | Penalty points normalized per 100 km; Green/Amber/Yellow/Red; recommended actions (`consequenceScore.ts`) |
| Safety behaviour | Radar / offence-share scoring (Safety page; orientation corrected so higher = more offence) |
| Incident intelligence | Trends, response workflows, environment enrichment |
| Custom RBAC | Permission catalog, role editor DnD, user invite email |
| Reports | Filterable event log + trends; CSV/XLSX/PDF export |
| Report Automate | Per-user schedules, pack selection, Resend delivery |
| Documents library | Windows Explorer–style archive; auto-file on download; Year→Month→Type folders |
| Feature gating | Package locks for Dispatch / AI Insights (`lockedFeatures.ts`) |
| Cutover tooling | `docs/HBM-CUTOVER.md`, GitHub Actions artifact deploy, seed/import/backfill scripts |

---

## 7. Deep dive: HBM engines and algorithms

### 7.1 Fuel consumption engine

**Files:** `scripts/consumption-engine.js`, `scripts/fuel-constants.js`, `src/lib/fuelConsumption.ts`

**Pipeline:**

1. Resolve period bounds (day / week / month / custom).  
2. Load fuel history for window (+ lookback for edge matching).  
3. Index readings per asset (pre-parsed timestamps, sorted).  
4. Load **only quarry-scoped trips** from SQLite (`getTripsInRange` with asset ID chunks) — critical performance fix vs scanning entire fleet trips.  
5. For each trip, binary-search nearest fuel at start (prefer trip_start / 5-min, before) and end (trip_end / 5-min, after) within ±15 minutes.  
6. Trip fuel estimate = start level − end level when decreasing.  
7. Detect refuels: level rise ≥ **50 L** within **30 min**.  
8. Detect suspect drops: fall ≥ **30 L** within **30 min**, with noise heuristics (sub-2-min cliffs, rebound, spike-return).  
9. Aggregate per asset / site; build daily series.  
10. Cache results ~30s to absorb dashboard polling.

### 7.2 Quarry KPI engine

**Files:** `scripts/kpi-engine.js`, `scripts/kpi-constants.js`

- Scope quarry zones (e.g. Ewekoro, Mfamosing).  
- Pair loaded ↔ offload intervals (cap ~2h).  
- Asset class handling (e.g. DT/RD vs excavators).  
- Harsh braking / overspeed / fatigue event rates for operational scorecards.

### 7.3 Consequence / driver scoring

**File:** `src/lib/consequenceScore.ts` (aligned with BPL Consequence Management spec)

- Scored labels: Harsh Braking, Harsh Acceleration, Overspeeding / Overspeed Tiered, Harsh Cornering.  
- Penalty points = −(eventCount × configurable points).  
- Normalize: `score = penaltyPoints / max(distanceKm/100, 0.01)`.  
- Bands: Green / Amber / Yellow / Red with tunable thresholds (Settings → Alert Thresholds localStorage).  
- Display score mapped to 0–100 bar; recommended consequence text by band + occurrence index.  
- **Known product nuance:** distance often from current+last month trips while events can be all-time → low distance inflates Red tier (documented in product discussions).

### 7.4 Ready-mix plant presence

**File:** `src/lib/segmentMetrics.ts`

- Seed plant pins + live GPS clusters.  
- Geofence radius ~1.5 km (Haversine).  
- “At plant” requires true stop (Idle/Stationary/Parked and speed &lt; 5 km/h).  
- Open trips without TripEnd strengthen jobsite classification when away from plant.

### 7.5 Environment enrichment

**File:** `scripts/environment-service.js`

- Geocode (Google or Nominatim fallback).  
- Weather via Open-Meteo-style sources.  
- Traffic via TomTom when keyed; heuristic Lagos corridor hours otherwise.  
- Exposed as `/api/environment` for incident context.

### 7.6 Trip ingestion hygiene

- Incremental since-token with validity window.  
- Merge journeys with small time gaps (≈5 min).  
- Filter negligible distances (&lt; ~0.5 km).  
- Excel / HBM Availability CSV importers for historical haul fuel/trip seeding.  
- Compaction utilities for oversized trip logs during JSONL era.

---

## 8. Auth and RBAC (HBM)

### 8.1 Model

- Opaque session IDs in httpOnly cookie `bpl_session` (≈7 day TTL).  
- Passwords hashed with bcrypt.  
- Tables: `users`, `sessions`, `roles`, `role_permissions`, `auth_audit`.  
- Bootstrap admin created only when user table empty (`AUTH_BOOTSTRAP_*`).  
- Production: `AUTH_COOKIE_SECURE=1`, `NODE_ENV=production`, Express `trust proxy` for nginx TLS.  
- Login rate limiting by IP.

### 8.2 Permissions

Catalog shared between `scripts/auth.js` and `src/lib/roleConfig.ts` (e.g. dashboard, fleet, drivers, incidents, quarry, fuel-*, reports, documents, settings, user-management, …).

Default roles examples: `admin`, `hse-officer`, `operations-manager`, `view-only`.

### 8.3 Frontend enforcement

- `RequireAuth` + `permissionForPath`  
- Sidebar filtered by permissions  
- Settings → Roles: drag-and-drop permission assignment  
- Settings → Users: create/disable/assign role; Resend invite with temporary password  

### 8.4 Email (Resend)

- Domain-verified sender (e.g. `noreply@hbm.…`)  
- Invite emails + automated report packs  
- DNS: DKIM / SPF / MX for sending subdomain  

---

## 9. Reports and Documents (HBM)

### 9.1 Reports page

- Live event filters: date range, sites, event types, search  
- Views: event table + trend charts (Recharts)  
- Export CSV / Excel / PDF via `src/lib/reportExport.ts`  
- Automate panel: daily/weekly/monthly schedules, pack selection, test send  

### 9.2 Documents library

- Windows Explorer–style UI: folder tree, breadcrumbs, Name/Date/Type/Size  
- Filing path: `Reports\YYYY\MM-MonthName\Events\`  
- On download: browser file + `POST /api/documents/archive` (base64)  
- Disk: `data/documents/` (gitignored); metadata in `document_folders` / `document_files`  
- Re-download via `/api/documents/:id/download`  

---

## 10. Frontend architecture patterns (JMG / HBM)

### 10.1 State

- `FleetContext`: vehicles, events, metadata, driver distance, fuel summary, polling intervals, `authFetch` helper  
- `AuthContext` (HBM): session user, permissions, login/logout/password change  
- Client caches (`apiCache`) with TTLs for fuel/KPI/events to reduce hammering  

### 10.2 Layout

- `AppShell` + sticky sidebar + site selector  
- Page headers / KPI strips / BPL card language  
- FeatureGate for package entitlement overlays  

### 10.3 Mapping

- Leaflet base map, marker clustering, status colouring, panic emphasis  
- Position enrichment from `data.json` when event rows lack coordinates  

---

## 11. API surface (consolidated)

### 11.1 Fleet / ops APIs (secret header)

`/api/refresh`, `/api/reset`, `/api/data`, `/api/metadata`, `/api/drivers`, `/api/events`, `/api/events/log`, `/api/acknowledged`, `/api/environment`, `/api/trips/session`, `/api/driver-distance`, `/api/driver-distance/journeys/:assetId`, `/api/fuel/history`, `/api/fuel/consumption`, `/api/kpi`

### 11.2 Auth / admin / documents (session cookie — HBM)

`/api/auth/login|logout|me|change-password`, `/api/users`, `/api/roles`, `/api/reports/automate(+/:id|/send)`, `/api/documents`, `/api/documents/tree`, `/api/documents/archive`, `/api/documents/:id/download`

---

## 12. Tooling, scripts, and data pipelines (HBM-heavy)

| Script / area | Purpose |
|---------------|---------|
| `mix-test.js` | Live MiX poller |
| `db.js` | Schema + query helpers |
| `migrate-to-sqlite.js` | JSONL → SQLite cutover |
| `import-seed.js` / seed pack | Week seed import for demos |
| `import-trips-excel.js` | Trip Excel ingest |
| `import-hbm-availability-csv.js` | HBM Availability fuel/trip CSV |
| `compact-trips-log.js` | Log compaction |
| `backfill-week.js` | Historical backfill |
| `consumption-engine.js` / `kpi-engine.js` | Analytics engines |
| `report-automate.js` | Scheduler for email packs |
| `documents.js` | Archive filesystem + metadata |
| `email.js` | Resend wrappers |
| `auth.js` / `auth-http.js` | Auth domain + HTTP adapters |

CI: GitHub Actions — build on runner with `VITE_*`, SCP `dist`, remote `npm ci --omit=dev`, PM2 restart/stop as configured.

---

## 13. Infrastructure and operations

### 13.1 Hosting

- DigitalOcean droplet(s)  
- nginx TLS termination  
- PM2 process supervision  
- Separate app directories / PM2 names per client brand  

### 13.2 Resource constraints

- ~1GB RAM droplet → Node heap capped (`--max-old-space-size=768`)  
- Frontend build must not run on droplet  
- Large trip tables require indexed queries and scoped analytics  

### 13.3 Cutover / branding (HBM)

Documented in `docs/HBM-CUTOVER.md`:

- Path rename `larfarge-dashboard` → `hbm-dashboard`  
- Domain `hbm.bestpracticesltd.com.ng`  
- Auth bootstrap sequence on first production login  
- Repo visibility / deploy-key prerequisites if going private  

---

## 14. Dependencies declared but unused / transitional

Across forks, several packages appear in `package.json` without active wiring in `src/`:

- `firebase`  
- `aws-amplify` / Amplify CDK (Chevron)  
- `@clerk/clerk-react` on JMG/HBM (Chevron uses it; others retain dependency or UI copy)  

These reflect transitional auth/hosting experiments during the product family’s evolution.

---

## 15. Engineering challenges solved (portfolio-relevant)

1. **Real-time telematics ingestion** — OAuth + polling + status classification at fleet scale.  
2. **Multi-client isolation** — separate org IDs, DBs, PM2 apps, domains on shared architectural template.  
3. **Persistence migration** — JSONL → SQLite without losing live poller behaviour; API consumers kept stable.  
4. **Analytics at scale** — fuel consumption rewritten to avoid O(fleet trips) loads; binary search fuel matching; short TTL caches.  
5. **Domain algorithms** — probe-based fuel estimates, suspect siphon heuristics, quarry KPI pairing, geofenced plant presence.  
6. **HSE workflows** — panic acknowledge + voice, incident enrichment, consequence management scoring.  
7. **Enterprise access control** — custom session RBAC after Clerk abandonment for HBM, with invite email.  
8. **Reporting lifecycle** — export formats + scheduled email + Windows-style document archive auto-filing.  
9. **Ops discipline** — CI-built artifacts, secret hygiene, droplet memory limits, staged brand cutover.  

---

## 16. Suggested portfolio framing (notes for later editing)

When turning this into a portfolio case study, consider three project cards under one “BPL Fleet Platforms” umbrella:

1. **CNL Panic Operations Console (Chevron)** — focused real-time safety console, Clerk, SQLite ack store, voice alerting.  
2. **JMG Fleet Operations Suite** — multi-page expansion: SafeIQ/ARIA, trips, fuel logs, DigitalOcean continuous deploy.  
3. **HBM Fleet Intelligence** — enterprise platform: SQLite system of record, RBAC, segment analytics, fuel/KPI engines, Resend, document archive, Lafarge→HBM cutover.

Emphasize: **same MiX integration core**, **progressive productization**, **production constraints (RAM, multi-tenant droplet)**, and **measurable algorithms** (fuel matching, geofence, consequence scoring)—not just UI pages.

---

## 17. Repository map (local paths)

| Platform | Path |
|----------|------|
| Chevron V1 | `c:\Users\USER\Documents\Code2\BPL-Chevron-Dashboard V1` |
| JMG V2 | `c:\Users\USER\Documents\Code2\JMG-Dashboard V2` |
| HBM / Lafarge scaffold | `c:\Users\USER\Documents\Code2\Scaffold\Larfarge-Dashboard Scaffold 1` |

---

## 18. Document status

This report is a **technical source dump**: accurate to the inspected codebases and ops docs as of August 2026. It intentionally includes internal eng detail (env names, paths, engine constants) for your later distillation into portfolio prose. Strip droplet IPs, secret names, and client-sensitive volumes if publishing publicly.
