from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse

from climate.service import fetch_historical_weather
from models.climate import ClimateResponse

router = APIRouter()

@router.get("/api/climate", response_model=ClimateResponse)
async def get_climate(
    latitude: float = Query(..., ge=-90.0, le=90.0, description="Latitude in decimal degrees (-90 to 90)"),
    longitude: float = Query(..., ge=-180.0, le=180.0, description="Longitude in decimal degrees (-180 to 180)"),
    start_date: Optional[date] = Query(None, description="Start date YYYY-MM-DD (inclusive)"),
    end_date: Optional[date] = Query(None, description="End date YYYY-MM-DD (inclusive)"),
):
    """Return real daily historical weather for a location.
    If ``start_date``/``end_date`` are omitted, the last 30 days are used.
    The maximum allowed range is 365 days.
    """
    today = datetime.utcnow().date()
    if end_date is None:
        end_date = today
    if start_date is None:
        start_date = end_date - timedelta(days=30)
    if (end_date - start_date).days < 0:
        raise HTTPException(status_code=400, detail="start_date must be before end_date")
    if (end_date - start_date).days > 365:
        raise HTTPException(status_code=400, detail="Date range cannot exceed 365 days")
    try:
        response: ClimateResponse = await fetch_historical_weather(
            latitude, longitude, start_date.isoformat(), end_date.isoformat()
        )
        return response
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
