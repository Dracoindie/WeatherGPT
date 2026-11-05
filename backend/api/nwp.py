"""
GET /api/nwp: NOAA GFS 0.25 deg for a point (nwp/service.py).

NOMADS is slow and throttles bursts. The service caches each result for an
hour and keeps it as "last good" for a day:
- NOMADS fails, last good result available: 200 with ``stale: true`` and
  ``staleReason``;
- NOMADS fails, nothing cached: 503 "GFS model temporarily unavailable" with
  the reason (never a raw upstream error).
"""

import logging

from fastapi import APIRouter, HTTPException, Query

from nwp.models import NwpResponse
from nwp.service import NwpUnavailable, get_nwp_forecast

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/nwp", tags=["NWP"])

UNAVAILABLE = "GFS model temporarily unavailable"


@router.get("", response_model=NwpResponse, responses={503: {"description": UNAVAILABLE}})
async def nwp_endpoint(
    latitude: float = Query(..., ge=-90.0, le=90.0),
    longitude: float = Query(..., ge=-180.0, le=180.0),
    hours: int = Query(24, ge=1, le=48),
) -> NwpResponse:
    """Return GFS (NOMADS) forecast for a point, the next ``hours`` hours (max 48)."""
    try:
        return await get_nwp_forecast(latitude, longitude, hours)
    except NwpUnavailable as exc:
        raise HTTPException(status_code=503, detail=f"{UNAVAILABLE}: {exc.reason}.") from exc
