"""
Deterministic farm guidance from the Open-Meteo hourly forecast.

Every rule is a threshold on forecast values; see docs/ROLE_ADVISORIES.md.
This is guidance, not an agro-met advisory: the response says so.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from models.roles import FarmAdvice, FarmDay, IrrigationAdvice, SowingAdvice, SprayWindow
from models.weather import WeatherResponse
from llm.response_generator import _fmt as _n
from query_service import _parse_local, _zone

# --- Spraying (pesticide / foliar feed) -------------------------------------
SPRAY_MIN_WIND_KMH = 3.0  # below: inversion risk, droplets hang and drift
SPRAY_MAX_WIND_KMH = 15.0  # above: drift
SPRAY_MAX_TEMP_C = 30.0  # above: evaporation / volatilisation
SPRAY_MIN_RH = 40.0  # below: droplets evaporate before landing
SPRAY_RAINFREE_HOURS = 4  # dry hours needed after spraying (rain-fastness)
SPRAY_MAX_RAIN_PROBABILITY = 40  # % in the spray hour and the rain-free hours after
SPRAY_DAYLIGHT = (6, 18)  # local hours, inclusive
SPRAY_MIN_WINDOW_HOURS = 2

# --- Irrigation (next 48 h) ---------------------------------------------------
IRRIGATION_SKIP_RAIN_MM = 10.0
IRRIGATION_DELAY_RAIN_MM = 5.0
IRRIGATION_DELAY_PROBABILITY = 60
IRRIGATION_HEAT_C = 35.0

# --- Harvest (per day) ---------------------------------------------------------
HARVEST_MAX_RAIN_MM = 1.0
HARVEST_MAX_PROBABILITY = 40
HARVEST_MAX_WIND_KMH = 30.0

# --- Sowing (next 72 h) -----------------------------------------------------------
SOWING_MIN_RAIN_MM = 10.0
SOWING_MAX_RAIN_MM = 50.0
SOWING_HEAVY_DAY_MM = 50.0
SOWING_MAX_TEMP_C = 38.0

HORIZON_HOURS = 72

THRESHOLDS: dict[str, float] = {
    "spray_min_wind_kmh": SPRAY_MIN_WIND_KMH,
    "spray_max_wind_kmh": SPRAY_MAX_WIND_KMH,
    "spray_max_temperature_c": SPRAY_MAX_TEMP_C,
    "spray_min_relative_humidity": SPRAY_MIN_RH,
    "spray_rain_free_hours": SPRAY_RAINFREE_HOURS,
    "spray_max_rain_probability": SPRAY_MAX_RAIN_PROBABILITY,
    "irrigation_skip_rain_48h_mm": IRRIGATION_SKIP_RAIN_MM,
    "irrigation_delay_rain_48h_mm": IRRIGATION_DELAY_RAIN_MM,
    "irrigation_delay_probability_24h": IRRIGATION_DELAY_PROBABILITY,
    "irrigation_heat_c": IRRIGATION_HEAT_C,
    "harvest_max_rain_mm": HARVEST_MAX_RAIN_MM,
    "harvest_max_probability": HARVEST_MAX_PROBABILITY,
    "harvest_max_wind_kmh": HARVEST_MAX_WIND_KMH,
    "sowing_min_rain_72h_mm": SOWING_MIN_RAIN_MM,
    "sowing_max_rain_72h_mm": SOWING_MAX_RAIN_MM,
    "sowing_heavy_day_mm": SOWING_HEAVY_DAY_MM,
    "sowing_max_temperature_c": SOWING_MAX_TEMP_C,
}


class _Hour:
    __slots__ = ("time", "temp", "rain", "prob", "wind", "rh")

    def __init__(self, time: datetime, temp, rain, prob, wind, rh):
        self.time, self.temp, self.rain, self.prob, self.wind, self.rh = time, temp, rain, prob, wind, rh


def _hours(weather: WeatherResponse, now: datetime) -> list[_Hour]:
    tz = _zone(weather.timezone)
    h = weather.hourly
    start = now.replace(minute=0, second=0, microsecond=0)
    out = []
    for i, ts in enumerate(h.time):
        t = _parse_local(ts, tz)
        if start <= t < start + timedelta(hours=HORIZON_HOURS):
            out.append(
                _Hour(
                    t,
                    h.temperature_2m[i],
                    h.precipitation[i] or 0.0,
                    h.precipitation_probability[i],
                    h.wind_speed_10m[i],
                    h.relative_humidity_2m[i] if i < len(h.relative_humidity_2m) else None,
                )
            )
    return out


def _spray_ok(hours: list[_Hour], i: int) -> bool:
    hr = hours[i]
    if not (SPRAY_DAYLIGHT[0] <= hr.time.hour <= SPRAY_DAYLIGHT[1]):
        return False
    if not (SPRAY_MIN_WIND_KMH <= hr.wind <= SPRAY_MAX_WIND_KMH):
        return False
    if hr.temp > SPRAY_MAX_TEMP_C or (hr.rh is not None and hr.rh < SPRAY_MIN_RH):
        return False
    after = hours[i : i + 1 + SPRAY_RAINFREE_HOURS]
    if len(after) < 1 + SPRAY_RAINFREE_HOURS:
        return False  # can't confirm the rain-free hours inside the horizon
    for a in after:
        if a.rain > 0 or (a.prob is not None and a.prob >= SPRAY_MAX_RAIN_PROBABILITY):
            return False
    return True


def spray_windows(hours: list[_Hour], limit: int = 4) -> list[SprayWindow]:
    windows: list[SprayWindow] = []
    run: list[_Hour] = []
    for i in range(len(hours) + 1):
        ok = i < len(hours) and _spray_ok(hours, i) and (not run or hours[i].time - run[-1].time == timedelta(hours=1))
        if ok:
            run.append(hours[i])
            continue
        if len(run) >= SPRAY_MIN_WINDOW_HOURS:
            windows.append(
                SprayWindow(
                    start=run[0].time.strftime("%Y-%m-%dT%H:%M"),
                    end=run[-1].time.strftime("%Y-%m-%dT%H:%M"),
                    hours=len(run),
                    max_wind_kmh=round(max(r.wind for r in run), 1),
                    max_temperature_c=round(max(r.temp for r in run), 1),
                )
            )
        run = [hours[i]] if i < len(hours) and _spray_ok(hours, i) else []
    return windows[:limit]


def irrigation(hours: list[_Hour]) -> IrrigationAdvice:
    next48 = [h for h in hours if h.time < hours[0].time + timedelta(hours=48)] if hours else []
    next24 = [h for h in next48 if h.time < hours[0].time + timedelta(hours=24)]
    rain = round(sum(h.rain for h in next48), 1)
    probs = [h.prob for h in next24 if h.prob is not None]
    max_prob = max(probs) if probs else None
    tmax = round(max(h.temp for h in next48), 1) if next48 else 0.0
    if rain >= IRRIGATION_SKIP_RAIN_MM:
        status, reason = "skip", f"{_n(rain)} mm of rain is expected in the next 48 hours."
    elif rain >= IRRIGATION_DELAY_RAIN_MM or (max_prob is not None and max_prob >= IRRIGATION_DELAY_PROBABILITY):
        status, reason = "delay", f"Rain is likely ({_n(rain)} mm in 48 h, up to {_n(max_prob)}% chance in 24 h); wait and check soil moisture."
    elif tmax >= IRRIGATION_HEAT_C:
        status, reason = "needed", f"Up to {_n(tmax)}°C with little rain: irrigate in the early morning or evening."
    else:
        status, reason = "as_usual", f"Only {_n(rain)} mm of rain expected in 48 h; follow your usual schedule."
    return IrrigationAdvice(
        status=status,
        rain_next_48h_mm=rain,
        max_precipitation_probability_24h=max_prob,
        max_temperature_48h_c=tmax,
        reason=reason,
    )


def harvest_days(hours: list[_Hour]) -> list[FarmDay]:
    by_day: dict[str, list[_Hour]] = {}
    for h in hours:
        by_day.setdefault(h.time.date().isoformat(), []).append(h)
    days = []
    for day, hs in by_day.items():
        rain = round(sum(h.rain for h in hs), 1)
        probs = [h.prob for h in hs if h.prob is not None]
        max_prob = max(probs) if probs else None
        wind = round(max(h.wind for h in hs), 1)
        reasons = []
        if rain >= HARVEST_MAX_RAIN_MM:
            reasons.append(f"{_n(rain)} mm rain")
        if max_prob is not None and max_prob >= HARVEST_MAX_PROBABILITY:
            reasons.append(f"{_n(max_prob)}% rain chance")
        if wind >= HARVEST_MAX_WIND_KMH:
            reasons.append(f"wind up to {_n(wind)} km/h")
        days.append(
            FarmDay(
                date=day,
                precipitation_mm=rain,
                max_precipitation_probability=max_prob,
                max_wind_kmh=wind,
                max_temperature_c=round(max(h.temp for h in hs), 1),
                harvest="avoid" if reasons else "good",
                reasons=reasons,
            )
        )
    return days


def sowing(days: list[FarmDay]) -> SowingAdvice:
    total = round(sum(d.precipitation_mm for d in days), 1)
    heaviest = max((d.precipitation_mm for d in days), default=0.0)
    hottest = max((d.max_temperature_c for d in days), default=0.0)
    if heaviest >= SOWING_HEAVY_DAY_MM or total > SOWING_MAX_RAIN_MM:
        status, reason = "wait", f"Heavy rain ahead ({_n(heaviest)} mm in a day) may wash out seed."
    elif hottest >= SOWING_MAX_TEMP_C:
        status, reason = "wait", f"Up to {_n(hottest)}°C: heat stress for germinating seed."
    elif total >= SOWING_MIN_RAIN_MM:
        status, reason = "favourable", f"{_n(total)} mm of rain over 3 days should give moisture for germination."
    else:
        status, reason = "dry", f"Only {_n(total)} mm of rain in 3 days: sow only with irrigation."
    return SowingAdvice(status=status, rain_next_72h_mm=total, max_daily_rain_mm=heaviest, reason=reason)


def farm_advice(weather: WeatherResponse, now: Optional[datetime] = None) -> FarmAdvice:
    tz = _zone(weather.timezone)
    now = (now or datetime.now(timezone.utc)).astimezone(tz)
    hours = _hours(weather, now)
    days = harvest_days(hours)
    return FarmAdvice(
        latitude=weather.latitude,
        longitude=weather.longitude,
        timezone=weather.timezone,
        generated_at=datetime.now(timezone.utc),
        spray_windows=spray_windows(hours),
        irrigation=irrigation(hours),
        harvest_days=days,
        sowing=sowing(days),
        thresholds=THRESHOLDS,
    )
