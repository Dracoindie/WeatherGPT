@AGENTS.md

# Frontend (`weathergpt-web/`, Next.js 16, TypeScript, Tailwind, react-three-fiber, MapLibre GL + deck.gl)

Loaded when working under `weathergpt-web/`. The ground rules in the root `CLAUDE.md` always apply.

- **This Next.js has breaking changes compared with training data.** Read `AGENTS.md` and `node_modules/next/dist/docs/` before writing Next code. It uses `proxy.ts`, not `middleware.ts`.
- `weathergpt-web/` was imported with `git subtree`. It is a normal folder in this repo, not a submodule.

## Pages (`app/`)

- `/`: the Living Sky chat console, with a 3D sky scene driven by real codes and wind
- `/dashboard`, `/alerts`, `/climate`, `/map`, `/disaster` (district board), `/login`, `/signup`, `/offline`
- `/map` is `components/map3d/` (MapLibre GL + deck.gl, loaded only there). Basemap: OpenFreeMap `dark` style; terrain: AWS terrarium tiles; both keyless (`components/map3d/sources.ts`). With `NEXT_PUBLIC_MAPTILER_KEY` (a public browser key; restrict it by domain): MapTiler `dataviz-dark` and `terrain-rgb-v2`, falling back to keyless at runtime on 401/403/429 or a failed style. MapLibre's CSP worker is copied to `public/vendor/maplibre-gl-worker.js` by `scripts/copy-maplibre-worker.mjs` (`predev`/`prebuild`, git-ignored). Broadcast mode renders through a portal on `<body>`; the map container node is moved, never rebuilt. Map colours are the `--map-*` tokens in `globals.css` (validated one-hue ramps). Roadmap: `docs/VISION.md`.
- Route mode (`components/map3d/route.tsx`): start and destination by search (`/api/geocode`), tap ("Pick on map") or "My location", departure now or within 72 h; the line coloured by `/api/route` levels, a timeline strip (km and clock time), findings, and "Leaving at … avoids …" with "Use this departure". Grey = beyond the forecast.
- Hazard mode (`components/map3d/hazard.tsx`, `roads.ts`): H3 hexes by level from `/api/map/hazard` (h3-js for the boundaries), hazard-type chips, a tap card with value vs threshold, a 25 km summary with "Show me the worst". Roads are coloured by the cells they cross, using the basemap's own `transportation` vectors (major classes only, a vertex budget, recomputed only on view, hour or type change); the legend says road colour is NOT traffic. No wind particles in hazard mode. Fly-tos use `flyToSteady` (a resize mid-flight would shift the end point).

## Shared code

- `context/`: `I18nContext` (UI dictionary: EN / हि / Hinglish / मरा), `AuthContext`, `DemoContext`
- `lib/api/`: backend clients
- `lib/push.ts`, `public/sw.js`: Web Push and offline cache
- `lib/voice/`: speech recognition and synthesis in en-IN, hi-IN and mr-IN
- `lib/liteMode.ts`: automatic lite mode
- `components/ui/`: the design system (`AppShell`, `PageHeader`, `SeverityBadge`, `SkyButton`, `SkyInput`; `GlassPanel` lives in `components/panels/`)
- `lib/format.ts`: human-friendly dates, windows, sources and m/s→km/h
- `lib/useLocationWeather.ts`: weather, forecast and alerts for a picked place (dashboard and map)
- `lib/gridFill.ts`: balanced panel grids with no holes
- **PWA:** `app/manifest.ts` and the service worker. The mobile layout has a bottom nav and a docked console, with no horizontal scroll at 390 px.

## Design rules (one design: Living Sky)

Every page must look like it belongs to the Living Sky home. Before adding UI, reuse what exists.

1. **Shell.** Every route renders inside `<AppShell>` (`components/ui/AppShell.tsx`). It gives the sky background, the one nav (`SkyNav`), the bottom nav and the page padding. Never add another nav or header.
2. **Background.** Inner pages use the CSS `StaticSky` (no WebGL); call `useSkyFromCurrent(current, timezone)` when the page has current weather. Only `/` runs the WebGL scene. The sky must cover the full page height (it fades into `--sky-floor`).
3. **Tokens, not hex.**
   - Text is `text-hud` / `text-hud-dim`, and lines are `border-white/10`.
   - **Strong colours are for fills, borders, dots, glows and map markers:** `bg-accent`, `border-accent`, `--sev-none | advisory | watch | warning | severe | unknown` (traffic colours: green, yellow, orange, red, dark red) (Tailwind `bg-sev-*` / `border-sev-*`, or `SEVERITY_VAR` for inline styles).
   - **Text and icons in a severity or accent colour use the lighter text shades:** `text-accent-text`, `text-sev-*-text`, or `SEVERITY_TEXT_VAR`. The strong red is about 2.2:1 as text on glass over a daytime sky; the text shades stay at 4.5:1 or more over every sky phase. `--sky-accent-text` follows the severity state (cyan → amber → rose).
   - `e2e/contrast.spec.ts` computes these ratios from the live tokens and the real sky palette (`PALETTES` in `lib/weatherScene.ts`), and fails on `text-sev-<level>` without `-text`, on `text-accent`, and on inline `color: SEVERITY_VAR`. axe can't measure text over the sky gradient, so this spec is the contrast check.
   - Do not use the old light classes (`bg-panel`, `text-ink`, `teal`, `coral`): they are aliases kept only for safety.
4. **Components.**
   - Surfaces are `GlassPanel` (or the `.sky-glass` class), with the label in `.sky-label`.
   - Buttons are `SkyButton` / `SkyLinkButton` (`primary | ghost | subtle`), and inputs are `SkyInput` / `.sky-input`.
   - Page titles use `PageHeader`.
   - Severity is shown with `SeverityBadge`.
   - Use `LocationPicker` for places.
5. **One chat.** The chat is the Living Sky console. Other pages link to it with `askHref(question, coords)` (`/?q=…&lat=…&lon=…`); never embed a second chat box.
6. **One source of truth for warnings.**
   - The location status is `AlertBanner`, fed by `/api/alerts`.
   - Thresholds come from `backend/thresholds.py` via `/api/alerts/thresholds`; never hard-code a threshold in the UI.
   - Chat advisories are labelled with their period.
7. **Units and formatting.**
   - km/h for wind everywhere. Convert m/s with `msToKmh`.
   - Never show raw ISO timestamps or raw source ids. Use `formatDay`, `formatLocalTime`, `formatWindow` and `formatSource` from `lib/format.ts`.
   - Weather descriptions come from `useDescribeWeather()`.
8. **Layout.**
   - Grids must have no holes at 390, 768 and 1440 px. For conditional panels, use `lib/gridFill` (`panelSpanClasses`).
   - No horizontal page scroll at 390 px: wide tables scroll inside their panel or switch to a vertical layout.
   - Nothing important may be truncated mid-word; prefer wrapping or an ellipsis with `title`.
9. **Language.** All new UI text goes in the `I18nContext` dictionary in all four languages (en, hi, hinglish, mr). Use `fill()` for `{placeholders}`.
10. **Charts.** Load the dataviz skill first.
    - One y-axis per chart: different units get separate charts.
    - Validate series colours against the dark surface.
    - Hover and focus tooltips; a table view behind a toggle.
11. **Check it.**
    - After any UI change, run `AUDIT_DIR=screenshots/wip npx playwright test e2e/audit.spec.ts` and look at the images at both widths before committing.
    - `e2e/design-system.spec.ts` and `e2e/home-layout.spec.ts` guard the shell, nav, grid and truncation rules.

## Playwright notes

- Playwright mocks the backend, Nominatim and Supabase (`e2e/support/mockApi.ts`).
- `npm run build:e2e` is needed before Playwright, which runs `next start` on port 3100 from `.next-e2e`. `NEXT_PUBLIC_*` values are fixed at build time, so the e2e build is made with the test-only addresses in `scripts/e2e-env.mjs` (Supabase = `http://127.0.0.1:3101`), never the ones in `.env.local`. The app has no test switch.
- Supabase in tests: the browser's calls are answered by `page.route` in `mockApi.ts`; the proxy's server-side session check (not interceptable) goes to `scripts/mock-supabase.mjs`, which Playwright starts. `e2e/supabase-mock.spec.ts` proves both, and a request to a real `supabase.co` host is aborted.
- Headless Chromium draws WebGL in software (SwiftShader), so lite mode's auto setting picks the CSS sky in e2e (`lib/liteMode.ts`, reason `software-renderer`). That is the CI fix. A test that needs the WebGL sky sets `localStorage['wgpt:lite-mode'] = 'off'`, as the screenshot and audit specs do.
- Settings -> "Prepare offline map" (`lib/offlineMap.ts`, dynamic import) saves basemap and terrain tiles for the demo region at zoom 6-10; `public/sw.js` serves them only when the network fails.
