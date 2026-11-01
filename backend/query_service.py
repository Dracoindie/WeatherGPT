"""
Select verified weather values from the existing Open-Meteo fetch.

Does not call Open-Meteo itself — uses weather.open_meteo.fetch_weather.
Temporal windows are computed here; the LLM must not invent dates.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from models.chat import WEEKDAYS, ChatIntent, DateReference, WeatherFacts, WeatherParameter
from models.weather import CurrentWeather, HourlyWeather, WeatherResponse
from weather.open_meteo import fetch_weather

WMO_DESCRIPTIONS: dict[int, str] = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Depositing rime fog",
    51: "Light drizzle",
    53: "Drizzle",
    55: "Dense drizzle",
    56: "Light freezing drizzle",
    57: "Dense freezing drizzle",
    61: "Light rain",
    63: "Rain",
    65: "Heavy rain",
    66: "Light freezing rain",
    67: "Heavy freezing rain",
    71: "Light snow",
    73: "Snow",
    75: "Heavy snow",
    77: "Snow grains",
    80: "Light rain showers",
    81: "Rain showers",
    82: "Heavy rain showers",
    85: "Light snow showers",
    86: "Heavy snow showers",
    95: "Thunderstorm",
    96: "Thunderstorm with slight hail",
    99: "Thunderstorm with heavy hail",
}


def weather_code_description(code: Optional[int]) -> Optional[str]:
    if code is None:
        return None
    return WMO_DESCRIPTIONS.get(code, f"Weather code {code}")


def _zone(tz_name: str) -> ZoneInfo:
    try:
        return ZoneInfo(tz_name)
    except ZoneInfoNotFoundError:
        return ZoneInfo("UTC")


def _parse_local(ts: str, tz: ZoneInfo) -> datetime:
    # Open-Meteo hourly times are local wall times when timezone=auto.
    if ts.endswith("Z"):
        return datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone(tz)
    dt = datetime.fromisoformat(ts)
    if dt.tzinfo is None:
        return dt.replace(tzinfo=tz)
    return dt.astimezone(tz)


def _label(date_ref: DateReference) -> str:
    if date_ref in WEEKDAYS:
        return date_ref.capitalize()
    return {
        "now": "now",
        "today": "today",
        "tomorrow": "tomorrow",
        "day_after_tomorrow": "day after tomorrow",
        "tonight": "tonight",
        "this_afternoon": "this afternoon",
    }[date_ref]


def _target_date(date_ref: DateReference, today: date) -> date:
    """Local calendar day a date reference points at."""
    if date_ref == "tomorrow":
        return today + timedelta(days=1)
    if date_ref == "day_after_tomorrow":
        return today + timedelta(days=2)
    if date_ref in WEEKDAYS:
        # Next occurrence, counting today: "Friday" asked on a Friday is today.
        return today + timedelta(days=(WEEKDAYS.index(date_ref) - today.weekday()) % 7)
    return today


# "Tonight" runs from 20:00 until the early hours of the next morning.
TONIGHT_START_HOUR = 20
TONIGHT_END_HOUR = 6  # exclusive, next day


def _hour_in_window(dt: datetime, now: datetime, date_ref: DateReference) -> bool:
    if date_ref == "now":
        return False
    target = _target_date(date_ref, now.date())
    if date_ref == "tonight":
        return (dt.date() == target and dt.hour >= TONIGHT_START_HOUR) or (
            dt.date() == target + timedelta(days=1) and dt.hour < TONIGHT_END_HOUR
        )
    if date_ref == "this_afternoon":
        return dt.date() == target and 12 <= dt.hour <= 17
    return dt.date() == target


def _use_current(intent: ChatIntent) -> bool:
    return intent.intent == "current_weather" and intent.date_reference in {"now", "today"}


async def fetch_validated_weather(latitude: float, longitude: float) -> WeatherResponse:
    raw = await fetch_weather(latitude, longitude)
    current = CurrentWeather(**raw["current"])
    hourly = HourlyWeather(**raw["hourly"])
    return WeatherResponse(
        latitude=raw["latitude"],
        longitude=raw["longitude"],
        timezone=raw["timezone"],
        retrieved_at=datetime.now(tz=_zone(raw["timezone"])),
        current=current,
        hourly=hourly,
    )


def select_period_facts(
    weather: WeatherResponse,
    intent: ChatIntent,
    location_name: str,
) -> WeatherFacts:
    """All verified values for the requested period, before focusing on a parameter."""
    tz = _zone(weather.timezone)
    now = datetime.now(tz)
    requested = _label(intent.date_reference)

    if _use_current(intent) or intent.date_reference == "now":
        current = weather.current
        facts = WeatherFacts(
            source="open-meteo",
            location=location_name,
            requested_time=f"{requested} ({current.time})",
            timezone=weather.timezone,
            temperature_2m=current.temperature_2m,
            precipitation=current.precipitation,
            wind_speed_10m=current.wind_speed_10m,
            relative_humidity_2m=current.relative_humidity_2m,
            weather_code=current.weather_code,
            weather_description=weather_code_description(current.weather_code),
            period_available=True,
        )
    else:
        times = weather.hourly.time
        temps = weather.hourly.temperature_2m
        probs = weather.hourly.precipitation_probability
        precs = weather.hourly.precipitation
        winds = weather.hourly.wind_speed_10m
        codes = weather.hourly.weather_code
        hums = weather.hourly.relative_humidity_2m

        indexes = [
            i
            for i, ts in enumerate(times)
            if _hour_in_window(_parse_local(ts, tz), now, intent.date_reference)
        ]
        if not indexes:
            return WeatherFacts(
                source="open-meteo",
                location=location_name,
                requested_time=requested,
                timezone=weather.timezone,
                period_available=False,
            )

        sel_temps = [temps[i] for i in indexes if temps[i] is not None]
        sel_probs = [probs[i] for i in indexes if probs[i] is not None]
        sel_precs = [precs[i] for i in indexes if precs[i] is not None]
        sel_winds = [winds[i] for i in indexes if winds[i] is not None]
        sel_codes = [codes[i] for i in indexes if codes[i] is not None]
        sel_hums = [hums[i] for i in indexes if hums[i] is not None]

        start = times[indexes[0]]
        end = times[indexes[-1]]
        # Representative temperature: midday hour if present, else mean.
        midday = None
        for i in indexes:
            if _parse_local(times[i], tz).hour == 15:
                midday = temps[i]
                break
        representative = midday if midday is not None else (sum(sel_temps) / len(sel_temps) if sel_temps else None)

        max_prob = max(int(p) for p in sel_probs) if sel_probs else None
        # WMO codes grow with significance, so the max is the period's headline weather.
        code = max(sel_codes) if sel_codes else None

        facts = WeatherFacts(
            source="open-meteo",
            location=location_name,
            requested_time=f"{requested} ({start} to {end})",
            timezone=weather.timezone,
            temperature_2m=round(representative, 1) if representative is not None else None,
            temperature_min=round(min(sel_temps), 1) if sel_temps else None,
            temperature_max=round(max(sel_temps), 1) if sel_temps else None,
            precipitation=round(sum(sel_precs), 1) if sel_precs else None,
            precipitation_probability=int(max_prob) if max_prob is not None else None,
            wind_speed_10m=round(max(sel_winds), 1) if sel_winds else None,
            relative_humidity_2m=round(sum(sel_hums) / len(sel_hums), 1) if sel_hums else None,
            weather_code=code,
            weather_description=weather_code_description(code),
            period_available=True,
        )

    return facts


# Facts each parameter hides so the reply stays on topic.
_FOCUS_DROPS: dict[WeatherParameter, tuple[str, ...]] = {
    "temperature": ("precipitation", "precipitation_probability", "wind_speed_10m"),
    "high_temperature": ("precipitation", "precipitation_probability", "wind_speed_10m"),
    "precipitation": ("wind_speed_10m", "relative_humidity_2m"),
    "heavy_rain": ("wind_speed_10m", "relative_humidity_2m"),
    "rain_likelihood": ("wind_speed_10m", "relative_humidity_2m"),
    "wind": ("precipitation", "precipitation_probability", "relative_humidity_2m"),
    "strong_wind": ("precipitation", "precipitation_probability", "relative_humidity_2m"),
    "storm": ("relative_humidity_2m",),
    "humidity": ("precipitation", "wind_speed_10m"),
    "advisory": (),
    "general": (),
}


def focus_facts(facts: WeatherFacts, parameter: WeatherParameter) -> WeatherFacts:
    """Copy of *facts* limited to the values relevant to *parameter*."""
    return facts.model_copy(update={field: None for field in _FOCUS_DROPS[parameter]})


def select_weather_facts(
    weather: WeatherResponse,
    intent: ChatIntent,
    location_name: str,
) -> WeatherFacts:
    return focus_facts(
        select_period_facts(weather, intent, location_name), intent.weather_parameter
    )
