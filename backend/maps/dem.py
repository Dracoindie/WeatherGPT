"""
Ground elevation from the terrain tiles the map already uses: AWS Terrain
Tiles ("terrarium" PNG, Mapzen; keyless, the same source as /map's 3D
terrain). Each pixel encodes metres as

    elevation = (R * 256 + G + B / 256) - 32768

Tiles are read at DEM_ZOOM (about 76 m per pixel at 18° N), decoded with
Pillow and kept in memory (24 h, at most CACHE_MAX tiles); each tile is
fetched once even when several requests need it at the same time.
"""

from __future__ import annotations

import asyncio
import io
import logging
import math
import time
from typing import Callable, Optional

import httpx
from PIL import Image

from http_tls import SSL_CONTEXT

logger = logging.getLogger(__name__)

TERRARIUM_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
SOURCE = "AWS Terrain Tiles (Mapzen terrarium)"
DEM_ZOOM = 11
TILE_SIZE = 256
CACHE_TTL_S = 24 * 3600
CACHE_MAX = 200
MAX_TILES_PER_REQUEST = 30
TIMEOUT = httpx.Timeout(10.0)

TileXYZ = tuple[int, int, int]

_cache: dict[TileXYZ, tuple[float, Image.Image]] = {}
_inflight: dict[TileXYZ, asyncio.Future] = {}

# Tests install a fetcher returning PNG bytes for a tile (or None).
fetcher: Optional[Callable[[TileXYZ], "asyncio.Future[Optional[bytes]]"]] = None


class DemError(RuntimeError):
    pass


def clear_cache() -> None:
    _cache.clear()
    _inflight.clear()


def tile_pixel(lat: float, lon: float, z: int = DEM_ZOOM) -> tuple[TileXYZ, float, float]:
    """The tile holding (lat, lon) and the pixel position inside it (Web Mercator)."""
    n = 2**z
    x = (lon + 180.0) / 360.0 * n
    lat_r = math.radians(max(-85.05112878, min(85.05112878, lat)))
    y = (1.0 - math.asinh(math.tan(lat_r)) / math.pi) / 2.0 * n
    tx, ty = int(math.floor(x)), int(math.floor(y))
    return (z, tx, ty), (x - tx) * TILE_SIZE, (y - ty) * TILE_SIZE


def decode(rgb: tuple[int, int, int]) -> float:
    r, g, b = rgb[:3]
    return r * 256 + g + b / 256 - 32768


async def _download(key: TileXYZ) -> Optional[bytes]:
    if fetcher is not None:
        return await fetcher(key)
    z, x, y = key
    url = TERRARIUM_URL.format(z=z, x=x, y=y)
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT, verify=SSL_CONTEXT) as client:
            resp = await client.get(url)
    except httpx.RequestError as exc:
        raise DemError("Terrain tiles did not respond.") from exc
    if resp.status_code == 404:
        return None  # open sea: no tile
    if resp.status_code != 200:
        raise DemError(f"Terrain tiles returned HTTP {resp.status_code}.")
    return resp.content


async def _tile(key: TileXYZ) -> Optional[Image.Image]:
    hit = _cache.get(key)
    if hit and time.monotonic() - hit[0] < CACHE_TTL_S:
        return hit[1]
    if key in _inflight:
        return await _inflight[key]
    fut: asyncio.Future = asyncio.get_running_loop().create_future()
    _inflight[key] = fut
    try:
        data = await _download(key)
        img = Image.open(io.BytesIO(data)).convert("RGB") if data else None
        if img is not None:
            if len(_cache) >= CACHE_MAX:
                _cache.pop(min(_cache, key=lambda k: _cache[k][0]))
            _cache[key] = (time.monotonic(), img)
        fut.set_result(img)
        return img
    except Exception as exc:
        fut.set_exception(exc)
        fut.exception()  # mark retrieved: the caller sees it via raise
        raise DemError(str(exc)) from exc
    finally:
        _inflight.pop(key, None)


async def elevations(points: list[tuple[float, float]], z: int = DEM_ZOOM) -> list[Optional[float]]:
    """Metres above sea level at each (lat, lon); None over tiles without data."""
    where = [tile_pixel(lat, lon, z) for lat, lon in points]
    keys = sorted({w[0] for w in where})
    if len(keys) > MAX_TILES_PER_REQUEST:
        raise DemError("Too large an area for the terrain tiles.")
    imgs = dict(zip(keys, await asyncio.gather(*(_tile(k) for k in keys))))
    out: list[Optional[float]] = []
    for key, px, py in where:
        img = imgs.get(key)
        if img is None:
            out.append(None)
            continue
        x = min(TILE_SIZE - 1, max(0, int(px)))
        y = min(TILE_SIZE - 1, max(0, int(py)))
        out.append(decode(img.getpixel((x, y))))
    return out
