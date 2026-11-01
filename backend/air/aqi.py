"""
Indian National Air Quality Index (CPCB method) from PM2.5 and PM10, and the
WHO UV-index bands.

CPCB defines the AQI on 24-hour average concentrations (µg/m³). Open-Meteo
provides modelled PM concentrations (CAMS), so the index here is computed by
WeatherGPT from model data, not a CPCB station reading; replies say so.
"""

from __future__ import annotations

from typing import Optional

# (concentration low, high, index low, high); the top band is open-ended.
PM25_BREAKPOINTS = [
    (0, 30, 0, 50),
    (30, 60, 51, 100),
    (60, 90, 101, 200),
    (90, 120, 201, 300),
    (120, 250, 301, 400),
    (250, 500, 401, 500),
]
PM10_BREAKPOINTS = [
    (0, 50, 0, 50),
    (50, 100, 51, 100),
    (100, 250, 101, 200),
    (250, 350, 201, 300),
    (350, 430, 301, 400),
    (430, 600, 401, 500),
]

AQI_CATEGORIES = [
    (50, "good"),
    (100, "satisfactory"),
    (200, "moderate"),
    (300, "poor"),
    (400, "very_poor"),
    (500, "severe"),
]

UV_CATEGORIES = [(2.99, "low"), (5.99, "moderate"), (7.99, "high"), (10.99, "very_high"), (float("inf"), "extreme")]


def sub_index(concentration: float, breakpoints: list[tuple]) -> int:
    """Linear interpolation inside the CPCB band that holds the concentration."""
    c = max(0.0, concentration)
    for b_lo, b_hi, i_lo, i_hi in breakpoints:
        if c <= b_hi:
            return round(i_lo + (i_hi - i_lo) * (c - b_lo) / (b_hi - b_lo))
    return 500  # beyond the last band


def aqi_category(aqi: int) -> str:
    for upper, name in AQI_CATEGORIES:
        if aqi <= upper:
            return name
    return "severe"


def indian_aqi(pm2_5: Optional[float], pm10: Optional[float]) -> Optional[tuple[int, str, str]]:
    """(AQI, category, dominant pollutant) or None when neither pollutant is known."""
    candidates = []
    if pm2_5 is not None:
        candidates.append((sub_index(pm2_5, PM25_BREAKPOINTS), "pm2_5"))
    if pm10 is not None:
        candidates.append((sub_index(pm10, PM10_BREAKPOINTS), "pm10"))
    if not candidates:
        return None
    value, dominant = max(candidates)
    return value, aqi_category(value), dominant


def uv_category(uv: Optional[float]) -> Optional[str]:
    if uv is None:
        return None
    for upper, name in UV_CATEGORIES:
        if uv <= upper:
            return name
    return "extreme"
