# Weather along a route

`/map` → **Route**: pick a start and a destination and a departure time. WeatherGPT gets the driving route from OSRM, works out when you would pass each point, and scores the forecast **for that hour** at that point. The route line is coloured by the estimated hazard, and the report lists what to expect and the departure in the next 12 hours with the lowest worst level.

It is guidance from model data. It never says a road is "safe", only that one departure has a "lower estimated weather hazard" than another. **Not official IMD warnings.**

## How it works (`backend/routing/`, `GET /api/route`)

1. **Route.** `routing/osrm.py` asks OSRM for the driving route with its full geometry and per-segment distance and duration (`annotations=distance,duration`). The browser never calls OSRM; it calls our backend.
2. **Samples.** A point every **5 km** along the route, plus the end. Each sample's arrival time is the departure time plus OSRM's own travel time to that point.
3. **Weather.** The shared map tiles (`maps/tiles.py`): the same Open-Meteo values as the hazard map, cached and shared with every map user.
   - The grid step is the finest one (from 0.08°, about the ~8 km model grid) whose tiles along the route stay within 8 tiles (200 points). Long routes use a coarser step; the report shows the step and spacing.
   - Each sample takes its **nearest grid point** and the **forecast hour nearest to its arrival time**. Nothing is interpolated.
4. **Scoring.** `alerts/scoring.py`, the same scorer as alerts and the hazard map, on that **one hour**, with `thresholds.ROUTE_RULES`:
   - temperature, heat index, wind and thunderstorm rules as everywhere else (one hour's value against the same thresholds);
   - **rain from the model's WMO weather code for that hour**: 63 / 81 (moderate rain, moderate showers) is an advisory, 65 / 82 (heavy rain, violent showers) a watch. The 24 h rain totals (15 / 50 / 115.6 mm) can't be compared with one hour of rain, so they are not used on routes, and no new mm-per-hour threshold was invented. Source: WMO code table 4677, as published by Open-Meteo.
5. **Report.**
   - **Segments**: each sample colours the stretch halfway to its neighbours; equal levels merge. Grey means beyond the 72 h forecast.
   - **Findings**: for each hazard, each continuous stretch where a rule fires, with its peak level, value vs threshold, km range, the clock time you would be there, and a nearby town (Nominatim reverse geocoding, cached, 1 request/s, for the 3 worst) or else the road name from OSRM.
   - **Departure suggestion**: every 15 minutes from the chosen departure to 12 h later. The best one has the lowest worst level, then the fewest km at that level, then the lowest total. It is suggested only when it is strictly better than the chosen departure. The text says which hazards it avoids ("Leaving at 15:10 avoids the rain") or that the hazard is lower.

## Routing engine and fair use

| Setting | Value |
|---------|-------|
| `ROUTING_URL` | OSRM base URL. Default: `https://router.project-osrm.org`, the **public OSRM demo server**. |
| Timeout | 5 s connect, 12 s read |
| Rate | One request at a time, at least 1 s apart, with an identifying `User-Agent`; cache hits and replay never call OSRM |
| Cache | 6 hours per start/destination pair (rounded to ~10 m), 200 routes |

**The public OSRM demo server has no uptime guarantee.** Its usage policy ([OSRM wiki, "Demo server"](https://github.com/Project-OSRM/osrm-backend/wiki/Demo-server)): "Do not exceed 1 request per second", use is "restricted to reasonable, non-commercial use-cases", and "We provide no guarantees wrt. uptime, latency, or data updates". So it may be slow, rate-limited or down at any time. (The `User-Agent` is our own courtesy, not a stated requirement.) When it does not answer, `/api/route` returns **503** and the map says "Route planning is unavailable right now … try again in a minute". The rest of the map keeps working.

For anything beyond a demo, run your own OSRM (Docker image `osrm/osrm-backend` with an India extract from Geofabrik) and set `ROUTING_URL` to it. No code change is needed. Valhalla would need a different client.

## API

`GET /api/route?from_lat=…&from_lon=…&to_lat=…&to_lon=…[&depart=ISO 8601 with zone]`

- `depart` defaults to now; it must be between now and now + 72 h.
- **422**: no road route, start equals destination, trip longer than 2,000 km, or a bad departure.
- **503**: routing or weather unavailable.
- The response has `samples` (km, position, ETA, level per hazard, the triggering rules, that hour's values, the grid point used), `segments`, `findings`, `departures` (49 options), `suggestion`, `best_already`, `beyond_forecast_km`, the step and spacing, `model_grid_km`, `routing_host`, `routing_public_demo`, the route rules and a `note`.

## Demo replay

`record_demo_fixtures.py --routes` records three demo routes (Pune → Mumbai, Mumbai → Nashik, Pune → Nashik): the OSRM answers in `demo_fixtures/routes/`, plus the weather tiles along them in `demo_fixtures/map_tiles/`. In replay mode (`DEMO_REPLAY=1`):

- a route whose start and destination are each within 10 km of a recorded route's is served from the recording, labelled with the replay header;
- weather comes from the recorded tiles, so the levels are those of the recording morning, with clock times from now when "now" is still inside the recorded forecast;
- other routes need the internet; offline they get the 503 message.

## Tests

`tests/test_routes.py` (OSRM mocked, no network): sampling every 5 km, arrival-time maths from the OSRM durations, the nearest forecast hour, scoring at that hour with the shared scorer, findings and segments, the departure suggestion, the timeout and fallback messages, fair-use spacing and caching, `ROUTING_URL`, and replay. `e2e/route.spec.ts`: pick a route, the coloured line, the report and the suggestion.
