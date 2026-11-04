"""
Deterministic Weather Alert & Early Warning Evaluation Engine.

Levels come from alerts/scoring.py, the one scorer shared with the hazard map,
applied to the place's Open-Meteo forecast for the 24 h starting at the
current hour (plus the model's current values). This module only turns each
hazard's highest firing rule into an alert with its text. No AI, no
unvalidated claims: every number in an alert is the measured/forecast value or
the rule's threshold from thresholds.py.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Callable, List, Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from alerts.scoring import WINDOW_HOURS, Current, Hit, score, window_facts
from models.alerts import WeatherAlert
from models.weather import WeatherResponse
from window_rule import utc_instant, window_start

# Alert order on every surface (unchanged from before the shared scorer).
_ORDER = ("rain", "heat", "cold", "wind", "storm")


def utc_offset_seconds(weather: WeatherResponse) -> int:
    """The place's UTC offset: Open-Meteo's own, else from the IANA zone."""
    if weather.utc_offset_seconds is not None:
        return weather.utc_offset_seconds
    try:
        off = datetime.now(ZoneInfo(weather.timezone)).utcoffset()
    except (ZoneInfoNotFoundError, ValueError):
        return 0
    return int(off.total_seconds()) if off else 0


def current_hour_index(weather: WeatherResponse) -> int:
    """Index of the current local hour in the hourly series (Open-Meteo starts
    at local midnight). The rule is window_rule.window_start, shared with the
    hazard map, the grid layers and routes."""
    off = utc_offset_seconds(weather)
    try:
        instants = [utc_instant(t, off) for t in weather.hourly.time or []]
        model_now = utc_instant(weather.current.time, off) if weather.current.time else None
    except ValueError:
        return 0
    return window_start(instants, off, model_now=model_now)


def assess(weather: WeatherResponse) -> dict[str, Optional[Hit]]:
    """Each hazard's highest firing rule for the next 24 h at this place."""
    h, c = weather.hourly, weather.current
    facts = window_facts(
        temperature=h.temperature_2m,
        humidity=h.relative_humidity_2m,
        precipitation=h.precipitation,
        wind_speed=h.wind_speed_10m,
        weather_code=h.weather_code,
        start=current_hour_index(weather),
        hours=WINDOW_HOURS,
        current=Current(c.temperature_2m, c.relative_humidity_2m, c.precipitation, c.wind_speed_10m, c.weather_code),
    )
    return score(facts)


# (condition, headline, description, recommended action), keyed by rule id.
Text = tuple[str, Callable[[float], str], Callable[[float, float], str], str]

_TEXT: dict[str, Text] = {
    "heavy_rain": (
        "Heavy Rain Watch",
        lambda v: f"Watch: Heavy rain ({v:.1f} mm) anticipated",
        lambda v, t: f"Precipitation of {v:.1f} mm exceeds the heavy rainfall threshold of {t} mm. Expect wet surfaces and reduced visibility.",
        "Keep an umbrella handy, allow extra commute time, and inspect drainage channels.",
    ),
    "extreme_rain": (
        "Extreme Rain / Flood Risk",
        lambda v: f"Warning: Extreme rainfall ({v:.1f} mm) recorded/forecasted",
        lambda v, t: f"Significant precipitation of {v:.1f} mm exceeds the extreme safety threshold of {t} mm. High risk of waterlogging, local flooding, and dangerous road conditions.",
        "Avoid non-essential travel, stay away from low-lying areas and storm drains, and secure waterproof gear.",
    ),
    "very_heavy_rain": (
        "Very Heavy Rain / Severe Flood Risk",
        lambda v: f"Severe: Very heavy rainfall ({v:.1f} mm) forecast",
        lambda v, t: f"Precipitation of {v:.1f} mm reaches the very heavy rainfall level of {t} mm. Flooding of roads and low-lying areas is likely.",
        "Do not travel unless essential, move away from low-lying areas and drains, and follow local authority instructions.",
    ),
    "high_heat": (
        "High Temperature Advisory",
        lambda v: f"Advisory: High temperatures ({v:.1f}°C)",
        lambda v, t: f"Temperatures reaching {v:.1f}°C meet or exceed the elevated heat threshold of {t}°C.",
        "Drink plenty of fluids, wear lightweight clothing, and limit strenuous outdoor activities in direct sun.",
    ),
    "extreme_heat": (
        "Extreme Heat Warning",
        lambda v: f"Warning: Dangerous heat ({v:.1f}°C) detected",
        lambda v, t: f"Ambient temperatures reaching {v:.1f}°C surpass the critical heat threshold of {t}°C. Elevated risk of heat exhaustion and heatstroke.",
        "Stay hydrated, remain in cool indoor environments during peak afternoon hours, and check on vulnerable individuals.",
    ),
    "severe_heat": (
        "Severe Heat",
        lambda v: f"Severe: Extreme temperatures ({v:.1f}°C)",
        lambda v, t: f"Temperatures reaching {v:.1f}°C are at or above the severe heat level of {t}°C. Heatstroke is likely without protection.",
        "Avoid all outdoor work in the day, stay in the coolest place available, drink water often, and check on vulnerable people.",
    ),
    "heat_stress": (
        "Heat Stress Watch",
        lambda v: f"Watch: Heat stress (heat index {v:.1f}°C)",
        lambda v, t: f"Heat and humidity give a heat index of {v:.1f}°C, at or above the danger level of {t}°C (in shade; full sun feels hotter).",
        "Move heavy outdoor work to early morning, rest in shade often, and drink water regularly.",
    ),
    "extreme_heat_stress": (
        "Extreme Heat Stress Warning",
        lambda v: f"Warning: Extreme heat stress (heat index {v:.1f}°C)",
        lambda v, t: f"Heat and humidity give a heat index of {v:.1f}°C, at or above the extreme danger level of {t}°C. Heatstroke is likely.",
        "Stop outdoor work that can wait, stay in shade or indoors, and watch for signs of heatstroke.",
    ),
    "cold": (
        "Cold Weather Advisory",
        lambda v: f"Advisory: Chilly conditions ({v:.1f}°C)",
        lambda v, t: f"Temperatures dropping to {v:.1f}°C meet the cold weather advisory threshold ({t}°C).",
        "Dress in warm layers, protect pets from prolonged exposure, and guard against hypothermia.",
    ),
    "strong_wind": (
        "Strong Wind Watch",
        lambda v: f"Watch: Strong winds ({v:.1f} km/h)",
        lambda v, t: f"Wind velocities of {v:.1f} km/h exceed the high wind threshold of {t} km/h.",
        "Hold doors firmly, secure loose light items, and exercise caution on elevated bridges.",
    ),
    "gale": (
        "Gale / High Wind Warning",
        lambda v: f"Warning: Damaging wind gusts ({v:.1f} km/h)",
        lambda v, t: f"Wind speeds reaching {v:.1f} km/h cross the severe storm wind threshold of {t} km/h. Risk of falling branches and structural hazards.",
        "Secure outdoor furniture, avoid parking under trees, and drive with extreme caution.",
    ),
    "storm_force_wind": (
        "Storm-Force Wind",
        lambda v: f"Severe: Storm-force winds ({v:.1f} km/h)",
        lambda v, t: f"Wind speeds reaching {v:.1f} km/h are at or above the storm-force level of {t} km/h. Trees and weak structures may fall.",
        "Stay indoors away from windows, do not drive, and keep clear of trees, hoardings and power lines.",
    ),
    "thunderstorm": (
        "Thunderstorm Activity Detected",
        lambda v: "Thunderstorm Watch",
        lambda v, t: f"Verified WMO weather code {int(v)} indicates active convective thunderstorm in the immediate area.",
        "Seek immediate sturdy indoor shelter. Avoid open fields, metal fences, and water bodies. Unplug sensitive electrical equipment.",
    ),
    "thunderstorm_hail": (
        "Thunderstorm Activity Detected",
        lambda v: "Active Thunderstorm / Lightning Warning",
        lambda v, t: f"Verified WMO weather code {int(v)} indicates active convective thunderstorm and hail in the immediate area.",
        "Seek immediate sturdy indoor shelter. Avoid open fields, metal fences, and water bodies. Unplug sensitive electrical equipment.",
    ),
    "thunderstorm_heavy_hail": (
        "Severe Thunderstorm with Heavy Hail",
        lambda v: "Severe: Thunderstorm with heavy hail",
        lambda v, t: f"Verified WMO weather code {int(v)} indicates a thunderstorm with heavy hail in the immediate area.",
        "Stay indoors away from windows, protect vehicles if safe to do so, and avoid open ground until it passes.",
    ),
}

_PARAMETER = {"precipitation": "precipitation", "temperature": "temperature", "wind_speed": "wind_speed", "heat_index": "heat_index", "weather_code": "weather_code"}


def _alert(hit: Hit, now: datetime) -> WeatherAlert:
    rule = hit.rule
    condition, headline, description, action = _TEXT[rule.id]
    threshold = rule.value
    return WeatherAlert(
        id=f"alert-{rule.hazard}-{rule.level}-{int(now.timestamp())}",
        alert_type=rule.hazard,
        severity=rule.level,
        condition=condition,
        headline=headline(hit.value),
        description=description(hit.value, threshold),
        recommended_action=action,
        relevant_parameter=_PARAMETER[rule.parameter],
        relevant_value=round(hit.value, 1),
        threshold_value=threshold,
        unit=rule.unit,
        time_window="Current" if rule.parameter == "weather_code" else f"Next {WINDOW_HOURS} hours",
        source="open-meteo",
        created_at=now,
    )


def evaluate_alerts(weather: WeatherResponse) -> List[WeatherAlert]:
    """One alert per hazard whose rules fire in the next 24 h (highest level only)."""
    now = datetime.now(timezone.utc)
    hits = assess(weather)
    return [_alert(hits[h], now) for h in _ORDER if hits.get(h) is not None]
