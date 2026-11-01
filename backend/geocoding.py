"""
Nominatim (OpenStreetMap) geocoding for the chat pipeline.

Forward search resolves a place name to coordinates.
Reverse search labels request-time GPS coordinates.

City coordinates are NEVER hardcoded — Nominatim is the resolver.

Usage policy (https://operations.osmfoundation.org/policies/nominatim/):
at most 1 request per second, and results are cached in memory.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Optional

import httpx
from http_tls import SSL_CONTEXT

logger = logging.getLogger(__name__)

NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search"
NOMINATIM_REVERSE_URL = "https://nominatim.openstreetmap.org/reverse"
USER_AGENT = "WeatherGPT-SIH2026/0.1 (prototype)"
TIMEOUT = httpx.Timeout(connect=5.0, read=15.0, write=5.0, pool=5.0)

CACHE_TTL_S = 24 * 60 * 60
CACHE_MAX_ENTRIES = 1024
MIN_REQUEST_INTERVAL_S = 1.0

_cache: dict[tuple, tuple[float, Any]] = {}
_rate_lock = asyncio.Lock()
_last_request_at: Optional[float] = None


def clear_cache() -> None:
    """Drop cached results and the rate-limit state (used by tests)."""
    global _last_request_at, _rate_lock
    _cache.clear()
    _last_request_at = None
    _rate_lock = asyncio.Lock()


def _cache_get(key: tuple) -> tuple[bool, Any]:
    entry = _cache.get(key)
    if entry is None:
        return False, None
    expires_at, value = entry
    if expires_at < time.monotonic():
        del _cache[key]
        return False, None
    return True, value


def _cache_put(key: tuple, value: Any) -> None:
    if len(_cache) >= CACHE_MAX_ENTRIES:
        # Evict the oldest insertion (dicts keep insertion order).
        _cache.pop(next(iter(_cache)))
    _cache[key] = (time.monotonic() + CACHE_TTL_S, value)


async def _nominatim_get(url: str, params: dict[str, str]) -> httpx.Response:
    """GET Nominatim, spacing requests at least MIN_REQUEST_INTERVAL_S apart."""
    global _last_request_at
    async with _rate_lock:
        if _last_request_at is not None:
            wait = MIN_REQUEST_INTERVAL_S - (time.monotonic() - _last_request_at)
            if wait > 0:
                await asyncio.sleep(wait)
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT, verify=SSL_CONTEXT) as client:
                return await client.get(url, params=params, headers={"User-Agent": USER_AGENT})
        finally:
            _last_request_at = time.monotonic()


class GeoResult:
    __slots__ = ("latitude", "longitude", "name")

    def __init__(self, latitude: float, longitude: float, name: str) -> None:
        self.latitude = latitude
        self.longitude = longitude
        self.name = name


def _display_name(raw: str) -> str:
    parts = [p.strip() for p in raw.split(",") if p.strip()]
    return ", ".join(parts[:3]) if parts else raw


async def geocode_place(place_name: str) -> Optional[GeoResult]:
    """Resolve a human place name to WGS-84 coordinates. None if unknown."""
    query = (place_name or "").strip()
    if not query:
        return None

    key = ("search", query.casefold())
    hit, cached = _cache_get(key)
    if hit:
        return cached
    result = await _geocode_uncached(query)
    _cache_put(key, result)
    return result


async def _geocode_uncached(query: str) -> Optional[GeoResult]:
    params = {"q": query, "format": "json", "limit": "1"}
    try:
        response = await _nominatim_get(NOMINATIM_SEARCH_URL, params)
    except httpx.RequestError as exc:
        logger.error("Nominatim search request failed: %s", exc)
        raise RuntimeError("Location service is temporarily unavailable.") from exc

    if response.status_code != 200:
        logger.error("Nominatim search HTTP %s", response.status_code)
        raise RuntimeError("Location service returned an unexpected status.")

    try:
        results = response.json()
    except Exception as exc:
        logger.error("Nominatim search returned non-JSON: %s", exc)
        raise RuntimeError("Location service returned an unreadable response.") from exc

    if not results:
        return None

    first = results[0]
    try:
        lat = float(first["lat"])
        lon = float(first["lon"])
    except (KeyError, TypeError, ValueError):
        return None

    name = _display_name(str(first.get("display_name") or query))
    return GeoResult(latitude=lat, longitude=lon, name=name)


async def reverse_geocode(latitude: float, longitude: float) -> Optional[str]:
    """Turn coordinates into a short display name. None on failure."""
    # ~110 m grid: nearby GPS fixes share a label.
    key = ("reverse", round(latitude, 3), round(longitude, 3))
    hit, cached = _cache_get(key)
    if hit:
        return cached
    label = await _reverse_uncached(latitude, longitude)
    if label is not None:
        _cache_put(key, label)
    return label


async def _reverse_uncached(latitude: float, longitude: float) -> Optional[str]:
    params = {
        "lat": str(latitude),
        "lon": str(longitude),
        "format": "json",
        "zoom": "10",
        "addressdetails": "1",
    }
    try:
        response = await _nominatim_get(NOMINATIM_REVERSE_URL, params)
    except httpx.RequestError as exc:
        logger.error("Nominatim reverse request failed: %s", exc)
        return None

    if response.status_code != 200:
        return None

    try:
        data = response.json()
    except Exception:
        return None

    address = data.get("address") or {}
    city = (
        address.get("city")
        or address.get("town")
        or address.get("village")
        or address.get("county")
        or ""
    )
    state = address.get("state") or ""
    country = address.get("country") or ""
    parts = [p for p in (city, state, country) if p]
    if parts:
        return ", ".join(parts)
    display = data.get("display_name")
    return _display_name(str(display)) if display else None
