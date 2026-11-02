"""
GET /api/geocode?q=<place>: a place name to coordinates, through the shared
Nominatim client (1 request/second, in-memory + persistent cache).

The browser never calls Nominatim directly, so the rate limit and the cache
hold for every user. Used by the /disaster board to resolve district names.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from geocoding import geocode_place

logger = logging.getLogger(__name__)

router = APIRouter(tags=["geocoding"])


class GeocodeResult(BaseModel):
    query: str
    name: str
    latitude: float
    longitude: float


@router.get(
    "/api/geocode",
    response_model=GeocodeResult,
    responses={404: {"description": "No place found"}, 503: {"description": "Location service unavailable"}},
)
async def geocode(q: str = Query(..., min_length=1, max_length=160)) -> GeocodeResult:
    query = q.strip()
    if not query:
        raise HTTPException(status_code=422, detail="Empty place name.")
    try:
        geo = await geocode_place(query)
    except RuntimeError as exc:
        logger.warning("Geocode endpoint: location service down: %s", exc)
        raise HTTPException(status_code=503, detail="Location service is temporarily unavailable.") from exc
    if geo is None:
        raise HTTPException(status_code=404, detail=f'No place found for "{query}".')
    return GeocodeResult(query=query, name=geo.name, latitude=geo.latitude, longitude=geo.longitude)
