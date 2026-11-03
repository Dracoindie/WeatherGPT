"""
Pydantic models for the WeatherGPT weather response.

Data flow:
  Open-Meteo raw dict → WeatherResponse (validated) → JSON to frontend

All fields are typed; aliases map Open-Meteo's snake_case keys exactly so
Pydantic can parse the API payload with model_validate() directly.
"""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Sub-models
# ---------------------------------------------------------------------------


class Location(BaseModel):
    """Geographic coordinates as resolved by Open-Meteo (may differ slightly
    from the requested point due to grid snapping)."""

    latitude: float = Field(..., description="Latitude in decimal degrees")
    longitude: float = Field(..., description="Longitude in decimal degrees")
    timezone: str = Field(..., description="IANA timezone identifier (e.g. 'Asia/Kolkata')")
    timezone_abbreviation: Optional[str] = Field(
        None, description="Short timezone abbreviation (e.g. 'IST')"
    )


class CurrentWeather(BaseModel):
    """Current (instantaneous) weather conditions."""

    temperature_2m: float = Field(..., description="Air temperature at 2 m (°C)")
    relative_humidity_2m: float = Field(..., description="Relative humidity at 2 m (%)")
    precipitation: float = Field(..., description="Precipitation in the last hour (mm)")
    wind_speed_10m: float = Field(..., description="Wind speed at 10 m (km/h)")
    wind_direction_10m: float = Field(
        ..., description="Direction the wind blows from at 10 m (degrees, 0 = north)"
    )
    weather_code: int = Field(
        ..., description="WMO Weather Interpretation Code (WW code)"
    )
    time: str = Field(..., description="ISO 8601 timestamp of this observation")
    visibility: Optional[float] = Field(None, description="Visibility (m)")
    cloud_cover: Optional[float] = Field(None, description="Total cloud cover (%)")
    wind_gusts_10m: Optional[float] = Field(None, description="Wind gusts at 10 m (km/h)")
    uv_index: Optional[float] = Field(None, description="UV index")
    apparent_temperature: Optional[float] = Field(None, description="Feels-like temperature (°C), from Open-Meteo")


class HourlyWeather(BaseModel):
    """Parallel arrays of hourly forecast data (7 days = 168 entries)."""

    time: list[str] = Field(..., description="ISO 8601 timestamps")
    temperature_2m: list[float] = Field(..., description="Hourly temperature (°C)")
    precipitation_probability: list[Optional[int]] = Field(
        ..., description="Precipitation probability (%)"
    )
    precipitation: list[float] = Field(..., description="Hourly precipitation (mm)")
    wind_speed_10m: list[float] = Field(..., description="Hourly wind speed (km/h)")
    weather_code: list[Optional[int]] = Field(
        ..., description="Hourly WMO Weather Interpretation Code (WW code)"
    )
    relative_humidity_2m: list[Optional[float]] = Field(
        ..., description="Hourly relative humidity at 2 m (%)"
    )
    wind_direction_10m: list[Optional[float]] = Field(
        ..., description="Hourly wind direction at 10 m (degrees the wind blows from)"
    )
    visibility: Optional[list[Optional[float]]] = Field(None, description="Hourly visibility (m)")
    cloud_cover: Optional[list[Optional[float]]] = Field(None, description="Hourly cloud cover (%)")
    wind_gusts_10m: Optional[list[Optional[float]]] = Field(
        None, description="Hourly wind gusts at 10 m (km/h)"
    )
    uv_index: Optional[list[Optional[float]]] = Field(None, description="Hourly UV index")
    apparent_temperature: Optional[list[Optional[float]]] = Field(
        None, description="Hourly feels-like temperature (°C)"
    )


# ---------------------------------------------------------------------------
# Top-level response
# ---------------------------------------------------------------------------


class WeatherResponse(BaseModel):
    """
    Validated weather response returned by GET /api/weather.

    ``source`` is always 'open-meteo' so consumers know the data provenance.
    The LLM layer must treat this object as ground truth and must not override
    any field with its own generated values.
    """

    source: str = Field(default="open-meteo", description="Data source identifier")
    latitude: float = Field(..., description="Resolved latitude")
    longitude: float = Field(..., description="Resolved longitude")
    timezone: str = Field(..., description="IANA timezone")
    retrieved_at: datetime = Field(
        ..., description="UTC timestamp when this response was assembled"
    )
    current: CurrentWeather = Field(..., description="Current weather conditions")
    hourly: HourlyWeather = Field(..., description="7-day hourly forecast")
