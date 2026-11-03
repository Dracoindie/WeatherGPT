"""
Record real backend responses for the fixed demo script into
backend/data/demo_fixtures/, for DEMO_REPLAY=1 (see docs/DEMO.md).

Run it the morning of the demo, with internet, from the repo root:

    backend\\.venv\\Scripts\\python backend\\scripts\\record_demo_fixtures.py

It runs the FastAPI app in-process (no server needed) against the live
services, and sends the same requests the UI sends for each demo step: the
chat answer, then the side panels (sky/timeline, air quality, alerts, the role
panel). Follow-ups send the previous answer's context, like the UI does.
Places are geocoded through /api/geocode (Nominatim), never hard-coded.

Options:
    --clean     delete existing fixtures first (default: overwrite matching ones)
    --dry-run   print the steps without calling anything
    --map       also record the offline map for the demo region (maps/demo.py):
                the weather tiles for every grid step used between about zoom 8
                and 11 (one Open-Meteo request per 4 tiles) and a 0.25° lattice
                of tap points. About 1,800 Open-Meteo location-calls: run once.
    --map-only  record only the map
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
os.chdir(BACKEND)
os.environ["DEMO_REPLAY"] = "0"  # record live answers, never replay them
os.environ["DEMO_RECORD"] = "1"

# (message, role, follow_up_of_previous)
DEMO_CHAT: list[tuple[str, str, bool]] = [
    ("Will it rain in Pune tomorrow?", "citizen", False),
    ("What about Mumbai?", "citizen", True),
    ("दिल्ली में कल बारिश होगी क्या?", "citizen", False),
    ("Pune mein kal baarish hogi kya?", "citizen", False),
    ("aur parso?", "citizen", True),
    ("पुण्यात उद्या पाऊस पडेल का?", "citizen", False),
    ("Has Mumbai been wetter than normal this month?", "researcher", False),
    ("What does GFS say for tomorrow in Pune?", "researcher", False),
    ("Can I spray pesticide in Nashik tomorrow?", "farmer", False),
    ("Is it safe to fly from Nagpur today?", "aviation", False),
]

# Alert pages (/alerts and /dashboard) for these places.
ALERT_PLACES = ["Pune", "Mumbai", "Chennai"]

# Must match DEFAULT_DISTRICTS in weathergpt-web/app/disaster/page.tsx.
RISK_DISTRICTS = [
    "Mumbai", "Thane", "Palghar", "Raigad (Alibag)", "Ratnagiri", "Pune", "Satara", "Kolhapur",
    "Nashik", "Chhatrapati Sambhajinagar", "Solapur", "Latur", "Nanded", "Amravati", "Nagpur",
]

ROLE_PANEL = {"farmer": "/api/farm", "aviation": "/api/aviation", "researcher": "/api/compare"}


def context_from(res: dict) -> dict:
    """Same slots as contextFrom() in weathergpt-web/lib/api/chat.ts."""
    loc = res.get("location") or {}
    intent = res.get("intent") or {}
    return {
        "intent": intent.get("intent"),
        "location_name": loc.get("name"),
        "latitude": loc.get("latitude"),
        "longitude": loc.get("longitude"),
        "date_reference": intent.get("date_reference"),
        "weather_parameter": intent.get("weather_parameter"),
        "climate_period": intent.get("climate_period"),
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--clean", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--map", action="store_true")
    ap.add_argument("--map-only", action="store_true")
    args = ap.parse_args()
    if args.map_only:
        args.map = True

    if args.dry_run:
        if args.map:
            from maps.demo import DEMO_REGION, DEMO_STEPS, point_lattice, region_tile_keys

            n = sum(len(region_tile_keys(s)) for s in DEMO_STEPS)
            print(f"map: {DEMO_REGION['name']}, {n} tiles over {len(DEMO_STEPS)} steps, {len(point_lattice())} tap points")
        for m, role, fu in DEMO_CHAT:
            print(f"chat [{role}{', follow-up' if fu else ''}] {m}")
        print("alerts:", ", ".join(ALERT_PLACES))
        print("risk board:", ", ".join(RISK_DISTRICTS))
        return 0

    from fastapi.testclient import TestClient

    import demo_replay
    from main import app

    if args.clean and demo_replay.FIXTURE_DIR.is_dir():
        for f in demo_replay.FIXTURE_DIR.glob("*.json"):
            f.unlink()
        for f in (demo_replay.FIXTURE_DIR / demo_replay.TILE_DIR_NAME).glob("tile_*.json"):
            f.unlink()

    failures: list[str] = []
    client = TestClient(app)

    def get(path: str, **params) -> dict | None:
        r = client.get(path, params=params)
        if r.status_code != 200:
            failures.append(f"GET {path} {params} -> {r.status_code}")
            return None
        return r.json()

    def panels(lat: float, lon: float, role: str) -> None:
        get("/api/weather", latitude=lat, longitude=lon)
        get("/api/air-quality", latitude=lat, longitude=lon)
        get("/api/alerts", latitude=lat, longitude=lon)
        if role in ROLE_PANEL:
            extra = {"hours": 24} if role == "researcher" else {}
            get(ROLE_PANEL[role], latitude=lat, longitude=lon, **extra)

    if args.map:
        record_map(get, failures)
    if args.map_only:
        return report(failures)

    get("/api/alerts/thresholds")

    previous: dict | None = None
    for message, role, follow_up in DEMO_CHAT:
        body: dict = {"message": message, "role": role}
        if follow_up and previous:
            body["context"] = context_from(previous)
        r = client.post("/api/chat", json=body)
        if r.status_code != 200:
            failures.append(f"chat {message!r} -> {r.status_code}")
            continue
        res = r.json()
        previous = res
        loc = res.get("location")
        print(f"chat  {message!r} -> {res['message'][:90]!r}")
        if loc:
            panels(loc["latitude"], loc["longitude"], role)

    for place in ALERT_PLACES:
        geo = get("/api/geocode", q=place)
        if geo:
            get("/api/alerts", latitude=geo["latitude"], longitude=geo["longitude"])
            get("/api/forecast", latitude=geo["latitude"], longitude=geo["longitude"], days=5)
            print(f"alerts {place}")

    districts = []
    for name in RISK_DISTRICTS:
        query = f"{'Alibag' if name == 'Raigad (Alibag)' else name}, Maharashtra, India"
        geo = get("/api/geocode", q=query)
        if geo:
            districts.append({"name": name, "latitude": geo["latitude"], "longitude": geo["longitude"]})
    if districts:
        r = client.post("/api/risk", json={"districts": districts})
        if r.status_code != 200:
            failures.append(f"risk board -> {r.status_code}")
        else:
            print(f"risk board: {len(districts)} districts")

    return report(failures)


def record_map(get, failures: list[str]) -> None:
    """Weather tiles for the demo region (saved by the tile layer while DEMO_RECORD=1) and tap points."""
    import asyncio

    from maps import tiles as T
    from maps.demo import DEMO_REGION, DEMO_STEPS, point_lattice, region_tile_keys

    per_request = T.MAX_POINTS // (T.TILE_POINTS * T.TILE_POINTS)
    for step in DEMO_STEPS:
        keys = region_tile_keys(step)
        for i in range(0, len(keys), per_request):
            try:
                asyncio.run(T.get_tiles(keys[i : i + per_request]))
            except RuntimeError as exc:
                failures.append(f"map tiles step {step} batch {i // per_request} -> {exc}")
        print(f"map tiles: step {step}°, {len(keys)} tiles")
    points = point_lattice()
    for lat, lon in points:
        get("/api/map/point", latitude=lat, longitude=lon)
    print(f"map points: {len(points)} in {DEMO_REGION['name']}")


def report(failures: list[str]) -> int:
    import demo_replay

    count = len(list(demo_replay.FIXTURE_DIR.glob("*.json")))
    tiles = len(list((demo_replay.FIXTURE_DIR / demo_replay.TILE_DIR_NAME).glob("tile_*.json")))
    print(f"\n{count} fixture file(s) and {tiles} map tile(s) in {demo_replay.FIXTURE_DIR}")
    if failures:
        print("\nNot recorded (check the internet connection, then run again):")
        for f in failures:
            print("  -", f)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
