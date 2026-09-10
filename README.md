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
No API key required. Provides current + 3-day hourly forecast.

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
    "weather_code": 3
  },
  "hourly": {
    "time": ["2026-09-09T00:00", "2026-09-09T01:00", "..."],
    "temperature_2m": [25.1, 24.8, "..."],
    "precipitation_probability": [5, 5, "..."],
    "precipitation": [0.0, 0.0, "..."],
    "wind_speed_10m": [9.5, 8.7, "..."]
  }
}
```

**`weather_code`** follows the [WMO Weather Interpretation Codes (WW)](https://open-meteo.com/en/docs#weathervariables).

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
    "precipitation_probability": 80
  },
  "source": "open-meteo"
}
```

**Location priority** (see `backend/api/chat.py`)

1. Place name extracted from the query (geocoded; never hardcoded city coords)
2. Request-time `latitude` + `longitude` on the body
3. Trusted default from a verified Supabase session (`backend/auth/trusted_location.py`, RLS)
4. HTTP **200** asking the user for a location (`location` and `weather` are `null`) — not HTTP 400

**Anonymous vs authenticated**

- Anonymous: works when the message names a place, or the body includes both coordinates.
- Authenticated: send the session JWT. If the query has no place and no request coords, the profile default may be used. Requires backend `SUPABASE_URL` and `SUPABASE_ANON_KEY`.

**LLM provider setup** (optional)

Set on the FastAPI process (see `.env.example` and `backend/llm/provider.py`):

- `LLM_PROVIDER` = `gemini` | `groq` | `openai` | `none`
- Keys: `GEMINI_API_KEY` or `GOOGLE_API_KEY`, `GROQ_API_KEY`, `OPENAI_API_KEY`
- Optional: `LLM_MODEL`, `LLM_API_KEY`

If no key is configured, a deterministic parser and templates are used. Model output is rejected if it introduces numbers that are not in `WeatherFacts`.

**Grounding rule:** Open-Meteo → Pydantic validation → selected `WeatherFacts` → language layer. The model must not invent locations, dates, alerts, or numeric values.

**Current limitations**

- Prototype phrases and a small city lexicon in the fallback parser; unusual wording may miss a place name.
- Hourly humidity is not in the Open-Meteo fetch; humidity answers may fall back to current humidity.
- Forecast window is the existing 3-day hourly product (today / tomorrow / tonight / afternoon).
- No conversation memory, voice, alerts, or NWP in this milestone.

---

## Running Tests

```bash
# From the project root with backend venv active
pytest tests/ -v
```

Tests mock Nominatim, Open-Meteo, LLM, and Supabase — no internet is required.

---

## Project Structure

```
WeatherGPT/
├── backend/
│   ├── main.py
│   ├── api/chat.py
│   ├── auth/trusted_location.py
│   ├── geocoding.py
│   ├── query_service.py
│   ├── llm/                  # parser, provider, grounded replies
│   ├── models/
│   └── weather/open_meteo.py
├── tests/
├── docs/AUTH_LOCATION_ARCHITECTURE.md
└── weathergpt-web/           # Next.js (dashboard includes ChatAsk)
```
