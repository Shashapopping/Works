# Demo branding restore map

**Kill-switch:** `VITE_DEMO_BRANDING` in **`.env.local`** (gitignored).

Committed code defaults to **OFF** (`import.meta.env.VITE_DEMO_BRANDING === 'true'` only).

```bash
# .env.local  (local demos only — never commit)
VITE_DEMO_BRANDING=true
```

To restore HBM: remove the line or set `VITE_DEMO_BRANDING=false`, then restart Vite and hard-refresh.

No DB/JSON is rewritten. Logo file was **not** deleted: `public/HBM-logo.jpeg`.

---

## What demo mode does

| Concern | Mechanism | Demo on |
|---|---|---|
| Product / client chrome | `productName()`, `clientName()`, logo helpers | Fleet Intelligence / Demo Fleet |
| Driver names | `demoDriverLabel` → stable **realistic mock** names (not real people) | + **Mock names** badge on driver pages |
| Phones | `demoPhoneLabel` | Fake `+234 80…` numbers |
| Places / brand IP | `demoPlaceLabel` / `brandLabel` | Scrub HBM/Lafarge; soften street addresses |
| Coverage | `FleetContext` sanitizes events, vehicles, notifications, vault, driver-distance; pages that fetch distance/KPI scrub on load | Most UI surfaces |

Helpers: `src/config/demoBranding.ts`, `src/lib/demoSanitize.ts`, `src/lib/branding.ts`, `displayDriverName()`.

---

## Flip off (full revert)

1. Delete or set false: `VITE_DEMO_BRANDING` in `.env.local`
2. Restart `npm run dev` (Vite only reads env at startup)
3. Hard-refresh — Login + Sidebar show `/HBM-logo.jpeg` and HBM naming

---

## Git safety

- `.env.local` is gitignored — demo **ON** cannot be pushed accidentally via that file
- Committed `demoBranding.ts` never hardcodes `true`
- Do not commit a production `.env` with `VITE_DEMO_BRANDING=true`
