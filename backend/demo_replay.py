"""
Demo replay: serve recorded backend responses when venue Wi-Fi fails.

Two switches (environment variables, read at startup):

DEMO_REPLAY=1
    Requests that match a recorded fixture (``backend/data/demo_fixtures/``)
    are answered from it, with the header ``X-WeatherGPT-Replay: <recorded_at>``
    so the UI can show "Replay: recorded data from …". Recorded data is never
    presented as live. Any other request goes to the live services if the
    internet is reachable; otherwise it gets a clear "offline demo" answer
    (chat: HTTP 200 in the user's language; other endpoints: HTTP 503).

DEMO_RECORD=1
    Every successful (200) JSON response to a replayable request is saved as a
    fixture. ``scripts/record_demo_fixtures.py`` uses this for the fixed demo
    question list; you can also run the backend with it and click through the UI.

Matching is on method + path + a normalised query/body: coordinates are
rounded to 0.01°, chat text is case- and punctuation-folded, and follow-up
context (intent, place, date, parameter) is part of the key.

The map is different, because every pan asks for a new box:
- /api/map/grid, /api/map/hazard and /hazard/summary are built from the shared
  weather tiles (maps/tiles.py). Recorded tiles live in
  demo_fixtures/map_tiles/ and are served by the tile layer itself; the
  responses carry ``recorded_at`` and the replay header.
- /api/map/point answers a tap with the nearest recorded point within
  POINT_RADIUS_KM, with that point's own coordinates (never relabelled as the
  tapped spot).
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response

from http_tls import SSL_CONTEXT
from llm.query_parser import detect_language
from models.chat import ChatIntent

logger = logging.getLogger(__name__)

FIXTURE_DIR = Path(__file__).parent / "data" / "demo_fixtures"
REPLAY_HEADER = "X-WeatherGPT-Replay"
OFFLINE_HEADER = "X-WeatherGPT-Offline-Demo"

# Endpoints with side effects, auth or secrets are never recorded or replayed.
_SKIP_PREFIXES = ("/api/push", "/api/alerts/check")
_COORD_KEYS = {"latitude", "longitude", "lat", "lon"}
_CONTEXT_KEYS = ("intent", "location_name", "date_reference", "weather_parameter", "climate_period")
# Map endpoints built from weather tiles: the tile layer replays them (see above).
_TILE_PATHS = ("/api/map/grid", "/api/map/hazard", "/api/map/hazard/summary", "/api/map/demo-region")
POINT_PATH = "/api/map/point"
POINT_RADIUS_KM = 25.0
TILE_DIR_NAME = "map_tiles"

OFFLINE_CHAT = {
    "en": "Offline demo: only the prepared demo questions are available right now (no internet connection).",
    "hi": "ऑफ़लाइन डेमो: अभी इंटरनेट नहीं है, इसलिए केवल पहले से तैयार डेमो सवाल उपलब्ध हैं।",
    "hinglish": "Offline demo: abhi internet nahi hai, isliye sirf prepared demo questions available hain.",
    "mr": "ऑफलाइन डेमो: आत्ता इंटरनेट नाही, त्यामुळे फक्त तयार केलेले डेमो प्रश्न उपलब्ध आहेत.",
}
OFFLINE_DETAIL = "Offline demo: only prepared questions are available (no internet connection)."


def env_on(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in {"1", "true", "yes", "on"}


def replayable(method: str, path: str) -> bool:
    return method in {"GET", "POST"} and path.startswith("/api/") and not path.startswith(_SKIP_PREFIXES)


# ---------------------------------------------------------------------------
# Request keys
# ---------------------------------------------------------------------------


def _norm_text(text: Any) -> str:
    s = str(text or "").casefold().strip()
    s = re.sub(r"[?!.,।॥]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def _coord(value: Any) -> Any:
    try:
        return round(float(value), 2)
    except (TypeError, ValueError):
        return value


def _norm_query(query: dict[str, str]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for k, v in query.items():
        if v in ("", None):
            continue
        out[k] = _coord(v) if k in _COORD_KEYS else (_norm_text(v) if k == "q" else v)
    return dict(sorted(out.items()))


def _norm_body(path: str, body: Any) -> Any:
    if not isinstance(body, dict):
        return body
    if path == "/api/chat":
        ctx = body.get("context") or {}
        return {
            "message": _norm_text(body.get("message")),
            "role": body.get("role") or "citizen",
            "latitude": _coord(body.get("latitude")) if body.get("latitude") is not None else None,
            "longitude": _coord(body.get("longitude")) if body.get("longitude") is not None else None,
            "context": {k: _norm_text(ctx.get(k)) for k in _CONTEXT_KEYS if ctx.get(k)} if isinstance(ctx, dict) else {},
        }
    if path == "/api/risk":
        return {
            "districts": [
                {"name": _norm_text(d.get("name")), "latitude": _coord(d.get("latitude")), "longitude": _coord(d.get("longitude"))}
                for d in body.get("districts", [])
                if isinstance(d, dict)
            ]
        }
    return body


def request_key(method: str, path: str, query: dict[str, str], body: Any = None) -> str:
    canon = json.dumps(
        {"m": method.upper(), "p": path, "q": _norm_query(query), "b": _norm_body(path, body)},
        sort_keys=True,
        ensure_ascii=False,
    )
    return hashlib.sha1(canon.encode("utf-8")).hexdigest()[:16]


def _slug(path: str, query: dict[str, str], body: Any) -> str:
    label = path.removeprefix("/api/").replace("/", "-")
    if isinstance(body, dict) and body.get("message"):
        label += "-" + _norm_text(body["message"])[:40]
    elif query.get("q"):
        label += "-" + _norm_text(query["q"])[:40]
    # ASCII only: Devanagari letters with combining marks make unreadable names.
    label = re.sub(r"-{2,}", "-", re.sub(r"[^A-Za-z0-9-]+", "-", label)).strip("-")
    return label or "request"


# ---------------------------------------------------------------------------
# Fixture store
# ---------------------------------------------------------------------------


class FixtureStore:
    def __init__(self, directory: Path = FIXTURE_DIR):
        self.directory = directory
        self.fixtures: dict[str, dict] = {}
        self.reload()

    def reload(self) -> None:
        self.fixtures = {}
        if not self.directory.is_dir():
            return
        for f in sorted(self.directory.glob("*.json")):
            try:
                data = json.loads(f.read_text(encoding="utf-8"))
                self.fixtures[data["key"]] = data
            except (OSError, ValueError, KeyError) as exc:
                logger.warning("Demo replay: skipping unreadable fixture %s: %s", f.name, exc)

    def get(self, key: str) -> Optional[dict]:
        return self.fixtures.get(key)

    def save(self, method: str, path: str, query: dict[str, str], body: Any, status: int, response: Any) -> Path:
        key = request_key(method, path, query, body)
        record = {
            "key": key,
            "recorded_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
            "request": {"method": method, "path": path, "query": query, "body": body},
            "status": status,
            "response": response,
        }
        self.directory.mkdir(parents=True, exist_ok=True)
        target = self.directory / f"{_slug(path, query, body)}-{key}.json"
        tmp = target.with_suffix(".tmp")
        tmp.write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        tmp.replace(target)
        self.fixtures[key] = record
        return target


    def nearest_point(self, latitude: float, longitude: float, radius_km: float = POINT_RADIUS_KM) -> Optional[dict]:
        """The recorded /api/map/point answer closest to a tap, within radius_km."""
        best, best_km = None, radius_km
        for f in self.fixtures.values():
            if f.get("request", {}).get("path") != POINT_PATH or f.get("status", 200) != 200:
                continue
            r = f.get("response") or {}
            if r.get("latitude") is None or r.get("longitude") is None:
                continue
            km = _km(latitude, longitude, float(r["latitude"]), float(r["longitude"]))
            if km <= best_km:
                best, best_km = f, km
        return best


def _km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    import math

    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 6371.0 * 2 * math.asin(math.sqrt(a))


class TileFixtureStore:
    """Recorded weather tiles (maps/tiles.py), one JSON file per tile."""

    def __init__(self, directory: Path):
        self.directory = directory

    def _path(self, key) -> Path:
        step, row, col = key
        return self.directory / f"tile_{step:g}_{row}_{col}.json"

    def count(self) -> int:
        return len(list(self.directory.glob("tile_*.json"))) if self.directory.is_dir() else 0

    def save(self, tile) -> Path:
        self.directory.mkdir(parents=True, exist_ok=True)
        record = {
            "key": list(tile.key),
            "recorded_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
            "times": tile.times,
            "points": [
                {"latitude": p.latitude, "longitude": p.longitude, "elevation": p.elevation, "hourly": p.hourly, "current": p.current}
                for p in tile.points
            ],
        }
        target = self._path(tile.key)
        tmp = target.with_suffix(".tmp")
        tmp.write_text(json.dumps(record) + "\n", encoding="utf-8")
        tmp.replace(target)
        return target

    def load(self, key):
        from maps.tiles import Tile, TilePoint

        path = self._path(key)
        if not path.is_file():
            return None
        try:
            d = json.loads(path.read_text(encoding="utf-8"))
            return Tile(
                key=tuple(d["key"]),
                times=d["times"],
                points=[TilePoint(p["latitude"], p["longitude"], p.get("elevation"), p["hourly"], p["current"]) for p in d["points"]],
                fetched_at=datetime.fromisoformat(d["recorded_at"].replace("Z", "+00:00")),
                recorded_at=d["recorded_at"],
            )
        except (OSError, ValueError, KeyError, TypeError) as exc:
            logger.warning("Demo replay: skipping unreadable tile %s: %s", path.name, exc)
            return None


# ---------------------------------------------------------------------------
# Internet check (cached so an offline venue does not wait on every request)
# ---------------------------------------------------------------------------

_PROBE_URL = "https://api.open-meteo.com/"
_PROBE_TTL_S = 20.0
_probe_cache: dict[str, float] = {}


async def internet_reachable() -> bool:
    now = time.monotonic()
    if "at" in _probe_cache and now - _probe_cache["at"] < _PROBE_TTL_S:
        return bool(_probe_cache["ok"])
    try:
        async with httpx.AsyncClient(timeout=2.5, verify=SSL_CONTEXT) as client:
            await client.head(_PROBE_URL)
        ok = True
    except httpx.HTTPError:
        ok = False
    _probe_cache.update(at=now, ok=float(ok))
    return ok


def offline_chat_response(message: str) -> dict:
    lang = detect_language(message or "")
    return {
        "message": OFFLINE_CHAT.get(lang, OFFLINE_CHAT["en"]),
        "intent": ChatIntent(intent="unknown", language=lang).model_dump(),
        "source": "offline-demo",
    }


# ---------------------------------------------------------------------------
# Middleware
# ---------------------------------------------------------------------------


def install(app: FastAPI, *, replay: Optional[bool] = None, record: Optional[bool] = None, store: Optional[FixtureStore] = None) -> Optional[FixtureStore]:
    """Add the replay/record middleware when DEMO_REPLAY or DEMO_RECORD is on.

    Call this *before* adding CORSMiddleware, so replayed answers still get CORS headers.
    """
    replay = env_on("DEMO_REPLAY") if replay is None else replay
    record = env_on("DEMO_RECORD") if record is None else record
    if not (replay or record):
        return None
    store = store or FixtureStore()
    tile_store = TileFixtureStore(store.directory / TILE_DIR_NAME)
    from maps import tiles as map_tiles

    map_tiles.fixture_loader = tile_store.load if replay else None
    map_tiles.fixture_saver = tile_store.save if record else None
    logger.warning(
        "Demo mode: replay=%s record=%s, %d fixture(s) and %d map tile(s) in %s",
        replay, record, len(store.fixtures), tile_store.count(), store.directory,
    )

    @app.middleware("http")
    async def demo_replay_middleware(request: Request, call_next):
        method, path = request.method, request.url.path
        if not replayable(method, path) or path in _TILE_PATHS:
            # map grids and hazards replay through the tile layer (recorded tiles)
            return await call_next(request)
        query = dict(request.query_params)
        body: Any = None
        if method == "POST":
            raw = await request.body()
            try:
                body = json.loads(raw) if raw else None
            except ValueError:
                body = None

        if replay:
            hit = store.get(request_key(method, path, query, body))
            if hit is None and path == POINT_PATH:
                try:
                    hit = store.nearest_point(float(query["latitude"]), float(query["longitude"]))
                except (KeyError, ValueError):
                    hit = None
            if hit is not None:
                return JSONResponse(hit["response"], status_code=hit.get("status", 200), headers={REPLAY_HEADER: hit["recorded_at"]})
            if not await internet_reachable():
                headers = {OFFLINE_HEADER: "1"}
                if path == "/api/chat":
                    msg = body.get("message", "") if isinstance(body, dict) else ""
                    return JSONResponse(offline_chat_response(msg), headers=headers)
                return JSONResponse({"detail": OFFLINE_DETAIL, "offline_demo": True}, status_code=503, headers=headers)

        response = await call_next(request)
        if record and response.status_code == 200 and "application/json" in response.headers.get("content-type", ""):
            chunks = [chunk async for chunk in response.body_iterator]
            raw_body = b"".join(chunks)
            try:
                saved = store.save(method, path, query, body, 200, json.loads(raw_body))
                logger.info("Demo record: %s %s -> %s", method, path, saved.name)
            except ValueError:
                pass
            return Response(raw_body, status_code=200, headers=dict(response.headers), media_type=response.media_type)
        return response

    return store
