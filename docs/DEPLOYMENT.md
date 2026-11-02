# Deploying WeatherGPT (step by step, for Windows)

This guide puts WeatherGPT online with free tiers:

| Part | Where | Why |
|------|-------|-----|
| Frontend (`weathergpt-web/`, Next.js) | **Vercel** | Detects Next.js on its own; HTTPS, which push and the PWA need |
| Backend (`backend/`, FastAPI) | **Render** (or Railway) | Runs the `backend/Dockerfile` |
| Auth and database | **Supabase** | The project you already use locally |
| Alert job every 15 min | **GitHub Actions** | `.github/workflows/alert-job.yml` |
| Tests on every push | **GitHub Actions** | `.github/workflows/ci.yml` |

Allow about 45 minutes the first time. Do the steps in order: each one needs a URL or key from the step before.

> **Keep secrets out of git.** Paste keys only into the Render, Vercel, Supabase or GitHub web pages. Never into a file you commit. `backend/.env` and `weathergpt-web/.env.local` are git-ignored and stay on your PC.

---

## 0. Before you start

You need:

- [ ] A GitHub account with this repository pushed to it (`git push origin main`)
- [ ] Accounts on [vercel.com](https://vercel.com), [render.com](https://render.com) (or [railway.com](https://railway.com)) and [supabase.com](https://supabase.com). "Sign in with GitHub" is easiest.
- [ ] Your Supabase project from local development, with `supabase/schema.sql` already run. For a database that has sections 1–5 only, run `supabase/migrations_6_7.sql` in the SQL editor.
- [ ] PowerShell, opened in the repo folder (`D:\WeatherGPT`)

Keep a scratch text file (not in the repo, for example in Notepad) to collect these values as you go:

```
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
ALERT_JOB_TOKEN=
BACKEND_URL=          (step 3)
FRONTEND_URL=         (step 4)
```

## 1. Supabase keys

1. Supabase dashboard → your project → **Project Settings → API**.
2. Copy:
   - **Project URL** → `SUPABASE_URL`
   - **anon public** key → `SUPABASE_ANON_KEY`
   - **service_role** key → `SUPABASE_SERVICE_ROLE_KEY`. This one bypasses RLS. It goes **only** on the backend host, never in Vercel and never in a `NEXT_PUBLIC_` variable.

You will set the auth URLs in step 5, once you know the Vercel address.

## 2. Production keys for push and the alert job

Make a **new** pair for production. Don't reuse your local one. Keep this pair for good: if it changes, every phone has to subscribe again.

```powershell
# VAPID keys (prints two lines; copy both into your scratch file)
backend\.venv\Scripts\python -c "import base64; from cryptography.hazmat.primitives.asymmetric import ec; from cryptography.hazmat.primitives import serialization as s; k = ec.generate_private_key(ec.SECP256R1()); b = lambda x: base64.urlsafe_b64encode(x).rstrip(b'=').decode(); print('VAPID_PUBLIC_KEY=' + b(k.public_key().public_bytes(s.Encoding.X962, s.PublicFormat.UncompressedPoint))); print('VAPID_PRIVATE_KEY=' + b(k.private_numbers().private_value.to_bytes(32, 'big')))"

# Alert job token (a long random string)
backend\.venv\Scripts\python -c "import secrets; print('ALERT_JOB_TOKEN=' + secrets.token_urlsafe(32))"
```

`VAPID_SUBJECT` is a contact address for the push services, for example `mailto:you@example.com`.

If you use the Render Blueprint (step 3A), Render can generate `ALERT_JOB_TOKEN` for you. Then copy it from Render instead.

## 3. Backend on Render

### 3A. Blueprint (recommended): `render.yaml` sets it up

1. Render dashboard → **New → Blueprint** → connect GitHub → pick this repository.
2. Render reads `render.yaml`. It creates one web service, `weathergpt-api`: Docker, root `backend/`, health check `/health`, Singapore region.
3. Render asks for each `sync: false` value. Paste:

   | Key | Value |
   |-----|-------|
   | `ALLOWED_ORIGINS` | Put `https://placeholder.vercel.app` for now. You fix it in step 4. |
   | `SUPABASE_URL` | from step 1 |
   | `SUPABASE_ANON_KEY` | from step 1 |
   | `SUPABASE_SERVICE_ROLE_KEY` | from step 1 |
   | `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | from step 2 |
   | `VAPID_SUBJECT` | `mailto:you@example.com` |

   `ALERT_JOB_TOKEN` is generated, and `LLM_PROVIDER` is `none`, so replies use the templates.
4. Click **Apply**. The first build takes about 5–8 minutes.
5. When it shows **Live**, copy the URL (like `https://weathergpt-api.onrender.com`) into `BACKEND_URL`. Open `BACKEND_URL/health` in a browser. You should see:

   ```json
   {"status":"ok","service":"WeatherGPT API","nwp":true}
   ```

### 3B. Manual setup (if you'd rather not use the Blueprint)

**New → Web Service** → this repo, then:

- **Language:** Docker
- **Root Directory:** `backend`
- **Dockerfile path:** `./Dockerfile`
- **Health Check Path:** `/health`

Add the environment variables from the table above, plus `ALERT_JOB_TOKEN` from step 2 and `WITH_NWP=1`.

### GFS (NWP) or not: `WITH_NWP`

| `WITH_NWP` | Image | What works |
|------------|-------|------------|
| `1` (default) | about 760 MB | Everything, including "What does GFS say…" and the researcher comparison |
| `0` | about 300 MB | Everything except GFS: `/api/nwp` and `/api/compare` return a clean 503, and `/health` shows `"nwp": false` |

Render's free plan has 512 MB of RAM. Decoding GFS can use a lot of it. If the service restarts when you ask a GFS question, either set `WITH_NWP=0` and redeploy (**Manual Deploy → Clear build cache & deploy**), or move to the Starter plan. Render passes environment variables to `docker build` as build arguments. If yours does not, change `ARG WITH_NWP=1` in `backend/Dockerfile` to `0` and push.

### What the container runs

```
uvicorn main:app --host 0.0.0.0 --port $PORT --workers 1 --proxy-headers --forwarded-allow-ips='*'
```

- **One worker, on purpose.** The test-push limit (1 per user per minute) and the Nominatim 1 request/second spacing live in process memory. With more workers each one has its own limit; see `docs/EARLY_WARNING.md`. Also keep **instances = 1**.
- **Free plans sleep** after about 15 minutes idle. The first request then takes up to a minute. The alert job wakes the service before it calls it.
- **Geocode cache.** `backend/data/geocode_cache.json` lives in the container and is lost on each deploy. It refills on its own (the first `/disaster` load is about 15 s, then instant).

### Railway instead of Render

1. **New Project → Deploy from GitHub repo** → this repo.
2. Service **Settings → Root Directory:** `backend`. Railway then reads `backend/railway.json`: Dockerfile build, `/health`, 1 replica.
3. **Variables:** the same keys as the table above, plus `ALERT_JOB_TOKEN` and `WITH_NWP`.
4. **Settings → Networking → Generate Domain.** That URL is your `BACKEND_URL`.

## 4. Frontend on Vercel

1. Vercel → **Add New → Project** → import this repository.
2. **Root Directory:** click **Edit** and choose `weathergpt-web`. This is the only setting to change. Vercel detects Next.js and fills in the build command (`next build`), the output directory and the install command (`npm install`). Leave them as they are.
3. **Environment Variables.** These three are all Vercel needs:

   | Name | Value |
   |------|-------|
   | `NEXT_PUBLIC_SUPABASE_URL` | the same value as `SUPABASE_URL` |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the same value as `SUPABASE_ANON_KEY` |
   | `NEXT_PUBLIC_API_BASE_URL` | `BACKEND_URL`, with no trailing slash |

   **Do not add** `SUPABASE_SERVICE_ROLE_KEY`, `VAPID_PRIVATE_KEY` or `ALERT_JOB_TOKEN` to Vercel. The browser never needs them. The VAPID *public* key comes from the backend (`/api/push/config`), so Vercel doesn't need it either.
4. Click **Deploy** (about 2 minutes). Copy the production URL (like `https://weathergpt.vercel.app`) into `FRONTEND_URL`.
5. Back in Render (or Railway), set the backend's `ALLOWED_ORIGINS` to `FRONTEND_URL` and save. It redeploys. More than one origin? Separate them with commas and no spaces:

   ```
   https://weathergpt.vercel.app,https://weathergpt-git-main-yourname.vercel.app
   ```

   Without this, the browser blocks every API call (a CORS error in the console).

`NEXT_PUBLIC_*` values are baked in at build time. If you change one in Vercel, use **Deployments → ⋯ → Redeploy**.

## 5. Supabase auth URLs

Supabase → **Authentication → URL Configuration**:

- **Site URL:** `FRONTEND_URL` (for example `https://weathergpt.vercel.app`). Sign-up confirmation emails link here.
- **Redirect URLs.** Add each of these:
  - `https://weathergpt.vercel.app/**` (your `FRONTEND_URL` followed by `/**`)
  - `http://localhost:3000/**`, so local development keeps working
  - optional, for Vercel preview deployments: `https://*-yourname.vercel.app/**`

Save. Sign up on the live site once to check that the confirmation email opens the live site, not `localhost`.

## 6. GitHub: CI and the alert job

### CI (`.github/workflows/ci.yml`)

There is nothing to set up. It runs on every push and pull request. Each job uses placeholders only and mocks everything:

- **Backend tests:** pytest
- **Frontend:** eslint, `next build`, then the Playwright e2e suite (Chromium)

See it under the repo's **Actions** tab. The Playwright traces of a failed run are attached as an artifact.

### Alert job (`.github/workflows/alert-job.yml`)

Every 15 minutes this job calls `POST BACKEND_URL/api/alerts/check` with the token. Until both values below exist, it **skips itself** and passes, so it is safe to have in the repo before deployment.

1. GitHub repo → **Settings → Secrets and variables → Actions**.
2. **Secrets** tab → **New repository secret**: name `ALERT_JOB_TOKEN`, value exactly the backend's `ALERT_JOB_TOKEN`. On Render with the Blueprint, copy it from the service's **Environment** page.
3. **Variables** tab → **New repository variable**: name `BACKEND_URL`, value `BACKEND_URL` (no trailing slash).
4. **Actions → Alert job → Run workflow** to try it now. The log should show `HTTP 200` and counts such as `{"checked":0,"became_high":0,"sent":0,…}`. Subscription ids are never printed.

Notes:

- GitHub can start scheduled runs a few minutes late. In a repo with no commits for 60 days, it pauses schedules; re-enable them from the Actions tab.
- A **401** means the two tokens differ. A **503** means the backend is missing `ALERT_JOB_TOKEN` or the Supabase service-role key.

## 7. Smoke test after deploying

Run these in PowerShell. Replace the two URLs first.

```powershell
$api = "https://weathergpt-api.onrender.com"   # BACKEND_URL
$web = "https://weathergpt.vercel.app"          # FRONTEND_URL

# 1. Health: status ok; nwp true (or false with WITH_NWP=0)
Invoke-RestMethod "$api/health"

# 2. Chat: an English reply with real numbers for Pune
$body = @{ message = "Will it rain in Pune tomorrow?" } | ConvertTo-Json
(Invoke-RestMethod "$api/api/chat" -Method Post -ContentType "application/json" -Body $body).message

# 3. Alerts: a list (may be empty) and the note "Generated by WeatherGPT, not official IMD warnings"
Invoke-RestMethod "$api/api/alerts?latitude=18.52&longitude=73.86" | Select-Object note

# 4. Push config: available = True means the VAPID keys and pywebpush are set up
Invoke-RestMethod "$api/api/push/config"

# 5. CORS: the response must name your Vercel origin
(Invoke-WebRequest "$api/health" -Headers @{ Origin = $web } -UseBasicParsing).Headers["Access-Control-Allow-Origin"]

# 6. GFS (only with WITH_NWP=1; the first call can take 20-60 s)
Invoke-RestMethod "$api/api/nwp?latitude=18.52&longitude=73.86&hours=12" | Select-Object -First 1
```

Then, in the browser:

- [ ] **Home:** open `FRONTEND_URL` and ask "Will it rain in Pune tomorrow?". The sky scene and an answer appear. Try हिं and मरा as well.
- [ ] **Risk board:** `/disaster` fills in district by district. The first time this takes about 15 s.
- [ ] **Sign up / sign in:** the confirmation email opens the live site (step 5).
- [ ] **Push test:**
  1. Sign in, open **Alerts**, pick a place, then tap **Alert me** and allow notifications.
  2. Tap **Send test alert**. A notification saying "TEST: WeatherGPT demo alert, not an official IMD warning" appears.
  3. A second tap within a minute says "One test per minute".
- [ ] **Install on a phone (PWA):**
  - Android Chrome: open `FRONTEND_URL` → ⋮ → **Add to Home screen** / **Install app**.
  - iPhone Safari: **Share → Add to Home Screen**. On iOS, Web Push works only from the installed app (iOS 16.4+).

  Open it from the home screen; it starts full-screen. Turn on airplane mode and reopen it: the last forecast still shows (the offline page otherwise).
- [ ] **Alert job:** after 15 minutes, **Actions → Alert job** shows a green run with `HTTP 200`.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Browser console: "blocked by CORS policy" | `ALLOWED_ORIGINS` doesn't match the exact Vercel URL | Set it to `https://…vercel.app` with no trailing slash, then redeploy the backend |
| Frontend says it can't reach the backend | Wrong `NEXT_PUBLIC_API_BASE_URL`, or the backend is asleep | Check `BACKEND_URL/health`; fix the variable in Vercel and **Redeploy** |
| Sign-up email opens `localhost` | Supabase Site URL not updated | Step 5 |
| `/api/push/config` says `available: false` | VAPID keys missing on the backend | Step 2 values in Render |
| The service restarts on GFS questions | Out of memory on 512 MB | `WITH_NWP=0`, or a bigger plan |
| Alert job: HTTP 401 | GitHub secret ≠ backend token | Copy the backend value into the secret again |
| Backend log: "only NEXT_PUBLIC_ Supabase names are set" | Frontend variable names used on the backend | Use `SUPABASE_URL` / `SUPABASE_ANON_KEY` on the backend |

## Run the production image on your PC (optional)

With Docker Desktop:

```powershell
docker build -t weathergpt-api backend                         # with GFS
docker build -t weathergpt-api-lite --build-arg WITH_NWP=0 backend
docker run --rm -p 8000:8000 --env-file backend\.env weathergpt-api
# then open http://localhost:8000/health
```

`.dockerignore` keeps `.venv`, `.env` files and local data out of the image. Secrets reach the container only through `--env-file` or the host's variables.
