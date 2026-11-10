# Design audit

**Scope:** every route (`/`, `/dashboard`, `/alerts`, `/climate`, `/map`, `/disaster`, `/classic`, `/login`, `/signup`, `/offline`), signed out and in a demo session, at 1440 px (desktop) and 390 px (mobile).

**Screenshots:** `weathergpt-web/screenshots/audit-before/{desktop,mobile}/` (git-ignored). To regenerate:

```powershell
cd weathergpt-web
npm run build:e2e
$env:AUDIT_DIR = "screenshots/audit-before"; npx playwright test e2e/audit.spec.ts
```

The spec (`e2e/audit.spec.ts`) is skipped unless `AUDIT_DIR` is set, so normal e2e runs don't include it.

## Before: findings

Items 1–8 are the findings from the review. Items marked **(new)** come from my own pass over the audit screenshots.

### 1. Three visual styles

| Style | Pages | Look |
|-------|-------|------|
| Living Sky | `/` | Dark, gold or cyan accent by scene, glass panels with corner brackets, HUD type (`font-hud`, `font-readout`) |
| Light teal | `/dashboard`, `/alerts`, `/climate`, `/map`, `/disaster` | Off-white canvas, white cards, teal accent, black "Weather intelligence" card |
| Plain | `/login`, `/signup` | Grey page, blue `#1a5cff` button, 🌤 emoji logo, no link home, no nav |

- `/offline` is a fourth variant: black, with a yellow icon and a cyan button.
- **(new)** Severity colours differ by page: dashboard banner uses pink/rose, risk board pills use red/orange/yellow, the home advisory uses gold.
- **(new)** Corner radii, borders and type differ (`rounded-[16px]` and `border-line` on inner pages vs `sky-glass` brackets on home).
- **Cause:** `components/console/*` and `components/panels/*` use the `sky-*` / `hud` tokens. Inner pages use the old Lovable tokens (`bg-canvas`, `bg-panel`, `text-ink`, `teal`). Auth pages use raw Tailwind and hex.

### 2. Navigation differs

- **Home `SkyNav`:** Dashboard, Map, Alerts, Climate, Risk board, **Classic**. It has no Settings link. It has role, Lite and language controls, plus Sign in.
- **Inner `TopNav`:** the logo links to `/dashboard`, not `/`, so on desktop there is no way back to Living Sky. Its links are Dashboard, Map, Alerts, Climate, Risk board, **Settings**. Settings is `href="#settings"`, a dead anchor; no settings page exists.
- **Active state:** in `TopNav` only Dashboard can be highlighted (`l.href === '/dashboard' && …`). Other pages never show which page you are on.
- **`BottomNav` (mobile):** dark on `/`, light everywhere else. It has no Risk board.
- **`/classic`:** only redirects to `/dashboard`.
- **(new)** The dashboard capability cards repeat the nav and include the dead Settings link.
- **(new)** Language is not remembered: a full page load resets it to English.

### 3. Dashboard contradiction: "Heavy rain WATCH" next to "No active advisory for this location"

- **Cause:** the two panels read different systems.
  - **The banner** reads `/api/alerts`, from the alert engine (`backend/alerts/engine.py`). It covers current conditions plus the next 24 h and uses advisory / watch / warning levels.
  - **The "Weather Intelligence" card** reads the `advisory` field of the **last chat answer** typed into the dashboard's own chat box (`ChatPanel onAdvisoryChange`). That comes from `backend/advisory.py`, run on whatever period the question asked about, with low / moderate / high levels.
- Before any question is asked, the card shows the empty state "No active advisory for this location" even when the alert engine has a watch.
- The thresholds were already shared (`engine.py` imports the constants from `advisory.py`), but each module hard-coded its own level per hazard. That only matched by coincidence.

### 4. Alerts page: "threshold: 35 mm" vs "Heavy Rain ≥ 15 mm"

- **Real backend:** a watch carries `threshold_value = HEAVY_RAIN_MM = 15.0`, the same number as the table. I checked this against the running API (see the "Verified against the real backend" section below).
- **Where 35 came from:** the Playwright mock (`e2e/support/mockApi.ts`, `threshold_value: 35`). It is not a backend bug, but it does show the real problem.
- **The real problem:** the threshold table on `/alerts` is **hard-coded in the page** (`app/alerts/page.tsx`). Nothing ties it to the backend, and the mocks drifted from both.
- Thresholds were also written out again, separately, in:
  - `docs/ROLE_ADVISORIES.md` and the README
  - CAP `<parameter>` (from the alert itself, so this one is fine)

### 5. Units

- The GFS table (`NwpPanel`) shows **Wind (m/s)**; every other surface uses km/h.
- **(new)** The table header shows the raw ISO time ("Generated at: 2026-11-01T00:00:00+00:00").

### 6. Home layout

- **Desktop:** the right column is empty below the transmission log, and wind and humidity leave an empty third slot. UV sits alone in a row, and the advisory and AQI panels leave a hole. The forecast and geo-lock row is narrower than the rows above.
- **The sky background ends at viewport height** (a hard seam at about 900 px on desktop, mid-page on mobile). Content continues on flat black. The canvas is `fixed` and sized to the viewport, and the page background behind it is a different colour.
- **(new)** On mobile, the suggestion chips run off the right edge, with no fade and no wrap.

### 7. Truncation

- The console placeholder is cut off: "Pune mein kal baaı" on mobile (the example question rotates, and the review saw "What…").
- The location **WINDOW** value is cut off: "2026-11-02T00:00 …". The raw ISO range doesn't fit.
- **(new)** The dashboard hero statistic cells wrap mid-word on the map page ("PRECIPITA…", "14.2 / km/h").

### 8. Duplication and raw data

- The dashboard and map each embed a second chat box (`ChatPanel`), with an empty area of about 900 px below it, separate from the Living Sky console.
- **Raw values shown:**
  - "open-meteo · 2026-11-01T14:00"
  - "Source: open-meteo-archive"
  - "2026-10-02" dates in the climate table
  - "SOURCE: OPEN-METEO" footers
- **(new)** Copy is inconsistent ("Cold Chilly", "Deterministic Early Warning Engine", "Meteorological Grounding"), with jargon in headings.
- **(new)** Dashboard and map pages are near-copies of each other: hero, banner, intelligence card, chat and forecast.
- **(new)** The home header says "ENGLISH · हिंदी · HINGLISH" and leaves out Marathi.

### Other

- **(new)** `/climate` shows the full 30-row table and no chart. The "period shift" card has no explanation of what was compared.
- **(new)** Map tiles: the screenshots use mocked flat tiles. The real map uses light OSM tiles on the dashboard map and dark CARTO tiles on the risk board, so the two maps look different.

## Verified against the real backend

On 2026-11-01 the real engine ran on live Open-Meteo data for Pune, Mumbai, Cherrapunji, Jaisalmer and Guwahati. All five were calm (no alerts; the highest 24 h rain was 7.4 mm in Pune), so live data could not show a watch.

The real engine was then run (not mocked) on a forecast with 20 mm of rain in 24 h. It returns a watch with `threshold_value` **15.0**, which matches the table. The 35 mm on the card is mock data only. This is now a test (`tests/test_thresholds.py`).

## Plan

1. **One source of truth for warnings.**
   - `backend/thresholds.py` holds every hazard rule: hazard, level, comparator, value and unit.
   - The alert engine and chat advisories both read their values **and levels** from it.
   - `GET /api/alerts/thresholds` serves it, and the `/alerts` table renders from the API.
   - Location status on the dashboard and map comes only from `/api/alerts`.
   - Chat advisories are labelled with the period they cover.
2. **Design system.**
   - Living Sky tokens and shared primitives: `GlassPanel`, `SkyButton`, `SkyInput`, `SeverityBadge`, `PageHeader`.
   - One `AppShell` with the same `SkyNav` everywhere, including mobile, with a working active state.
   - A static CSS sky background derived from the current weather code and local hour, covering the full page height.
3. **Page by page.**
   - Auth, alerts, dashboard (reusing the Living Sky console), map, climate, risk board, offline, home grid.
   - Remove `/classic`.
   - km/h everywhere; human-readable dates and sources.

## After

**Screenshots:** `weathergpt-web/screenshots/audit-after/{desktop,mobile}/` (same spec, `AUDIT_DIR=screenshots/audit-after`). Compare each file with the same name in `audit-before/`.

| # | Finding | Fixed in | Result |
|---|---------|----------|--------|
| 1 | Three visual styles | `d5832b8`, then one commit per page | Living Sky is the only style. Tokens are on `:root` (the old light token names are aliases of the sky palette, so nothing can render light). Every route renders in `AppShell`. Shared components are in `components/ui`. Inner pages get the CSS `StaticSky`, driven by the current weather code and local hour (`useSkyFromCurrent`); only the home page runs WebGL. |
| 2 | Navigation differs | `d5832b8` | One `SkyNav` everywhere. The logo and "Living Sky" always go home, and the active page is marked (`aria-current`). Settings is a real panel (language, role, lite mode). `BottomNav` is one dark style and includes the risk board. `/classic` is removed (404). Language is remembered per device. |
| 3 | WATCH banner next to "No active advisory" | `7c63ad9` | The chat-driven "Weather Intelligence" card is gone. The location status comes only from `/api/alerts` (the alert banner, which shows the most severe alert). Chat advisories are labelled with their period ("Advisory · Mon 2 Nov, 00:00–23:00"). Alert and advisory levels come from the same rule table. |
| 4 | "threshold: 35 mm" vs "≥ 15 mm" | `7c63ad9` | `backend/thresholds.py` is the single table, served at `GET /api/alerts/thresholds`; `/alerts` renders it. The 35 was mock data; the real engine gives 15 (tested). pytest checks the e2e fixture against the table. |
| 5 | GFS in m/s | `f1f0fef` | Converted to km/h (`msToKmh`). The model run time is readable. |
| 6 | Home grid holes, sky seam | `76b490c`, `d5832b8` | Panels span the full width under the console and log. `lib/gridFill` balances widths per breakpoint so every row is full (e2e checks it at 1440 and 390). The sky fades into `--sky-floor`, which the page background also uses (e2e checks coverage). |
| 7 | Truncated placeholder and WINDOW | `76b490c` | Examples fit at 390 px and use an ellipsis, never a mid-word cut. WINDOW reads "Mon 2 Nov, 00:00–23:00". |
| 8 | Duplicate chat box, raw values | `f1f0fef`, `0191e98`, `9c5de56` | Dashboard and map link to the Living Sky console (`/?q=…&lat=…&lon=…`). "Open-Meteo · Sun 1 Nov, 15:00 · Asia/Kolkata" replaces "open-meteo · 2026-11-01T14:00". Climate dates read "Fri 2 Oct". |

**Other fixes made along the way:**
- Auth pages: labelled inputs, inline errors, a link home, and text in four languages.
- Climate: a line chart and a separate rain chart, with palette-validated colours, tooltips, and the table behind a toggle. It no longer loads hard-coded Pune coordinates.
- Map popup and the risk board use the same dark CARTO basemap. Leaflet popups, tooltips and attribution use the sky palette.
- The five severity colours (`--sev-*`) are the same on badges, banners, cards and map dots.
- Dashboard and map share one data hook (`lib/useLocationWeather.ts`).
- Removed dead code: `TopNav`, `ChatPanel`, `ChatAsk`, `WeatherIntelligence` and the light `Panel`.

**Left as is:**
- Map tiles in screenshots are the flat mocked tile; real tiles are dark CARTO.
- Full-page captures still show the fixed bottom nav and the docked console mid-image. That is a capture artifact.
- `/disaster` default districts still carry hard-coded coordinates. See "Needs your input" in `IMPROVEMENTS_REPORT.md`.
