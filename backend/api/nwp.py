import logging
from fastapi import APIRouter, HTTPException, Query
from nwp.service import get_nwp_forecast
from nwp.models import NwpResponse

router = APIRouter(prefix="/api/nwp", tags=["NWP"])

@router.get("", response_model=NwpResponse)
async def nwp_endpoint(
    latitude: float = Query(..., ge=-90.0, le=90.0),
    longitude: float = Query(..., ge=-180.0, le=180.0),
    hours: int = Query(24, ge=1, le=48),
) -> NwpResponse:
    """Return GFS (NOMADS) forecast for a point.
    Parameters
    ----------
    latitude, longitude: location in decimal degrees.
    hours: number of forecast hours (default 24, max 48).
    """
    try:
        return await get_nwp_forecast(latitude, longitude, hours)
    except Exception as exc:
        logger = logging.getLogger(__name__)
        logger.error("NWP service error: %s", exc)
        raise HTTPException(status_code=502, detail="NWP data temporarily unavailable") from exc
