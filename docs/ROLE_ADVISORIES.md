# Role guidance: rules and thresholds

Everything here is **guidance computed by WeatherGPT from Open-Meteo forecast
values** (and NOAA GFS for the researcher comparison). It is not an IMD
warning, an agro-met advisory from a KVK, or an aviation METAR/TAF, and every
API response says so in its `note` field. Thresholds are constants in the
code (listed below with their file) and are returned in each response's
`thresholds` object, so the UI and users can see exactly why a window was
chosen. Tests: `tests/test_roles.py`.

These role windows (spray, irrigation, harvest, sowing, aviation flags) are
role guidance, separate from the **hazard** thresholds (heavy rain, heat, wind,
thunderstorm). The hazard thresholds live only in `backend/thresholds.py` and
drive alerts, chat advisories, the district risk board, push and CAP; see
`docs/EARLY_WARNING.md`.

## Farmer — `GET /api/farm` (`backend/roles/farm.py`)

The rules look at the next 72 forecast hours, in the location's local time.

### Spraying (pesticide / foliar feed)

An hour is suitable when **all** of these hold. A window is at least 2 consecutive suitable hours.

| Rule | Threshold | Why |
|------|-----------|-----|
| Daylight | 06:00–18:00 local | Field work hours |
| Wind | 3–15 km/h | Below 3: inversion and droplets hang; above 15: drift |
| Temperature | ≤ 30 °C | Evaporation and volatilisation |
| Relative humidity | ≥ 40 % | Droplets dry before landing |
| Rain-free after spraying | No rain and rain chance < 40 % in that hour and the next 4 h | Rain-fastness |

### Irrigation (next 48 h)

The first matching row applies.

| Status | Rule |
|--------|------|
| `skip` | ≥ 10 mm of rain forecast in 48 h |
| `delay` | ≥ 5 mm in 48 h, or rain chance ≥ 60 % in the next 24 h |
| `needed` | Max temperature ≥ 35 °C (high evaporation) |
| `as_usual` | Otherwise |

### Harvest (each of the next 3 days)

A day is `good` when daily rain is < 1 mm, max rain chance is < 40 % and max wind is < 30 km/h. Otherwise it is `avoid`, with the reasons listed.

### Sowing (next 72 h)

The first matching row applies.

| Status | Rule |
|--------|------|
| `wait` | A day with ≥ 50 mm, or > 50 mm in total (seed washout) |
| `wait` | Max temperature ≥ 38 °C (heat stress) |
| `favourable` | 10–50 mm in total (moisture for germination) |
| `dry` | < 10 mm (sow only with irrigation) |

In chat, the farmer role adds one sentence chosen from the period's values, checked in this order:
1. Rain ≥ 5 mm or rain chance ≥ 60 %: hold irrigation, don't spray.
2. Wind > 15 km/h: not suitable for spraying.
3. Max temperature > 30 °C: work in the early morning or evening.
4. Otherwise: conditions suit spraying.

## Aviation — `GET /api/aviation` (`backend/roles/aviation.py`)

The briefing uses current conditions plus the next 6 h:
- visibility, cloud cover, wind, gusts (km/h and kt), precipitation and WMO weather code
- in the next 6 h: the lowest visibility, the highest gust and wind, total rain and the most significant code

Open-Meteo has no cloud base, so **no flight category (VFR/IFR) is derived**.

| Item | Threshold |
|------|-----------|
| Visibility band | good ≥ 8 km · moderate ≥ 5 km · poor ≥ 1.5 km · very poor < 1.5 km |
| Flag: thunderstorm | WMO code ≥ 95 now or within 6 h |
| Flag: low visibility | < 5 km |
| Flag: gusty | Gust − mean wind ≥ 18.5 km/h (~10 kt) |
| Flag: strong wind | Wind or gust ≥ 46 km/h (~25 kt) |

## Disaster manager — `POST /api/risk` (`backend/roles/risk.py`)

The deterministic alert engine (`backend/alerts/engine.py`, the same as `/api/alerts`) runs for each district, with up to 40 per request and 6 fetched at a time.
- **Severity:** a district's severity is its highest alert (warning > watch > advisory > none). A district whose weather fetch failed is `unknown` and is listed last.
- **Ties:** broken by 24 h rain, then wind.

## Researcher — `GET /api/compare` (`backend/roles/compare.py`)

This compares GFS (NOAA NOMADS, 0.25°) with Open-Meteo for the same valid hours. GFS hour *h* is valid at run + *h* (UTC), and Open-Meteo local hours are converted to UTC.
- **GFS rain:** APCP is accumulated in 6 h buckets, so it is converted to hourly amounts.
- **Stats:** mean bias (GFS − Open-Meteo) and mean absolute difference for temperature and wind, plus rain totals.

Both are model output, so the differences are not errors against observations. Long-term climate trends come from `/api/climate` and the chat "climate" intent (Open-Meteo archive).
