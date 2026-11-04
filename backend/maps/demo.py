"""
The offline map demo region (docs/DEMO.md): Pune, Mumbai and Nashik, so the
recorded demo routes (Pune -> Mumbai, Mumbai -> Nashik, Pune -> Nashik;
docs/ROUTES.md) also have their basemap offline.

The one place the demo box is defined. The recorder
(scripts/record_demo_fixtures.py --map) saves the weather tiles and a lattice
of tap points inside it; the web app's "Prepare offline demo" action reads it
from GET /api/map/demo-region to precache basemap and terrain tiles. It is a
demo area, not a place lookup: places are still geocoded.
"""

from __future__ import annotations

import math

from maps import tiles as T

DEMO_REGION = {"name": "Pune–Mumbai–Nashik", "south": 18.2, "west": 72.7, "north": 20.2, "east": 74.3}

# Demo routes recorded for replay (record_demo_fixtures.py --routes). Places are
# geocoded at record time; these are names, not coordinates.
DEMO_ROUTES: tuple[tuple[str, str], ...] = (("Pune", "Mumbai"), ("Mumbai", "Nashik"), ("Pune", "Nashik"))

# Grid steps a view of the region uses between about zoom 8 and zoom 11.
DEMO_STEPS: tuple[float, ...] = (0.08, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.75, 1.0)

# Tap points recorded for replay: every 0.25° (about 28 km).
POINT_STEP = 0.25
# Basemap and terrain zoom levels the web app precaches.
MIN_ZOOM, MAX_ZOOM = 6, 10


def region_tile_keys(step: float, region: dict = DEMO_REGION) -> list[T.TileKey]:
    """Every tile at this step that covers the region (no point limit)."""
    span = T.TILE_POINTS * step
    last = (T.TILE_POINTS - 1) * step
    row0 = math.floor(round(region["south"] / span, 6))
    col0 = math.floor(round(region["west"] / span, 6))
    row1 = max(row0, math.ceil(round((region["north"] - last) / span, 6)))
    col1 = max(col0, math.ceil(round((region["east"] - last) / span, 6)))
    return [(step, r, c) for r in range(row0, row1 + 1) for c in range(col0, col1 + 1)]


def point_lattice(region: dict = DEMO_REGION) -> list[tuple[float, float]]:
    out = []
    lat = region["south"]
    while lat <= region["north"] + 1e-9:
        lon = region["west"]
        while lon <= region["east"] + 1e-9:
            out.append((round(lat, 4), round(lon, 4)))
            lon += POINT_STEP
        lat += POINT_STEP
    return out
