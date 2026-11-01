"""
Pydantic models for the WeatherGPT chat endpoint.

The LLM layer MUST treat WeatherFacts as ground truth and MUST NOT
invent or override numerical values, locations, or alerts.
"""

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


IntentType = Literal["current_weather", "forecast", "unknown"]
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
    "general",
]
ResponseLanguage = Literal["en", "hi", "hinglish"]
LocationSource = Literal[
    "explicit_query",
    "request_coordinates",
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
    relative_humidity_2m: Optional[float] = None
    weather_code: Optional[int] = None
    weather_description: Optional[str] = None
    period_available: bool = True


class ResolvedLocation(BaseModel):
    """Coordinates actually used for the weather lookup."""

    name: str
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    source: LocationSource


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


class ChatResponse(BaseModel):
    """Grounded conversational weather response."""

    message: str
    intent: ChatIntent
    location: Optional[ResolvedLocation] = None
    weather: Optional[WeatherFacts] = None
    advisory: Optional[AdvisoryResult] = None
    source: str = Field(default="open-meteo")
