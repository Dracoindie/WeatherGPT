"""Response models for the role endpoints (farmer, aviation, disaster manager, researcher)."""

from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field

GUIDANCE_NOTE = (
    "Guidance computed from Open-Meteo forecast thresholds by WeatherGPT; "
    "not an official IMD / agro-met / aviation product."
)

# ---------------------------------------------------------------------------
# Farmer
# ---------------------------------------------------------------------------


class SprayWindow(BaseModel):
    start: str = Field(..., description="Local ISO hour")
    end: str = Field(..., description="Local ISO hour (inclusive)")
    hours: int
    max_wind_kmh: float
    max_temperature_c: float


class FarmDay(BaseModel):
    date: str
    precipitation_mm: float
    max_precipitation_probability: Optional[int] = None
    max_wind_kmh: float
    max_temperature_c: float
    harvest: Literal["good", "avoid"]
    reasons: list[str] = Field(default_factory=list)


class IrrigationAdvice(BaseModel):
    status: Literal["skip", "delay", "needed", "as_usual"]
    rain_next_48h_mm: float
    max_precipitation_probability_24h: Optional[int] = None
    max_temperature_48h_c: float
    reason: str


class SowingAdvice(BaseModel):
    status: Literal["favourable", "dry", "wait"]
    rain_next_72h_mm: float
    max_daily_rain_mm: float
    reason: str


class FarmAdvice(BaseModel):
    source: str = "open-meteo"
    latitude: float
    longitude: float
    timezone: str
    generated_at: datetime
    spray_windows: list[SprayWindow]
    irrigation: IrrigationAdvice
    harvest_days: list[FarmDay]
    sowing: SowingAdvice
    thresholds: dict[str, float]
    note: str = GUIDANCE_NOTE


# ---------------------------------------------------------------------------
# Aviation
# ---------------------------------------------------------------------------


class AviationBriefing(BaseModel):
    source: str = "open-meteo"
    latitude: float
    longitude: float
    timezone: str
    generated_at: datetime
    observation_time: str
    visibility_km: Optional[float] = None
    visibility_band: Optional[Literal["good", "moderate", "poor", "very_poor"]] = None
    cloud_cover_percent: Optional[float] = None
    wind_kmh: float
    wind_kt: float
    wind_direction_deg: float
    gust_kmh: Optional[float] = None
    gust_kt: Optional[float] = None
    precipitation_mm: float
    weather_code: int
    weather_description: Optional[str] = None
    next_hours: int
    next_min_visibility_km: Optional[float] = None
    next_max_gust_kmh: Optional[float] = None
    next_max_wind_kmh: float
    next_precipitation_mm: float
    next_max_weather_code: Optional[int] = None
    flags: list[str] = Field(default_factory=list)
    thresholds: dict[str, float]
    note: str = GUIDANCE_NOTE


# ---------------------------------------------------------------------------
# Disaster manager
# ---------------------------------------------------------------------------


class DistrictIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)


class RiskRequest(BaseModel):
    districts: list[DistrictIn] = Field(..., min_length=1, max_length=40)


RiskLevel = Literal["warning", "watch", "advisory", "none", "unknown"]


class DistrictRisk(BaseModel):
    name: str
    latitude: float
    longitude: float
    severity: RiskLevel
    alerts_count: int = 0
    headline: Optional[str] = None
    rain_24h_mm: Optional[float] = None
    max_wind_24h_kmh: Optional[float] = None
    max_temperature_24h_c: Optional[float] = None
    error: Optional[str] = None


class RiskBoard(BaseModel):
    source: str = "open-meteo"
    generated_at: datetime
    districts: list[DistrictRisk] = Field(..., description="Sorted, most severe first")
    note: str = GUIDANCE_NOTE


# ---------------------------------------------------------------------------
# Researcher
# ---------------------------------------------------------------------------


class CompareRow(BaseModel):
    valid_time_utc: str
    open_meteo_temperature_c: Optional[float] = None
    gfs_temperature_c: Optional[float] = None
    open_meteo_precipitation_mm: Optional[float] = None
    gfs_precipitation_mm: Optional[float] = None
    open_meteo_wind_kmh: Optional[float] = None
    gfs_wind_kmh: Optional[float] = None


class CompareStats(BaseModel):
    pairs: int
    temperature_bias_c: Optional[float] = Field(None, description="mean(GFS - Open-Meteo)")
    temperature_mae_c: Optional[float] = None
    wind_bias_kmh: Optional[float] = None
    wind_mae_kmh: Optional[float] = None
    open_meteo_precipitation_total_mm: Optional[float] = None
    gfs_precipitation_total_mm: Optional[float] = None


class ModelComparison(BaseModel):
    latitude: float
    longitude: float
    timezone: str
    gfs_run: str
    generated_at: datetime
    rows: list[CompareRow]
    stats: CompareStats
    note: str = (
        "Both are model output for the same valid hours: GFS 0.25° from NOAA NOMADS and the "
        "Open-Meteo best-match blend. Differences are not errors against observations."
    )
