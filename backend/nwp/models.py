from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime

class NwpMetadata(BaseModel):
    model: str = Field(..., description="Model name, e.g., GFS")
    generationTime: str = Field(..., description="ISO timestamp when data was generated")
    latitude: float = Field(..., description="Requested latitude")
    longitude: float = Field(..., description="Requested longitude")

class NwpForecast(BaseModel):
    hour: int = Field(..., description="Forecast hour offset from generation time")
    temperatureC: float = Field(..., description="2‑meter temperature in Celsius")
    precipitationMm: float = Field(..., description="Hourly precipitation in mm")
    windMs: float = Field(..., description="10‑meter wind speed in m/s")

class NwpResponse(BaseModel):
    metadata: NwpMetadata = Field(..., description="Metadata about the model source")
    forecasts: List[NwpForecast] = Field(..., description="Hourly forecast entries")
    retrievedAt: Optional[datetime] = Field(None, description="When this GFS data was fetched from NOMADS (UTC)")
    stale: bool = Field(False, description="True when NOMADS failed and this is the last good result")
    staleReason: Optional[str] = Field(None, description="Why fresh GFS data could not be fetched (when stale)")
