"""
Pydantic models for the WeatherGPT chat endpoint.

The LLM layer MUST treat WeatherFacts as ground truth and MUST NOT
invent or override numerical values, locations, or alerts.
"""

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


# climate: historical comparison (Open-Meteo archive). nwp: raw GFS model output.
IntentType = Literal["current_weather", "forecast", "climate", "nwp", "unknown"]
ClimatePeriod = Literal["last_30_days", "this_month", "this_year"]
DateReference = Literal[
    "now",
    "today",
    "tomorrow",
    "day_after_tomorrow",
    "tonight",
    "this_afternoon",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
]
WEEKDAYS: tuple[DateReference, ...] = (
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
)
WeatherParameter = Literal[
    "temperature",
    "high_temperature",
    "precipitation",
    "heavy_rain",
    "rain_likelihood",
    "wind",
    "strong_wind",
    "storm",
    "humidity",
    "advisory",
    "air_quality",
    "uv",
    "general",
]
ResponseLanguage = Literal["en", "hi", "hinglish", "mr"]
# Who is asking: changes what the reply emphasises, never the numbers.
UserRole = Literal["citizen", "farmer", "aviation", "disaster_manager", "researcher"]
LocationSource = Literal[
    "explicit_query",
    "request_coordinates",
    "conversation_context",
    "trusted_user_default",
]


class ChatIntent(BaseModel):
    """Structured understanding of the user's weather question."""

    intent: IntentType = "current_weather"
    location_name: Optional[str] = Field(
        None, description="Place name extracted from the query, if any"
    )
    date_reference: DateReference = "now"
    weather_parameter: WeatherParameter = "general"
    language: ResponseLanguage = "en"
    climate_period: Optional[ClimatePeriod] = Field(
        None, description="Window compared with past years (climate intent only)"
    )


class AdvisoryResult(BaseModel):
    """Deterministic weather intelligence advisory."""
    
    severity: Literal["low", "moderate", "high"]
    condition: str
    advisory: str
    reasons: list[str]


class WeatherFacts(BaseModel):
    """
    Verified weather values selected from Open-Meteo.

    These numbers are the only meteorological facts allowed in the reply.
    """

    source: str = Field(default="open-meteo")
    location: str
    requested_time: str
    timezone: str
    temperature_2m: Optional[float] = None
    temperature_min: Optional[float] = None
    temperature_max: Optional[float] = None
    precipitation: Optional[float] = None
    precipitation_probability: Optional[int] = None
    wind_speed_10m: Optional[float] = None
    wind_direction_10m: Optional[float] = Field(
        None, description="Degrees the wind blows from (0 = north), at the peak-wind hour"
    )
    relative_humidity_2m: Optional[float] = None
    wind_gusts_10m: Optional[float] = Field(None, description="km/h; peak gust over the period")
    visibility: Optional[float] = Field(None, description="km; lowest over the period")
    cloud_cover: Optional[float] = Field(None, description="%; mean over the period")
    uv_index: Optional[float] = Field(None, description="UV index; current or peak over the period")
    pm2_5: Optional[float] = Field(None, description="µg/m³ mean (trailing 24 h for now)")
    pm10: Optional[float] = Field(None, description="µg/m³ mean (trailing 24 h for now)")
    aqi: Optional[int] = Field(None, description="Indian AQI (CPCB method) computed from modelled PM")
    aqi_category: Optional[str] = None
    aqi_dominant: Optional[str] = None
    weather_code: Optional[int] = None
    weather_description: Optional[str] = None
    period_available: bool = True


class ClimateFacts(BaseModel):
    """
    Recent period vs the same calendar window in earlier years (Open-Meteo
    archive). Every number is computed from archive daily values.
    """

    source: str = Field(default="open-meteo-archive")
    location: str
    timezone: str
    period: ClimatePeriod
    period_start: str
    period_end: str
    baseline_start_year: int
    baseline_end_year: int
    baseline_years: int = Field(..., description="Years with data in the baseline")
    days_with_data: int
    mean_temperature_max: Optional[float] = None
    mean_temperature_min: Optional[float] = None
    total_precipitation: Optional[float] = None
    baseline_mean_temperature_max: Optional[float] = None
    baseline_mean_temperature_min: Optional[float] = None
    baseline_total_precipitation: Optional[float] = None
    temperature_max_anomaly: Optional[float] = Field(None, description="°C, recent minus baseline")
    temperature_min_anomaly: Optional[float] = None
    precipitation_anomaly_percent: Optional[int] = None
    available: bool = True


class NwpFacts(BaseModel):
    """GFS model output summarised over the requested window (NOAA NOMADS)."""

    source: str = Field(default="gfs-nomads")
    model: str = "GFS"
    run: str = Field(..., description="Model run (cycle) time, UTC ISO")
    location: str
    requested_time: str
    timezone: str
    hours: int = Field(..., description="Forecast hours inside the window")
    temperature_min: Optional[float] = None
    temperature_max: Optional[float] = None
    precipitation: Optional[float] = Field(None, description="Total over the window, mm")
    wind_speed_max: Optional[float] = Field(None, description="km/h, converted from m/s")
    period_available: bool = True


class ResolvedLocation(BaseModel):
    """Coordinates actually used for the weather lookup."""

    name: str
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    source: LocationSource


class ChatContext(BaseModel):
    """
    Slots from the previous answer, sent back by the client so follow-ups
    ("aur parso?", "what about Mumbai?") can fill what they leave out.
    Coordinates here are ones the server itself resolved and returned.
    """

    model_config = ConfigDict(extra="ignore")

    intent: Optional[IntentType] = None
    location_name: Optional[str] = Field(None, max_length=200)
    latitude: Optional[float] = Field(None, ge=-90, le=90)
    longitude: Optional[float] = Field(None, ge=-180, le=180)
    date_reference: Optional[DateReference] = None
    weather_parameter: Optional[WeatherParameter] = None
    climate_period: Optional[ClimatePeriod] = None


class ChatRequest(BaseModel):
    """
    Incoming chat request.

    Identity: ``user_id`` is ignored if sent. Default location is never
    taken from the body. Optional ``latitude``/``longitude`` are the
    caller's own request-time coordinates (e.g. GPS for this query).
    """

    model_config = ConfigDict(extra="ignore")

    message: str = Field(..., min_length=1, max_length=2000)
    latitude: Optional[float] = Field(None, ge=-90, le=90)
    longitude: Optional[float] = Field(None, ge=-180, le=180)
    context: Optional[ChatContext] = None
    role: UserRole = "citizen"


class ChatResponse(BaseModel):
    """Grounded conversational weather response."""

    message: str
    intent: ChatIntent
    location: Optional[ResolvedLocation] = None
    weather: Optional[WeatherFacts] = None
    climate: Optional[ClimateFacts] = None
    nwp: Optional[NwpFacts] = None
    advisory: Optional[AdvisoryResult] = None
    source: str = Field(default="open-meteo")
