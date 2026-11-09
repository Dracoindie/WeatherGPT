# Backend (`backend/`, Python 3.11, FastAPI, Pydantic v2, httpx)

Loaded when working under `backend/`. The ground rules in the root `CLAUDE.md` always apply.

| Path | What it does |
|------|--------------|
| `main.py` | App, CORS (`ALLOWED_ORIGINS`), routers, `/health`, `/api/weather`. `/api/nwp` is skipped with a 503 stub if cfgrib or ecCodes is missing. |
| `api/chat.py` | `POST /api/chat`: parse → follow-up context → resolve location → route by intent (forecast / climate / nwp) → facts → advisory → reply + role note |
| `llm/query_parser.py` | Intent, place, date, parameter, language and climate period. An optional LLM parser, with a deterministic fallback (the benchmark measures the fallback). |
| `llm/follow_up.py` | Fills missing slots from `ChatRequest.context` ("aur parso?", "what about Mumbai?") |
| `llm/response_generator.py` | Templates in 4 languages, the grounding check, `ask_for_location`, `unknown_location`, `geocoder_unavailable` |
| `llm/source_replies.py` | Climate and GFS reply templates |
| `llm/weather_codes.py` | WMO code descriptions in hi / hinglish / mr |
| `llm/provider.py` | `LLM_PROVIDER` = gemini, groq, openai or none |
| `query_service.py` | Open-Meteo to `WeatherFacts`: period windows in the location's local time, `focus_facts` per parameter, English `WMO_DESCRIPTIONS` |
| `weather/open_meteo.py` | Forecast client (current + 7-day hourly) |
| `geocoding.py` | Nominatim search and reverse, TTL cache and rate limit. Raises `RuntimeError` when the service is down; returns `None` for an unknown place. |
| `thresholds.py` | **The one table of hazard thresholds and levels** (none < advisory < watch < warning < severe; rain, heat incl. heat stress, wind, storm, cold). Engine, hazard map, chat advisories, risk board, push, CAP and `GET /api/alerts/thresholds` all read it. |
| `alerts/scoring.py` | **The one scorer**: a 24 h window -> highest firing rule per hazard. The alert engine (alerts, risk board, push, CAP) and the hazard map both call it; `tests/test_hazard.py` checks they agree. |
| `window_rule.py` | **The one window rule**: every "next 24 h" starts at the start of the place's current local hour (also UTC+5:30 / +5:45). Engine, risk board, push, map tiles and routes call `window_start`; map tiles are fetched with `timezone=auto&timeformat=unixtime` so each point has its own offset and true instants. Tests pin the clock (`conftest.fixture_clock`); `tests/test_window_rule.py` checks every surface agrees. |
| `advisory.py` | Chat advisory from `thresholds.py`, plus localised advisory text |
| `alerts/engine.py` | Alert engine: the scorer on the place's forecast for the 24 h from the current hour, plus alert texts. `api/alerts.py` retries, serves stale data, then returns a clean 503. |
| `climate/` | Open-Meteo archive: a period compared with the same dates over the previous 10 years |
| `nwp/` | GFS from NOMADS via the GRIB filter. Decoding runs in a worker thread. |
| `routing/` | Weather along a route (`docs/ROUTES.md`): `osrm.py` (OSRM through the backend only, `ROUTING_URL`, default public demo server with no uptime guarantee; 1 request/s, 6 h cache, timeout, replay hooks) and `weather.py` (a sample every 5 km, arrival time from OSRM durations, nearest tile point and forecast hour, the one scorer with `thresholds.ROUTE_RULES`, findings, departure suggestion over 12 h). Never says "safe". |
| `maps/` | `hazard.py` (hazard per H3 cell, res 6 at the ~8 km model grid, coarser when samples are sparser; nearest-sample values; summary within a radius) and `/map` data: `point.py` (tapped point: shared Open-Meteo client + CAMS AQI + heat index, 10 min cache), `tiles.py` (fixed 5×5-point tiles per grid step, shared by all users, 15 min cache, only missing tiles fetched in ONE batched request, hours aligned across tiles), `grid.py` (up to 4 tiles = 100 points, 72 h, `MODEL_GRID_KM`), `heat_index.py` (NWS method; bands in `thresholds.py`), `dem.py` (ground height from the AWS terrarium tiles, Pillow-decoded, 24 h cache) and `waterlogging.py` (EXPERIMENTAL risk per res-8 hexagon: rain past 3 h + next 6 h × lowness vs the 2 rings around + community reports; `docs/WATERLOGGING.md`, levels in `thresholds.py`) |
| `air/` | Open-Meteo CAMS PM2.5/PM10 to Indian AQI (CPCB breakpoints), plus UV |
| `roles/` | `farm.py`, `aviation.py`, `risk.py` (district board), `compare.py` (GFS vs Open-Meteo), `notes.py` (one role sentence per reply) |
| `dissemination/` | `push.py` (pywebpush + VAPID), `job.py` (push only when severity becomes `warning`), `store.py` (Supabase service role), `cap.py` (CAP 1.2 XML), `demo_push.py` (signed-in test push; never writes `last_severity`) |
| `reports/` | Community reports (`docs/REPORTS.md`): `photo.py` (Pillow re-encode, no metadata, 8 MB / 40 MP guards), `trust.py` (model agreement from one Open-Meteo call, trust score and levels; bands in `thresholds.py`), `store.py` (private Supabase tables via the service role; `MemoryStore` for tests), API in `api/reports.py` (sign-in, 1/min and 5/h, expiry, flags, never the reporter's id). Reports never feed forecasts or alerts. |
| `auth/trusted_location.py` | Verifies the Supabase JWT, then reads `profiles` (`id=eq.<sub>`, RLS) |
| `open_meteo_access.py` | Free or commercial Open-Meteo host per service (`OPEN_METEO_API_KEY`); `/health` shows the plan, never the key. Without a key: free endpoints, non-commercial only, 10,000 calls/day (`docs/OPEN_METEO.md`). |
| `http_tls.py` | Shared TLS context for all HTTP clients |
| `env_check.py` | Startup warning when only `NEXT_PUBLIC_` Supabase names are set (never used as a fallback) |

`POST /api/alerts/check` needs the `X-Job-Token` header; `POST /api/push/test` sends a demo push only to the caller's own subscriptions, at most 1/min.

## Database (`supabase/`)

- `schema.sql` is the full schema: sections 1–5, then migration 6 (`profiles.role`) and migration 7 (`alert_subscriptions` + RLS). It is idempotent.
- `migrations_6_7.sql` contains only 6 and 7, for a database that already has 1–5. Keep it in sync with `schema.sql`.
- `migration_8_reports.sql`: community reports (private tables, vote trigger, private `report-photos` bucket). Also appended to `schema.sql`; `tests/test_reports.py` checks they match.

## Notes

- Tests are fully mocked (no network). `pytest.ini` at the repo root sets the paths; run from the repo root.
- On Windows, set `PYTHONIOENCODING=utf-8` when printing Devanagari from Python.
- Demo replay (`DEMO_REPLAY=1`, `docs/DEMO.md`): fixtures in `data/demo_fixtures/`; the map replays recorded weather tiles (`map_tiles/`) for the Pune–Mumbai–Nashik region in `maps/demo.py`; taps get the nearest recorded point within 25 km; `--routes` records the 3 demo routes (`routes/`, replayed when both ends are within 10 km). Re-record on demo morning.
