from datetime import date as DateType
from typing import List, Optional

from pydantic import BaseModel, Field

class HistoricalDaily(BaseModel):
    """Aggregated daily historical weather values."""
    date_: DateType = Field(..., alias="date", description="ISO date (YYYY-MM-DD)")
    temperature_max: Optional[float] = Field(None, description="Maximum temperature (°C)")
    temperature_min: Optional[float] = Field(None, description="Minimum temperature (°C)")
    precipitation_sum: Optional[float] = Field(None, description="Total precipitation (mm)")

class ClimateResponse(BaseModel):
    """Response model for historical climate data."""
    source: str = Field(default="open-meteo", description="Data source identifier")
    latitude: float = Field(..., description="Resolved latitude")
    longitude: float = Field(..., description="Resolved longitude")
    timezone: str = Field(..., description="IANA timezone of the location")
    generation_time: float = Field(..., description="Time taken (seconds) to fetch and process data")
    daily: List[HistoricalDaily] = Field(..., description="List of daily historical records")
