# Deploying WeatherGPT: click-by-click checklist

Free tiers, in this order (each step needs a value from the one before):

| Part | Where | Notes |
|------|-------|-------|
| Backend (`backend/`, FastAPI) | **Render** web service (Docker) | `render.yaml` Blueprint; Railway works too (`backend/railway.json`) |
| Frontend (`weathergpt-web/`, Next.js) | **Vercel** | HTTPS, which Web Push and the PWA need |
| Auth and database | **Supabase** | `supabase/schema.sql` (or `migrations_6_7.sql` on a 1–5 database) |
| Alert job every 15 min | **GitHub Actions** | `.github/workflows/alert-job.yml` |
| Tests and the backend images | **GitHub Actions** | `.github/workflows/ci.yml` |

About 45 minutes the first time.

> **Secrets stay out of git.** Paste keys only into the Render, Vercel, Supabase and GitHub web pages. `backend/.env` and `weathergpt-web/.env.local` are git-ignored and stay on your PC. `SUPABASE_SERVICE_ROLE_KEY`, `VAPID_PRIVATE_KEY`, `ALERT_JOB_TOKEN` and `OPEN_METEO_API_KEY` go **only** on the backend host, never in Vercel and never in a `NEXT_PUBLIC_*` variable.

> **The images are validated by CI, not by a local Docker build.** The `docker` job in `.github/workflows/ci.yml` builds `backend/Dockerfile` on every push, once with `WITH_NWP=1` and once with `WITH_NWP=0`. It starts each image, checks `GET /health` (`status: ok`, and `nwp` true for the full image, false for the lite one), and waits for the container's own HEALTHCHECK to report `healthy`. Before deploying, check that the latest push has a green **CI** run in the **Actions** tab, including both "Backend image" jobs.

---

## Every environment variable

**Where:** R = Render (backend), V = Vercel (frontend), G = GitHub Actions. "Secret" means backend or GitHub only, never in the browser.

| Variable | Where | Required? | Example | What it does |
|---|---|---|---|---|
| `ALLOWED_ORIGINS` | R | **required** | `https://weathergpt.vercel.app` | Browser origins allowed by CORS, comma-separated, no spaces, no trailing slash. Default (empty): localhost only. |
| `SUPABASE_URL` | R | **required** | `https://abcd1234.supabase.co` | Same project as the frontend. Trusted default location, test push. |
| `SUPABASE_ANON_KEY` | R | **required** | `eyJhbGciOi…` | Public anon key (RLS applies). |
| `SUPABASE_SERVICE_ROLE_KEY` | R | required for push alerts (**secret**) | `eyJhbGciOi…` | Bypasses RLS; only the alert job uses it (`dissemination/store.py`). |
| `VAPID_PUBLIC_KEY` | R | required for push | `BOr1…` (87 chars) | Served to browsers by `GET /api/push/config`. |
| `VAPID_PRIVATE_KEY` | R | required for push (**secret**) | `xY9…` (43 chars) | Signs Web Push messages. Keep the pair forever: a new pair means every phone subscribes again. |
| `VAPID_SUBJECT` | R | required for push | `mailto:you@example.com` | Contact for the push services. |
| `ALERT_JOB_TOKEN` | R and G (secret) | required for the alert job (**secret**) | 43 random characters | Guards `POST /api/alerts/check` (`X-Job-Token`). The Blueprint generates it. |
| `WITH_NWP` | R (build arg) | optional, default `1` | `1` or `0` | `1`: GFS included (about 760 MB image). `0`: lite image (about 300 MB), `/api/nwp` and `/api/compare` answer a clean 503. |
| `OPEN_METEO_API_KEY` | R | optional (**secret**) | (from Open-Meteo) | Empty: free endpoints, **non-commercial only**, 10,000 calls a day. Set: the commercial `customer-` hosts. `/health` shows `"open_meteo": "free (non-commercial)"` or `"commercial"`, never the key. `docs/OPEN_METEO.md` |
| `ROUTING_URL` | R | optional | `https://osrm.example.org` | OSRM for `/map` routes. Empty: the public OSRM demo server (no uptime guarantee, 1 request/s). `docs/ROUTES.md` |
| `GEOCODE_CACHE_PATH` | R | optional | `/app/data/geocode_cache.json` | Nominatim results kept for 30 days. Default `backend/data/geocode_cache.json`; an empty string turns the file off. See "Caches on the host". |
| `LLM_PROVIDER` | R | optional, Blueprint sets `none` | `none`, `gemini`, `groq`, `openai` | `none`: template replies. An LLM only rewords, and every number must pass the grounding check. |
| `GEMINI_API_KEY` / `GROQ_API_KEY` / `OPENAI_API_KEY` / `GOOGLE_API_KEY` | R | only with an LLM (**secret**) | — | Provider key. |
| `LLM_MODEL`, `LLM_API_KEY` | R | optional | — | Overrides for the LLM provider. |
| `DEMO_REPLAY` | R | optional, **leave unset** in production | `1` | Serves recorded demo fixtures when the internet is down (`docs/DEMO.md`). For offline judging on a laptop, not for the public site. |
| `PORT` | R | set by Render | `10000` | The container listens on `$PORT`. |
| `NEXT_PUBLIC_SUPABASE_URL` | V | **required** | `https://abcd1234.supabase.co` | Same value as `SUPABASE_URL`. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | V | **required** | `eyJhbGciOi…` | Same value as `SUPABASE_ANON_KEY`. |
| `NEXT_PUBLIC_API_BASE_URL` | V | **required** | `https://weathergpt-api.onrender.com` | The backend URL, no trailing slash. |
| `NEXT_PUBLIC_MAPTILER_KEY` | V | optional | (from MapTiler) | MapTiler basemap and terrain for `/map`. A public browser key by design: **restrict it to your domains** in the MapTiler dashboard. Empty, or refused (401/403/429): the keyless OpenFreeMap and AWS terrain tiles. |
| `BACKEND_URL` | G (variable) | required for the alert job | `https://weathergpt-api.onrender.com` | Where the alert job posts. |

`NEXT_PUBLIC_*` values are baked in at build time: after changing one in Vercel, **Redeploy**.

---

## 0. Before you start

- [ ] The repository is on GitHub, and the latest push has a green **CI** run (backend tests, frontend e2e, and both "Backend image" jobs).
- [ ] Accounts on vercel.com, render.com and supabase.com ("Sign in with GitHub" is easiest).
- [ ] The Supabase project has `supabase/schema.sql` run (or `supabase/migrations_6_7.sql` on a database that already has sections 1–5).
- [ ] A scratch text file outside the repo for the values you collect:

```
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
ALERT_JOB_TOKEN=      (step 3, from Render)
BACKEND_URL=          (step 3)
FRONTEND_URL=         (step 4)
```

## 1. Supabase keys

1. [ ] supabase.com → your project → **Project Settings** → **API**.
2. [ ] Copy **Project URL** → `SUPABASE_URL`.
3. [ ] Copy the **anon public** key → `SUPABASE_ANON_KEY`.
4. [ ] Copy the **service_role** key → `SUPABASE_SERVICE_ROLE_KEY` (backend only).

## 2. Production push keys

Make a **new** VAPID pair for production, in PowerShell in the repo folder:

```powershell
backend\.venv\Scripts\python -c "import base64; from cryptography.hazmat.primitives.asymmetric import ec; from cryptography.hazmat.primitives import serialization as s; k = ec.generate_private_key(ec.SECP256R1()); b = lambda x: base64.urlsafe_b64encode(x).rstrip(b'=').decode(); print('VAPID_PUBLIC_KEY=' + b(k.public_key().public_bytes(s.Encoding.X962, s.PublicFormat.UncompressedPoint))); print('VAPID_PRIVATE_KEY=' + b(k.private_numbers().private_value.to_bytes(32, 'big')))"
```

- [ ] Copy both lines into the scratch file.

## 3. Backend on Render

1. [ ] render.com → **New** → **Blueprint**.
2. [ ] **Connect GitHub** → pick this repository → **Connect**.
3. [ ] Render reads `render.yaml` and shows one service, **weathergpt-api** (Docker, root `backend/`, health check `/health`, region Singapore, plan Free).
4. [ ] Fill each value Render asks for:

   | Key | Value |
   |-----|-------|
   | `ALLOWED_ORIGINS` | `https://placeholder.vercel.app` for now (fixed in step 4) |
   | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | from step 1 |
   | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | from step 2 |
   | `VAPID_SUBJECT` | `mailto:you@example.com` |

   `ALERT_JOB_TOKEN` is generated, `LLM_PROVIDER` is `none`, `WITH_NWP` is `1`.
5. [ ] Click **Apply**. The first build takes about 5–8 minutes.
6. [ ] Optional variables (`OPEN_METEO_API_KEY`, `ROUTING_URL`, `NEXT_PUBLIC_*` do **not** belong here): service → **Environment** → **Add Environment Variable** → **Save Changes**.
7. [ ] When the service shows **Live**, copy its URL (like `https://weathergpt-api.onrender.com`) → `BACKEND_URL`.
8. [ ] Service → **Environment** → reveal `ALERT_JOB_TOKEN` → copy it into the scratch file.
9. [ ] Open `BACKEND_URL/health` in a browser. Expect:

   ```json
   {"status":"ok","service":"WeatherGPT API","nwp":true,"open_meteo":"free (non-commercial)"}
   ```

**Manual service instead of the Blueprint:** **New** → **Web Service** → this repo → **Language** Docker, **Root Directory** `backend`, **Dockerfile Path** `./Dockerfile`, **Health Check Path** `/health`, **Instance Type** Free; add every R variable from the table, including `ALERT_JOB_TOKEN` (generate one with `python -c "import secrets; print(secrets.token_urlsafe(32))"`) and `WITH_NWP`.

**Railway instead of Render:** **New Project** → **Deploy from GitHub repo** → service **Settings** → **Root Directory** `backend` (Railway reads `backend/railway.json`: Dockerfile, `/health`, 1 replica) → **Variables**: the R rows → **Settings** → **Networking** → **Generate Domain** → that is `BACKEND_URL`.

What the container runs: `uvicorn main:app --workers 1 --proxy-headers`. **Keep one worker and one instance**: the push-test limit (1 per user per minute), the Nominatim 1 request/s spacing, the OSRM spacing, the in-flight request sharing and every cache live in process memory.

## 4. Frontend on Vercel

1. [ ] vercel.com → **Add New…** → **Project** → **Import** this repository.
2. [ ] **Root Directory** → **Edit** → `weathergpt-web` → **Continue**. Leave the framework (Next.js), build and install commands as detected.
3. [ ] **Environment Variables**: add `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_API_BASE_URL` (= `BACKEND_URL`), and optionally `NEXT_PUBLIC_MAPTILER_KEY`. Nothing else: no service-role key, VAPID private key, job token or Open-Meteo key.
4. [ ] **Deploy** (about 2 minutes). Copy the production URL → `FRONTEND_URL`.
5. [ ] Back in Render → **weathergpt-api** → **Environment** → `ALLOWED_ORIGINS` = `FRONTEND_URL` → **Save Changes** (it redeploys). Several origins: `https://weathergpt.vercel.app,https://weathergpt-git-main-you.vercel.app`.
6. [ ] With a MapTiler key: MapTiler dashboard → the key → **Allowed HTTP origins** → add `FRONTEND_URL`.

## 5. Supabase auth URLs

1. [ ] Supabase → **Authentication** → **URL Configuration**.
2. [ ] **Site URL** = `FRONTEND_URL`.
3. [ ] **Redirect URLs** → **Add URL**: `FRONTEND_URL/**`, `http://localhost:3000/**`, and optionally `https://*-you.vercel.app/**` for previews → **Save**.
4. [ ] Sign up once on the live site: the confirmation email must open the live site, not localhost.

## 6. GitHub: the alert job

1. [ ] GitHub repo → **Settings** → **Secrets and variables** → **Actions**.
2. [ ] **Secrets** tab → **New repository secret** → `ALERT_JOB_TOKEN` = the Render value.
3. [ ] **Variables** tab → **New repository variable** → `BACKEND_URL` = `BACKEND_URL` (no trailing slash).
4. [ ] **Actions** → **Alert job** → **Run workflow**. The log shows `HTTP 200` and counts such as `{"checked":0,"became_high":0,"sent":0,…}` (never subscription ids).

Until both exist the job skips itself and passes. A **401** means the tokens differ; a **503** means the backend lacks `ALERT_JOB_TOKEN` or the service-role key.

## 7. Smoke test

```powershell
$api = "https://weathergpt-api.onrender.com"   # BACKEND_URL
$web = "https://weathergpt.vercel.app"          # FRONTEND_URL

Invoke-RestMethod "$api/health"                                              # status ok, nwp, open_meteo plan
$body = @{ message = "Will it rain in Pune tomorrow?" } | ConvertTo-Json
(Invoke-RestMethod "$api/api/chat" -Method Post -ContentType "application/json" -Body $body).message
Invoke-RestMethod "$api/api/alerts?latitude=18.52&longitude=73.86" | Select-Object note   # "Generated by WeatherGPT, not official IMD warnings"
Invoke-RestMethod "$api/api/push/config"                                     # available = True
(Invoke-WebRequest "$api/health" -Headers @{ Origin = $web } -UseBasicParsing).Headers["Access-Control-Allow-Origin"]   # your Vercel origin
Invoke-RestMethod "$api/api/forecast?latitude=18.52&longitude=73.86" | Select-Object -ExpandProperty daily | Measure-Object   # Count 7
Invoke-RestMethod "$api/api/nwp?latitude=18.52&longitude=73.86&hours=12" | Select-Object stale -First 1   # WITH_NWP=1 only; first call 20-60 s
```

In the browser:

- [ ] **Home:** ask "Will it rain in Pune tomorrow?"; try हिं and मरा.
- [ ] **Map:** `/map` → **Use my location**. Real basemap tiles, the temperature surface under the labels, "Model grid ≈ 8 km · estimated · not official IMD". Zoomed all the way out it says "Zoom in to see the weather layers." **Broadcast mode** tilts into 3D terrain and stays on your place. **Route** Pune → Mumbai shows the coloured line and the report.
- [ ] **Risk board:** `/disaster` fills district by district (about 15 s the first time) on a real basemap.
- [ ] **Sign up / sign in**, then the **push test** (Alerts → Alert me → Send test alert).
- [ ] **PWA:** install from Chrome (⋮ → Install app) or Safari (Share → Add to Home Screen); in airplane mode the last forecast still shows.
- [ ] **Alert job:** a green run with `HTTP 200` after 15 minutes.

---

## Coverage of the newer features

| Feature | Backend | Frontend | CORS / CSP / workers | Notes |
|---|---|---|---|---|
| `/map` weather layers, tap card, broadcast | `/api/map/grid`, `/api/map/point` | MapLibre GL 5 + deck.gl | browser fetches tiles from `tiles.openfreemap.org` (basemap), `s3.amazonaws.com/elevation-tiles-prod` (terrain), `api.maptiler.com` (with the key); MapLibre's worker is a same-origin file `/vendor/maplibre-gl-worker.js` | the worker is copied by `scripts/copy-maplibre-worker.mjs` in `prebuild`, so Vercel's `next build` produces it |
| Hazard map | `/api/map/hazard`, `/hazard/summary` | H3 hexes | API only | shares the tiles cache |
| Routes | `/api/route` → OSRM (`ROUTING_URL`) | route panel | API only (OSRM is called by the backend) | 6 h route cache in memory |
| Push alerts | `/api/push/*`, `/api/alerts/check` | service worker | `public/sw.js` same origin | job via GitHub Actions |
| Demo replay | `DEMO_REPLAY=1` | replay banner | header `X-WeatherGPT-Replay` is exposed by CORS | leave off in production |
| Open-Meteo key | `OPEN_METEO_API_KEY` | — | — | `/health` shows the plan |
| MapTiler | — | `NEXT_PUBLIC_MAPTILER_KEY` | `api.maptiler.com` | restrict the key by origin |
| Location search | `/api/geocode` (Nominatim, cached) | `LocationPicker` and reverse geocoding call `nominatim.openstreetmap.org` directly from the browser | — | 1 request/s per user |
| GFS | `/api/nwp` (1 h cache, stale up to 24 h, clean 503) | GFS panel | — | `WITH_NWP=1` only |

**CORS.** Every browser call to the backend needs the exact Vercel origin in `ALLOWED_ORIGINS`. Map tiles, terrain and Nominatim are third-party hosts that send their own CORS headers; nothing to configure.

**CSP.** The app sets **no Content-Security-Policy** today (`next.config.ts` has no `headers()`), so nothing blocks tiles or workers. If you add one, it must allow at least:

```
default-src 'self';
script-src 'self' 'unsafe-inline';               (Next.js inline bootstrap; or nonces)
worker-src 'self' blob:;                          (MapLibre worker file, the service worker)
connect-src 'self' BACKEND_URL https://*.supabase.co https://tiles.openfreemap.org https://s3.amazonaws.com https://api.maptiler.com https://nominatim.openstreetmap.org;
img-src 'self' data: blob: https://tiles.openfreemap.org https://s3.amazonaws.com https://api.maptiler.com;
style-src 'self' 'unsafe-inline';
font-src 'self' data: https://tiles.openfreemap.org https://api.maptiler.com;   (map label glyphs)
```

Test any CSP with `npx playwright test` and on the live site before shipping it: a blocked worker or tile host shows an empty map, not an error page.

## Caches on the host

| Cache | Where | Lifetime | On a free Render instance |
|---|---|---|---|
| Geocoding (Nominatim) | memory + JSON file (`GEOCODE_CACHE_PATH`) | 24 h in memory, 30 days in the file | The filesystem is **ephemeral**: the file is lost on every deploy and every restart (including wake-ups after sleep). It refills on demand; the first `/disaster` load takes about 15 s again. For a persistent file, a paid instance with a Render **Disk** mounted at `/app/data`. |
| Routes (OSRM) | memory | 6 h | Lost on restart; the next route asks OSRM again. |
| Map tiles | memory, shared by all users | 15 min, 400 tiles | Lost on restart. |
| Map points | memory | 10 min | Lost on restart. |
| GFS | memory | 1 h fresh, served stale up to 24 h when NOMADS fails | Lost on restart; the first GFS call after a wake-up takes 20–60 s. |
| Alerts | memory | last good answer for stale serving | Lost on restart. |
| Frontend | the browser's service worker | last forecast; prepared offline map pack | Per device; unaffected by the backend. |

## What breaks on free tiers, and what to do

Limits below are the ones documented in this repo or commonly published by each provider; **check each provider's pricing page before relying on them**, they change.

| Risk | What happens | What to do |
|---|---|---|
| **Render free instance sleeps** after about 15 minutes without traffic | The first request after a sleep takes up to about a minute; every in-memory cache is empty again | The alert job wakes it every 15 minutes (`curl …/health` with retries). Before a demo, open `BACKEND_URL/health` a minute early. A paid instance does not sleep. |
| **512 MB RAM** on Render free | GFS decoding (cfgrib) can push the process over and restart it | `WITH_NWP=0` (lite image; GFS answers a clean 503 and the UI says "GFS model temporarily unavailable"), or the Starter plan. CI builds and starts both images, so either is safe to deploy. |
| **Ephemeral disk** | Geocode cache file lost on deploy/restart | Expected; it refills. A Render Disk needs a paid instance. |
| **Open-Meteo free tier**: non-commercial use only, 600 calls/minute, 5,000/hour, 10,000/day; a request for N points counts as N | One busy map session can hit HTTP 429 (seen on 2026-11-05); cloud hosts share outgoing IPs, so other tenants can use the same budget | Already handled: retry with backoff honouring `Retry-After` up to 5 s, then the cache, stale data or a clean 503; one call per identical request in flight; shared map tiles; the map skips requests inside the loaded grid and when zoomed out (`docs/OPEN_METEO.md`). For anything commercial or busy, set `OPEN_METEO_API_KEY`. |
| **Nominatim** fair use: at most 1 request/s, identifying User-Agent, no heavy use | Bursts get throttled or the IP blocked | The backend spaces requests to 1/s and caches 24 h + 30 days; keep one worker. The browser's location search is per user. |
| **OSRM public demo server**: no uptime guarantee, 1 request/s | Routes fail ("try again in a minute") | Set `ROUTING_URL` to your own OSRM for anything beyond a demo (`docs/ROUTES.md`). |
| **Supabase free project pauses** after a period of inactivity (about a week) | Sign-in, profiles and push subscriptions stop until you restore it | Open the dashboard before a demo and **Restore** if paused; keep some activity. |
| **Supabase built-in email** is rate-limited (a few auth emails per hour) | Sign-up confirmations stop arriving during a busy demo | Use the demo session (no email), or configure custom SMTP under Authentication → Emails. |
| **GitHub Actions schedules** run late (minutes) and pause after 60 days without commits | Push alerts arrive late; the job stops | Re-enable from the Actions tab. In a **private** repo, a run every 15 minutes uses about 2,900 runner-minutes a month, more than the free private allowance; public repos are not billed. |
| **Vercel Hobby** is for non-commercial use | — | Fine for SIH; a team plan for anything commercial. |
| **First visit after a backend deploy** | `/disaster` and routes are slower while caches refill | Warm up: open `/disaster` and one route before the audience arrives. |

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| "blocked by CORS policy" in the browser console | `ALLOWED_ORIGINS` doesn't match the exact Vercel URL | Set it exactly (no trailing slash) and save; Render redeploys |
| Frontend can't reach the backend | Wrong `NEXT_PUBLIC_API_BASE_URL`, or the backend is asleep | Open `BACKEND_URL/health`; fix the variable and **Redeploy** in Vercel |
| Map is empty (no basemap) | Tile host blocked (a CSP you added, a network filter) or MapTiler refused the key and the fallback also failed | Browser console; check the CSP list above; remove the MapTiler key to force the keyless tiles |
| "Zoom in to see the weather layers." | The view is larger than the map grid allows | Zoom in; this is expected when zoomed out |
| Sign-up email opens `localhost` | Supabase Site URL not updated | Step 5 |
| `/api/push/config` → `available: false` | VAPID keys missing on the backend | Step 2 values in Render |
| Service restarts on GFS questions | Out of memory on 512 MB | `WITH_NWP=0`, or a bigger plan |
| Alert job HTTP 401 | GitHub secret ≠ backend token | Copy the Render value into the secret again |
| Backend log: "only NEXT_PUBLIC_ Supabase names are set" | Frontend names used on the backend | Use `SUPABASE_URL` / `SUPABASE_ANON_KEY` on Render |
| Route or map weather unavailable (with a **Retry** button) | OSRM demo server busy, or the Open-Meteo minute limit (`docker logs` / Render log: `HTTP 429`) | Press **Retry** when its countdown ends (it waits 2 s, then 4, 8 … up to 30 s); set `ROUTING_URL` / `OPEN_METEO_API_KEY` for production |
