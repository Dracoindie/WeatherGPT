# Demo replay: running the demo without internet

Venue Wi-Fi can fail during judging. **Demo replay** lets the backend answer the prepared demo questions from responses recorded earlier the same day, and always labels them as recorded.

- **Recorded data is never shown as live.** Every replayed response has the header `X-WeatherGPT-Replay: <recorded_at>`. Whenever one has been shown, the UI displays an amber **"Replay: recorded data from 3 Nov, 08:15"** badge on every page until reload, in all four languages.
- **Prepared questions** are answered from `backend/data/demo_fixtures/`.
- **Anything else** goes to the live services if the internet is reachable. If it isn't, chat replies (HTTP 200, in the user's language) *"Offline demo: only the prepared demo questions are available right now (no internet connection)."* Other endpoints return HTTP 503 with the same message.
- Push endpoints (`/api/push/*`, `/api/alerts/check`) are never recorded or replayed.

Code: `backend/demo_replay.py`, `backend/scripts/record_demo_fixtures.py`, `weathergpt-web/lib/replay.ts`, `weathergpt-web/components/ui/ReplayBadge.tsx`. Tests: `tests/test_demo_replay.py`, `weathergpt-web/e2e/demo-replay.spec.ts`.

## The prepared questions

Type them exactly like this. Case, spaces and trailing `?`/`।` don't matter; the words do.

| # | Question | Role | Shows |
|---|----------|------|-------|
| 1 | `Will it rain in Pune tomorrow?` | Citizen | English forecast, sky scene, AQI/UV, alerts |
| 2 | `What about Mumbai?` (right after 1) | Citizen | Follow-up: keeps "tomorrow", changes place |
| 3 | `दिल्ली में कल बारिश होगी क्या?` | Citizen | Hindi |
| 4 | `Pune mein kal baarish hogi kya?` | Citizen | Hinglish |
| 5 | `aur parso?` (right after 4) | Citizen | Hinglish follow-up: day after tomorrow |
| 6 | `पुण्यात उद्या पाऊस पडेल का?` | Citizen | Marathi |
| 7 | `Has Mumbai been wetter than normal this month?` | Researcher | Climate vs 10-year baseline |
| 8 | `What does GFS say for tomorrow in Pune?` | Researcher | GFS (NWP) summary, GFS vs Open-Meteo panel |
| 9 | `Can I spray pesticide in Nashik tomorrow?` | Farmer | Spray/irrigation/harvest panel |
| 10 | `Is it safe to fly from Nagpur today?` | Aviation | Aviation briefing |

Also recorded:
- **Alerts and 5-day forecast** for Pune, Mumbai and Chennai.
- **The `/disaster` risk board** for its 15 default Maharashtra districts.
- **The threshold table.**

Follow-ups (2 and 5) only match when asked straight after the question above them, because the previous answer's context is part of the match.

Edit `DEMO_CHAT`, `ALERT_PLACES` or `RISK_DISTRICTS` in `backend/scripts/record_demo_fixtures.py` to change the list. `RISK_DISTRICTS` must match `DEFAULT_DISTRICTS` in `weathergpt-web/app/disaster/page.tsx`.

## Morning of the demo: record fresh fixtures (needs internet)

PowerShell, from the repo root:

```powershell
$env:PYTHONIOENCODING = "utf-8"
backend\.venv\Scripts\python backend\scripts\record_demo_fixtures.py --clean
```

- It runs the app in-process (no server needed) against the live services. It sends the same requests the UI sends for each step: the chat answer, then the sky/timeline, air quality, alerts and role panels.
- It takes 1 to 3 minutes. Nominatim is limited to 1 request per second, and GFS downloads take a while.
- It ends with the number of fixture files. It also lists anything **not recorded**, for example `chat 'Has Mumbai…' -> 502` when the Open-Meteo archive is down. Run it again without `--clean` to retry; a matching fixture is overwritten and the others are kept.
- `--dry-run` prints the steps without calling anything.

**Record extra clicks:** start the backend with `$env:DEMO_RECORD = "1"` and click through the UI. Every successful answer is saved as a fixture too.

Commit the fixtures if you want them on another laptop, for example `git add backend/data/demo_fixtures; git commit -m "chore(demo): fixtures for <date>"`. They contain public weather data and the demo questions only: no keys, tokens or user data.

## Switch replay on (Windows)

Start the backend in a new PowerShell window:

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
$env:DEMO_REPLAY = "1"
uvicorn main:app --port 8000
```

The startup log says `Demo mode: replay=True record=False, N fixture(s) in …`. Then start the frontend with a production build, which is faster and the only mode with the offline service worker (`cd weathergpt-web; npm run build; npm run start`), and open `http://localhost:3000`.

**Check before the judges arrive:**
- Turn Wi-Fi off.
- Ask question 1 and confirm the amber Replay badge appears.
- Ask "Weather in Goa?" and confirm you get the offline-demo message.

## Switch replay off

Either close that PowerShell window and start the backend normally in a new one, or in the same window:

```powershell
Remove-Item Env:DEMO_REPLAY
uvicorn main:app --port 8000
```

`$env:` variables only last for that window, so a new window always starts with replay off. You can also put `DEMO_REPLAY=1` in `backend/.env`, but then remember to remove it after the demo.

## The app shell offline

The service worker (`weathergpt-web/public/sw.js`) precaches:
- `/`, `/offline`, `/dashboard`, `/alerts`, `/climate`, `/map`, `/disaster` and `/login`;
- their JS chunks;
- the manifest and icons.

So the UI opens with no internet once the site has been loaded once (open it on the demo laptop before going offline). The service worker is active in production builds (`npm run build; npm run start`) and on the deployed site.

**Limits:**
- Map tiles are cached only for the demo region, and only after "Prepare offline map" (below).
- Push needs the internet.
- The `/alerts` "type a city" search calls Nominatim from the browser, so offline it can only use the replayed chat answers. Use the chat (questions 1–10) and `/disaster` for offline alerts.

**Running everything on the laptop** (`localhost` backend and frontend) does not need Wi-Fi at all apart from the live services, and replay covers those.

## The map offline (Pune–Mumbai–Nashik)

`/map` needs two things offline: the **weather** (backend replay) and the **map tiles** (browser cache). Both cover one demo region, Pune, Mumbai and Nashik (18.2–20.2 N, 72.7–74.3 E), defined once in `backend/maps/demo.py` (`GET /api/map/demo-region`). It reaches Nashik so the recorded demo routes have their basemap offline.

**1. Record the map weather (backend, needs internet), the morning of the demo:**

```powershell
$env:PYTHONIOENCODING = "utf-8"
backend\.venv\Scripts\python backend\scripts\record_demo_fixtures.py --map          # with the chat questions
backend\.venv\Scripts\python backend\scripts\record_demo_fixtures.py --map-only     # only the map
backend\.venv\Scripts\python backend\scripts\record_demo_fixtures.py --map --routes  # plus the 3 demo routes
```

- **Weather tiles.** It saves the weather tiles (`backend/data/demo_fixtures/map_tiles/`) for every grid step used between about zoom 8 and 11 over the region: 99 tiles of 25 points, 72 hours each.
- **Tap points.** It also saves `/api/map/point` answers on a 0.25° lattice (63 points).
- **Routes (`--routes`).** Pune → Mumbai, Mumbai → Nashik and Pune → Nashik: one OSRM request each (the public demo server allows at most 1 request/s) into `demo_fixtures/routes/`, plus the weather tiles along them. Replay serves a route whose start and destination are each within 10 km of a recorded one's; other routes need the internet (`docs/ROUTES.md`).
- **Cost.** That is about 2,550 Open-Meteo location-calls, in 4-tile batches. Run it once, not in a loop (`docs/OPEN_METEO.md`).

With `DEMO_REPLAY=1`:
- **The weather layers come from the recorded tiles.** These are the temperature, humidity, wind, rain and heat surfaces, plus the hazard hexes, hazard roads and the 25 km summary. Every response carries the recording time, so the amber "Replay" badge shows.
- **A tap shows the nearest recorded point within 25 km**, with that point's own coordinates on the card. It is never relabelled as the tapped spot.
- **Outside the region, offline:** the map says "Map weather is unavailable", and a tap far from any recorded point gets the offline-demo 503.

**2. Save the map tiles (browser, needs internet), once on the demo laptop:**

- Open the site, then **Settings → Offline demo map → Prepare offline map**. It saves about 130 files (a few MB) into the browser's cache:
  - the OpenFreeMap style, sprites and fonts (Latin and Devanagari)
  - vector tiles and AWS terrain tiles for the region at zoom 6–10
  - MapLibre's worker
- It is deliberately small and polite to the free tile services: one region, 4 requests at a time, run by hand.
- **The service worker uses these files only when the network fails.** It never adds tiles while you browse.
- **Always the keyless sources.** With a MapTiler key the map falls back to them offline.

**Check before the judges arrive:**
1. Turn Wi-Fi off and open `/map`.
2. Pick Pune and zoom to 8–10: the basemap, terrain in broadcast mode, layers and hazard hexes should all draw.
3. Tap near Pune: the card shows a recorded point.
4. Zooming in past 10 shows a blank basemap. That is expected: the pack stops at zoom 10.

