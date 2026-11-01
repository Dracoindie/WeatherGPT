# WeatherGPT

SIH 2026 - Problem Statement SIH26068

## Prototype Architecture

| Layer    | Technology                             |
|----------|----------------------------------------|
| Frontend | Next.js · TypeScript · Tailwind · Leaflet |
| Backend  | FastAPI · Pydantic v2 · HTTPX          |
| Weather  | Open-Meteo (primary) · GFS/NOAA (future NWP) |
| GIS      | GeoPandas · Shapely · PyProj           |
| NWP      | xarray · cfgrib                        |
| Voice    | LiveKit Agents (integration phase)     |

---

## Development Rule

> **The LLM must never be the source of weather facts.**  
> Weather data must follow this pipeline:
>
> ```
> Open-Meteo → Pydantic validation → structured WeatherResponse → LLM grounding layer
> ```

---

## Backend Setup

### 1. Activate the virtual environment

**Windows (PowerShell)**
```powershell
cd backend
.\.venv\Scripts\Activate.ps1
```

**macOS / Linux**
```bash
cd backend
source .venv/bin/activate
```

### 2. Install dependencies

```bash
pip install -r requirements.txt
```

Versions are pinned. `xarray` and `cfgrib` (which needs the ecCodes library) serve `/api/nwp`; if they
cannot be imported the API still starts and only `/api/nwp` is left out (a warning is logged).
GIS and agent packages not used yet (geopandas, shapely, pyproj, langgraph) are in
`requirements-future.txt`.

### Configuration

`backend/.env` is loaded at startup if it exists (python-dotenv); real environment variables win.
See `.env.example` for the LLM and Supabase keys. Also:

| Variable | Default | Purpose |
|----------|---------|---------|
| `ALLOWED_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000` | Comma-separated CORS origins |

### 3. Run FastAPI (development)

```bash
# From the backend/ directory with the venv active
uvicorn main:app --reload --port 8000
```

The API will be available at `http://localhost:8000`.  
Interactive docs: `http://localhost:8000/docs`

---

## API Reference

### Health check

```
GET /health
```

**Response**
```json
{
  "status": "ok",
  "service": "WeatherGPT API"
}
```

---

### Real-time weather

```
GET /api/weather?latitude={lat}&longitude={lon}
```

| Parameter   | Type  | Required | Range        | Description                     |
|-------------|-------|----------|--------------|--------------------------------------|
| `latitude`  | float | ✅       | −90 to 90    | Decimal degrees (WGS-84)             |
| `longitude` | float | ✅       | −180 to 180  | Decimal degrees (WGS-84)             |

**Data source:** [Open-Meteo Forecast API](https://api.open-meteo.com/v1/forecast)  
No API key required. Provides current conditions + a 7-day hourly forecast (168 hours).
`retrieved_at` is always UTC; hourly `time` values are local wall time in `timezone`.

#### Example request — Pune, India

```bash
curl "http://localhost:8000/api/weather?latitude=18.5204&longitude=73.8567"
```

#### Example response structure

```json
{
  "source": "open-meteo",
  "latitude": 18.519999,
  "longitude": 73.870003,
  "timezone": "Asia/Kolkata",
  "retrieved_at": "2026-09-09T15:52:21.000Z",
  "current": {
    "time": "2026-09-09T21:00",
    "temperature_2m": 27.4,
    "relative_humidity_2m": 76.0,
    "precipitation": 0.0,
    "wind_speed_10m": 11.2,
    "wind_direction_10m": 250.0,
    "weather_code": 3
  },
  "hourly": {
    "time": ["2026-09-09T00:00", "2026-09-09T01:00", "..."],
    "temperature_2m": [25.1, 24.8, "..."],
    "precipitation_probability": [5, 5, "..."],
    "precipitation": [0.0, 0.0, "..."],
    "wind_speed_10m": [9.5, 8.7, "..."],
    "wind_direction_10m": [245.0, 250.0, "..."],
    "weather_code": [3, 2, "..."],
    "relative_humidity_2m": [81.0, 83.0, "..."]
  }
}
```

**`weather_code`** follows the [WMO Weather Interpretation Codes (WW)](https://open-meteo.com/en/docs#weathervariables).
**`wind_direction_10m`** is the direction the wind blows *from*, in degrees (0 = north, 90 = east).

---

### Conversational weather

```
POST /api/chat
```

Turns a natural-language question into a grounded reply. The LLM is never the source of weather facts.

**Query flow**

```
User message
→ query understanding (backend/llm/query_parser.py)
→ location resolution (Nominatim + optional trusted profile)
→ Open-Meteo (backend/weather/open_meteo.py)
→ validation / fact selection (backend/query_service.py)
→ grounded response (backend/llm/response_generator.py)
```

**Request**

| Field | Type | Required | Notes |
|-------|------|----------|--------|
| `message` | string | yes | 1–2000 characters |
| `latitude` | float | no | Request-time GPS for this query (−90 to 90) |
| `longitude` | float | no | Request-time GPS for this query (−180 to 180) |

`user_id` and client `default_*` fields are ignored. Identity for a saved default comes only from `Authorization: Bearer <Supabase access token>`.

```bash
curl -s http://localhost:8000/api/chat ^
  -H "Content-Type: application/json" ^
  -d "{\"message\": \"Pune mein kal baarish hogi kya?\"}"
```

**Response**

```json
{
  "message": "In Pune tomorrow, total precipitation is … (Open-Meteo).",
  "intent": {
    "intent": "forecast",
    "location_name": "Pune",
    "date_reference": "tomorrow",
    "weather_parameter": "precipitation",
    "language": "hinglish"
  },
  "location": {
    "name": "Pune, …",
    "latitude": 18.52,
    "longitude": 73.85,
    "source": "explicit_query"
  },
  "weather": {
    "source": "open-meteo",
    "location": "Pune, …",
    "requested_time": "tomorrow (…)",
    "timezone": "Asia/Kolkata",
    "precipitation": 4.8,
    "precipitation_probability": 80,
    "weather_code": 63,
    "weather_description": "Rain"
  },
  "advisory": {
    "severity": "low",
    "condition": "Routine conditions",
    "advisory": "No specific weather advisories at this time.",
    "reasons": ["There is a 80% chance of rain."]
  },
  "source": "open-meteo"
}
```

**Date references** (`intent.date_reference`)

| Value | Window (location's local time) | Examples |
|-------|--------------------------------|----------|
| `now` | current observation | "right now", "abhi" |
| `today` | today 00:00–23:00 | "aaj", "आज" |
| `this_afternoon` | today 12:00–17:00 | "dopahar", "दोपहर" |
| `tonight` | today 20:00 to 05:00 the next morning | "raat", "रात" |
| `tomorrow` | tomorrow | "kal", "कल" |
| `day_after_tomorrow` | today + 2 | "parso", "परसों" |
| `monday` … `sunday` | next occurrence, counting today | "Friday", "shukravar", "शुक्रवार" |

If the window is not inside the 7-day forecast, `weather.period_available` is `false`.
Forecast periods report the period's most significant WMO code (with `weather_description`), mean
hourly humidity, peak wind and its direction, total precipitation and the peak probability.

**Weather parameters** (`intent.weather_parameter`): `temperature`, `high_temperature`,
`precipitation`, `heavy_rain`, `rain_likelihood`, `wind`, `strong_wind`, `storm`, `humidity`,
`advisory`, `general`. Each one limits the `weather` facts to what it is about; the advisory always
evaluates the full period, so heavy rain is still flagged on a temperature question.

**Advisory in the reply:** the reply includes the advisory only when a threshold check fired or the
user asked for advisories. Reply text is localised for `hi` and `hinglish`; the `advisory` object
stays in English.

**Location priority** (see `backend/api/chat.py`)

1. Place name extracted from the query (geocoded; never hardcoded city coords)
2. Request-time `latitude` + `longitude` on the body
3. Trusted default from a verified Supabase session (`backend/auth/trusted_location.py`, RLS)
4. HTTP **200** asking the user for a location (`location` and `weather` are `null`) — not HTTP 400

**Anonymous vs authenticated**

- Anonymous: works when the message names a place, or the body includes both coordinates.
- Authenticated: send the session JWT. If the query has no place and no request coords, the profile default may be used. Requires backend `SUPABASE_URL` and `SUPABASE_ANON_KEY`. The profiles query is also filtered by `id=eq.<sub>` from the JWT (defense in depth; RLS still enforces access). Tokens without a UUID `sub` skip the lookup.

**Geocoding:** Nominatim results are cached in memory for 24 h and requests are spaced at least
1 s apart, per the [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/).

**LLM provider setup** (optional)

Set on the FastAPI process (see `.env.example` and `backend/llm/provider.py`):

- `LLM_PROVIDER` = `gemini` | `groq` | `openai` | `none`
- Keys: `GEMINI_API_KEY` or `GOOGLE_API_KEY`, `GROQ_API_KEY`, `OPENAI_API_KEY`
- Optional: `LLM_MODEL`, `LLM_API_KEY`

If no key is configured, a deterministic parser and templates are used. Model output is rejected if it introduces numbers that are not in `WeatherFacts`, the advisory reasons, or the date/time of `requested_time`.

**Grounding rule:** Open-Meteo → Pydantic validation → selected `WeatherFacts` → language layer. The model must not invent locations, dates, alerts, or numeric values.

**Current limitations**

- Prototype phrases and a small city lexicon in the fallback parser; unusual wording may miss a place name.
- Forecast window is 7 days; questions further out return `period_available: false`.
- No conversation memory. `/api/alerts`, `/api/climate`, `/api/forecast` and `/api/nwp` exist
  but `/api/chat` does not use them yet.

---

## Running Tests

```bash
# From the project root with backend venv active (pytest.ini sets testpaths)
pytest tests/ -v
```

Tests mock Nominatim, Open-Meteo, LLM, and Supabase — no internet is required.

---

## Project Structure

```
WeatherGPT/
├── backend/
│   ├── main.py
│   ├── api/                  # chat, forecast, alerts, climate, nwp routers
│   ├── advisory.py           # deterministic thresholds + localised advisory text
│   ├── auth/trusted_location.py
│   ├── geocoding.py          # Nominatim, cached + rate-limited
│   ├── query_service.py      # Open-Meteo → WeatherFacts (period windows, focus)
│   ├── llm/                  # parser, provider, grounded replies
│   ├── models/
│   ├── alerts/ climate/ nwp/
│   ├── weather/open_meteo.py
│   ├── requirements.txt
│   └── requirements-future.txt
├── tests/
├── pytest.ini
├── docs/AUTH_LOCATION_ARCHITECTURE.md
└── weathergpt-web/           # Next.js "Living Sky" frontend (see note below)
```

> **Note:** `weathergpt-web/` is a separate nested git repository. This repo only records a
> pointer to it (a gitlink without `.gitmodules`), so its code is **not yet in this GitHub repo**.
> Setup steps are in `weathergpt-web/README.md`.
