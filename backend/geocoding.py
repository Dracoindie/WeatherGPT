"""
Nominatim (OpenStreetMap) geocoding for the chat pipeline.

Forward search resolves a place name to coordinates.
Reverse search labels request-time GPS coordinates.

City coordinates are NEVER hardcoded — Nominatim is the resolver.
"""

from __future__ import annotations

import logging
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search"
NOMINATIM_REVERSE_URL = "https://nominatim.openstreetmap.org/reverse"
USER_AGENT = "WeatherGPT-SIH2026/0.1 (prototype)"
TIMEOUT = httpx.Timeout(connect=5.0, read=15.0, write=5.0, pool=5.0)


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

    params = {"q": query, "format": "json", "limit": "1"}
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            response = await client.get(
                NOMINATIM_SEARCH_URL,
                params=params,
                headers={"User-Agent": USER_AGENT},
            )
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
    params = {
        "lat": str(latitude),
        "lon": str(longitude),
        "format": "json",
        "zoom": "10",
        "addressdetails": "1",
    }
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            response = await client.get(
                NOMINATIM_REVERSE_URL,
                params=params,
                headers={"User-Agent": USER_AGENT},
            )
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
