# Design audit

**Scope:** every route (`/`, `/dashboard`, `/alerts`, `/climate`, `/map`, `/disaster`, `/classic`, `/login`, `/signup`, `/offline`), signed out and in a demo session, at 1440 px (desktop) and 390 px (mobile).

**Screenshots:** `weathergpt-web/screenshots/audit-before/{desktop,mobile}/` (git-ignored). To regenerate:

```powershell
cd weathergpt-web
npm run build
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

_(filled in when the overhaul is done)_
