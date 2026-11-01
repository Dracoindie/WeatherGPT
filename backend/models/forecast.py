from datetime import datetime, date
from typing import List, Optional

from pydantic import BaseModel, Field


class DailyForecast(BaseModel):
    """One day's forecast data from Open-Meteo daily fields."""

    date_: date = Field(..., alias="date", description="Date of the forecast")
    weather_code: int = Field(..., description="WMO weather code")
    max_temperature: Optional[float] = Field(
        None, description="Maximum temperature (°C)"
    )
    min_temperature: Optional[float] = Field(
        None, description="Minimum temperature (°C)"
    )
    precipitation_sum: Optional[float] = Field(
        None, description="Total precipitation (mm)"
    )
    precipitation_probability_max: Optional[int] = Field(
        None, description="Maximum probability of precipitation (%)"
    )
    max_wind_speed: Optional[float] = Field(
        None, description="Maximum wind speed (km/h)"
    )


class ForecastResponse(BaseModel):
    """Response model for GET /api/forecast."""

    source: str = Field(default="open-meteo", description="Data source identifier")
    latitude: float = Field(..., description="Resolved latitude")
    longitude: float = Field(..., description="Resolved longitude")
    timezone: str = Field(..., description="IANA timezone")
    retrieved_at: datetime = Field(..., description="UTC timestamp when this response was assembled")
    daily: List[DailyForecast] = Field(..., description="List of daily forecasts")
