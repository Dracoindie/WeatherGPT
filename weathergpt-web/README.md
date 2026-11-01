# WeatherGPT Web — Living Sky

Next.js 16 (App Router, Turbopack) · TypeScript · Tailwind 4 · three.js via
@react-three/fiber + drei · Framer Motion · react-leaflet.

The home page (`/`) is **Living Sky**: a real-time WebGL sky driven by the
backend's verified weather data, with an "Ask the Sky" console that answers in
English, हिंदी and Hinglish.

> **Rule:** the UI never invents weather numbers. Every value shown comes from
> `POST /api/chat` or `GET /api/weather` (Open-Meteo via the FastAPI backend).
> The sky scene only receives *visual* parameters derived from those values.

## Setup

1. Start the backend (from the repo root, see the root README):

   ```bash
   cd backend
   .venv/Scripts/python -m uvicorn main:app --reload --port 8000   # Windows
   # .venv/bin/python -m uvicorn main:app --reload --port 8000     # macOS/Linux
   ```

2. Configure the frontend:

   ```bash
   cp .env.local.example .env.local
   ```

   | Variable | Purpose |
   |---|---|
   | `NEXT_PUBLIC_API_BASE_URL` | FastAPI origin (default `http://localhost:8000`) |
   | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Auth (login, saved default location) |

3. Install and run:

   ```bash
   npm install
   npm run dev        # http://localhost:3000
   npm run build      # production build
   npm run lint
   ```

The backend's CORS allows `http://localhost:3000` and `http://127.0.0.1:3000`.

## Routes

| Route | Access | Notes |
|---|---|---|
| `/` | public | Living Sky console. Anonymous: name a place or use GPS. Signed in: the Supabase session token is sent so `/api/chat` can use your saved default location. |
| `/dashboard`, `/map`, `/alerts`, `/climate` | AuthGuard | Existing pages, reachable from the Living Sky nav |
| `/login`, `/signup` | public | Supabase auth |
| `/classic` | — | The former home entry (redirects to `/dashboard`) |

## Living Sky features

- **Sky engine** (`components/sky/*`): shader sky with local time of day (dawn,
  day, golden hour, night with stars and moon), fbm clouds that drift with
  wind, GPU-instanced rain with splashes, depth-of-field snow, layered fog,
  branching lightning with flash and camera shake, sun bloom and god rays,
  and heat shimmer at ≥ 35 °C. Scenes crossfade over about 1.5 s, and every
  layer has mouse parallax.
- **Scene mapping** (`lib/weatherScene.ts`): WMO `weather_code` maps to clear
  (0–1), clouds (2–3), fog (45/48), rain (51–67, 80–82), snow (71–77) and
  thunderstorm (95–99). Without a code (forecasts, hourly scrub), the scene is
  derived from precipitation, probability, wind and temperature.
- **Rain on glass** (`components/panels/RainGlass.tsx`): droplets condense,
  slide and merge on the frosted panels while it rains.
- **Panels** (`components/panels/*`): temperature arc gauge, rain liquid fill,
  wind turbine, humidity ring, location lock with source (Query/GPS/Saved),
  and a verified Open-Meteo badge. A panel appears only when the API returned
  its field.
- **Advisory**: the accent colour follows severity (cyan, amber, red). High
  severity adds a pulsing viewport frame and a HUD banner with a reasons
  ticker.
- **Forecast timeline**: 72 h temperature line and rain-probability bars.
  Drag (or use the slider or arrow keys) to preview any hour in the sky.
  **Live** returns to the answer.
- **Map**: CartoDB dark_matter tiles, a pulsing marker and a radar sweep.

### Demo mode (for judges)

Press **D**, outside any text field, to open the demo panel. You can force
clear, clouds, rain, storm, snow, fog, heatwave or night, and adjust the wind.
A **DEMO MODE · simulated sky** badge stays visible while it's active. Demo
mode changes only the sky; the data panels keep showing API values. Use
**Release → live data** to return to the real scene.

## Performance and accessibility

- DPR is capped at 1.5, and drops to 1 on mobile or when FPS declines.
  Mobile also gets fewer particles and fbm octaves.
- The render loop pauses while the tab is hidden.
- With `prefers-reduced-motion`, the sky is a static CSS gradient with no
  WebGL, shake, flashes, droplets or typewriter.
- Lightning flashes are rate-limited to at least 350 ms apart (under 3 per
  second; see `MIN_FLASH_INTERVAL_MS` in `lib/skyStore.ts`).
- Hindi text uses Noto Sans Devanagari. The typewriter splits text into
  grapheme clusters, so matras never render detached.

## Structure

```
app/page.tsx                 Living Sky (client-only via next/dynamic)
components/console/*         console, typewriter, loader, thread, nav, orchestrator
components/sky/*             R3F canvas, shaders, layers, lightning, demo panel
components/panels/*          glass panels, rain-on-glass, gauges, advisory, timeline, map
lib/api/chat.ts              typed POST /api/chat client (existing)
lib/api/weather.ts           typed GET /api/weather client
lib/weatherScene.ts          weather → scene parameters + sky palette
lib/skyStore.ts              scene store, crossfade, flash rate limit
```
