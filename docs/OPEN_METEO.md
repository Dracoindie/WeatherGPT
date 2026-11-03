# Open-Meteo: free tier, terms and the optional API key

WeatherGPT gets its weather, archive and air-quality data from [Open-Meteo](https://open-meteo.com/). This page covers the free tier's limits and terms, how the app stays within them, and when to set `OPEN_METEO_API_KEY`.

## The free tier

- **Non-commercial use only.** The free API is for non-commercial use, such as personal projects, research, education and this SIH prototype. Commercial use (a paid product, ads, a business service) needs a paid plan, which comes with an API key. Read the current terms on open-meteo.com before deploying; they are the authority, not this page.
- **Limits:** 10,000 calls a day, 5,000 an hour and 600 a minute, per IP address.
- **How calls are counted:**
  - **A request for N locations counts as N calls.** Requests with many variables or long time ranges count as more than one.
  - **The map's grid is the heaviest user.** A full grid is 100 points, so up to 100 calls when none of its tiles are cached.
- **Attribution.** Data is under CC BY 4.0. The app credits "Open-Meteo" on every data surface (the "Source: Open-Meteo" strip and the map's notes).

## How WeatherGPT stays inside the limits

| Surface | Calls per use | Cache |
|---|---|---|
| Chat question | 1 forecast call (plus 1 air-quality call for AQI questions, 1 archive call for climate) | none: every answer is fresh |
| `/api/map/point` (tap on the map) | 1 forecast + 1 air-quality | 10 min, per ~1 km |
| `/api/map/grid` | 25 per **missing** tile, in one request | 15 min per tile, **shared by all users** |
| `/api/alerts`, risk board, push job | 1 forecast per place | alerts keep the last good answer for stale serving |

**The map tiles (`backend/maps/tiles.py`).**
- The world is cut into fixed tiles of 5 × 5 points for each grid step (0.08° up to 8°).
- A tile's points sit on exact multiples of the step, so every user whose view touches a tile at that zoom band shares the same cached copy.
- Panning fetches only the tiles that are new, in one request.
- A busy demo region therefore costs about the same as a single viewer.

## The optional key: `OPEN_METEO_API_KEY`

- **Unset or blank:** the free endpoints (`api.`, `air-quality-api.`, `archive-api.open-meteo.com`).
- **Set:** every client switches to the commercial `customer-…` hosts and adds `apikey=…`. These are the forecast, map tiles, air quality, climate archive and alert clients, all through `backend/open_meteo_access.py`.
- **It is a secret, kept on the backend only.**
  - Put it in `backend/.env` (git-ignored) or the host's environment (Render/Railway).
  - Never put it in `NEXT_PUBLIC_*`, in `weathergpt-web/.env.local`, or in git.
  - `/health` reports only `"open_meteo": "free (non-commercial)"` or `"commercial"`, never the key.
- **When to set it:** for any commercial deployment, or when public traffic could pass the free limits.

Tests: `tests/test_map_tiles.py` (shared tiles, one request for missing tiles only, hour alignment, free and commercial routing for all three services, and the key never appearing in `/health`).
