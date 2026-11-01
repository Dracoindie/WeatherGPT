"""
Deterministic Weather Alert & Early Warning Evaluation Engine.

Uses Open-Meteo verified meteorological data to evaluate rule-based alerts
without any AI hallucination or unvalidated claims.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Optional
import uuid

from models.alerts import WeatherAlert, AlertSeverity, AlertCategory
from models.weather import WeatherResponse
# Every threshold and level comes from thresholds.py (single source of truth).
from thresholds import (
    COLD,
    COLD_TEMP_C,
    EXTREME_HEAT,
    EXTREME_HEAT_C,
    EXTREME_RAIN,
    EXTREME_RAIN_MM,
    GALE,
    HEAVY_RAIN,
    HEAVY_RAIN_MM,
    HIGH_HEAT,
    HIGH_WIND_KMH,
    HOT_TEMP_C,
    STORM_WIND_KMH,
    STORM_WMO_CODES,
    STRONG_WIND,
    THUNDERSTORM,
    THUNDERSTORM_HAIL,
)

def evaluate_alerts(weather: WeatherResponse) -> List[WeatherAlert]:
    """
    Evaluate deterministic alert rules against current and next 24-hour weather data.
    """
    alerts: List[WeatherAlert] = []
    now = datetime.now(timezone.utc)
    current = weather.current
    hourly = weather.hourly

    # Gather 24-hour horizon max/sums from hourly data if available
    h_temp_max: Optional[float] = None
    h_temp_min: Optional[float] = None
    h_wind_max: Optional[float] = None
    h_precip_sum: Optional[float] = None

    if hourly and hourly.temperature_2m:
        horizon_len = min(24, len(hourly.temperature_2m))
        h_temp_max = max(hourly.temperature_2m[:horizon_len])
        h_temp_min = min(hourly.temperature_2m[:horizon_len])
        if hourly.wind_speed_10m:
            h_wind_max = max(hourly.wind_speed_10m[:min(horizon_len, len(hourly.wind_speed_10m))])
        if hourly.precipitation:
            h_precip_sum = sum(hourly.precipitation[:min(horizon_len, len(hourly.precipitation))])

    # -------------------------------------------------------------------------
    # 1. PRECIPITATION / RAIN ALERTS
    # -------------------------------------------------------------------------
    current_rain = current.precipitation
    eval_rain = current_rain
    if h_precip_sum is not None and h_precip_sum > eval_rain:
        eval_rain = h_precip_sum
        time_window = "Next 24 hours"
    else:
        time_window = "Current / Last Hour"

    if eval_rain >= EXTREME_RAIN_MM:
        alerts.append(
            WeatherAlert(
                id=f"alert-rain-warning-{int(now.timestamp())}",
                alert_type="rain",
                severity=EXTREME_RAIN.level,
                condition="Extreme Rain / Flood Risk",
                headline=f"Warning: Extreme rainfall ({eval_rain:.1f} mm) recorded/forecasted",
                description=f"Significant precipitation of {eval_rain:.1f} mm exceeds the extreme safety threshold of {EXTREME_RAIN_MM} mm. High risk of waterlogging, local flooding, and dangerous road conditions.",
                recommended_action="Avoid non-essential travel, stay away from low-lying areas and storm drains, and secure waterproof gear.",
                relevant_parameter="precipitation",
                relevant_value=round(eval_rain, 1),
                threshold_value=EXTREME_RAIN_MM,
                unit="mm",
                time_window=time_window,
                source="open-meteo",
                created_at=now,
            )
        )
    elif eval_rain >= HEAVY_RAIN_MM:
        alerts.append(
            WeatherAlert(
                id=f"alert-rain-watch-{int(now.timestamp())}",
                alert_type="rain",
                severity=HEAVY_RAIN.level,
                condition="Heavy Rain Watch",
                headline=f"Watch: Heavy rain ({eval_rain:.1f} mm) anticipated",
                description=f"Precipitation of {eval_rain:.1f} mm exceeds the heavy rainfall threshold of {HEAVY_RAIN_MM} mm. Expect wet surfaces and reduced visibility.",
                recommended_action="Keep an umbrella handy, allow extra commute time, and inspect drainage channels.",
                relevant_parameter="precipitation",
                relevant_value=round(eval_rain, 1),
                threshold_value=HEAVY_RAIN_MM,
                unit="mm",
                time_window=time_window,
                source="open-meteo",
                created_at=now,
            )
        )

    # -------------------------------------------------------------------------
    # 2. TEMPERATURE / HEAT ALERTS
    # -------------------------------------------------------------------------
    current_temp = current.temperature_2m
    eval_temp_max = current_temp
    if h_temp_max is not None and h_temp_max > eval_temp_max:
        eval_temp_max = h_temp_max
        temp_window = "Next 24 hours"
    else:
        temp_window = "Current"

    if eval_temp_max >= EXTREME_HEAT_C:
        alerts.append(
            WeatherAlert(
                id=f"alert-heat-warning-{int(now.timestamp())}",
                alert_type="heat",
                severity=EXTREME_HEAT.level,
                condition="Extreme Heat Warning",
                headline=f"Warning: Dangerous heat ({eval_temp_max:.1f}°C) detected",
                description=f"Ambient temperatures reaching {eval_temp_max:.1f}°C surpass the critical heat threshold of {EXTREME_HEAT_C}°C. Elevated risk of heat exhaustion and heatstroke.",
                recommended_action="Stay hydrated, remain in cool indoor environments during peak afternoon hours, and check on vulnerable individuals.",
                relevant_parameter="temperature",
                relevant_value=round(eval_temp_max, 1),
                threshold_value=EXTREME_HEAT_C,
                unit="°C",
                time_window=temp_window,
                source="open-meteo",
                created_at=now,
            )
        )
    elif eval_temp_max >= HOT_TEMP_C:
        alerts.append(
            WeatherAlert(
                id=f"alert-heat-advisory-{int(now.timestamp())}",
                alert_type="heat",
                severity=HIGH_HEAT.level,
                condition="High Temperature Advisory",
                headline=f"Advisory: High temperatures ({eval_temp_max:.1f}°C)",
                description=f"Temperatures reaching {eval_temp_max:.1f}°C meet or exceed the elevated heat threshold of {HOT_TEMP_C}°C.",
                recommended_action="Drink plenty of fluids, wear lightweight clothing, and limit strenuous outdoor activities in direct sun.",
                relevant_parameter="temperature",
                relevant_value=round(eval_temp_max, 1),
                threshold_value=HOT_TEMP_C,
                unit="°C",
                time_window=temp_window,
                source="open-meteo",
                created_at=now,
            )
        )

    # -------------------------------------------------------------------------
    # 3. TEMPERATURE / COLD ALERTS
    # -------------------------------------------------------------------------
    eval_temp_min = current_temp
    if h_temp_min is not None and h_temp_min < eval_temp_min:
        eval_temp_min = h_temp_min
        cold_window = "Next 24 hours"
    else:
        cold_window = "Current"

    if eval_temp_min <= COLD_TEMP_C:
        alerts.append(
            WeatherAlert(
                id=f"alert-cold-advisory-{int(now.timestamp())}",
                alert_type="cold",
                severity=COLD.level,
                condition="Cold Weather Advisory",
                headline=f"Advisory: Chilly conditions ({eval_temp_min:.1f}°C)",
                description=f"Temperatures dropping to {eval_temp_min:.1f}°C meet the cold weather advisory threshold ({COLD_TEMP_C}°C).",
                recommended_action="Dress in warm layers, protect pets from prolonged exposure, and guard against hypothermia.",
                relevant_parameter="temperature",
                relevant_value=round(eval_temp_min, 1),
                threshold_value=COLD_TEMP_C,
                unit="°C",
                time_window=cold_window,
                source="open-meteo",
                created_at=now,
            )
        )

    # -------------------------------------------------------------------------
    # 4. WIND SPEED ALERTS
    # -------------------------------------------------------------------------
    current_wind = current.wind_speed_10m
    eval_wind = current_wind
    if h_wind_max is not None and h_wind_max > eval_wind:
        eval_wind = h_wind_max
        wind_window = "Next 24 hours"
    else:
        wind_window = "Current"

    if eval_wind >= STORM_WIND_KMH:
        alerts.append(
            WeatherAlert(
                id=f"alert-wind-warning-{int(now.timestamp())}",
                alert_type="wind",
                severity=GALE.level,
                condition="Gale / High Wind Warning",
                headline=f"Warning: Damaging wind gusts ({eval_wind:.1f} km/h)",
                description=f"Wind speeds reaching {eval_wind:.1f} km/h cross the severe storm wind threshold of {STORM_WIND_KMH} km/h. Risk of falling branches and structural hazards.",
                recommended_action="Secure outdoor furniture, avoid parking under trees, and drive with extreme caution.",
                relevant_parameter="wind_speed",
                relevant_value=round(eval_wind, 1),
                threshold_value=STORM_WIND_KMH,
                unit="km/h",
                time_window=wind_window,
                source="open-meteo",
                created_at=now,
            )
        )
    elif eval_wind >= HIGH_WIND_KMH:
        alerts.append(
            WeatherAlert(
                id=f"alert-wind-watch-{int(now.timestamp())}",
                alert_type="wind",
                severity=STRONG_WIND.level,
                condition="Strong Wind Watch",
                headline=f"Watch: Strong winds ({eval_wind:.1f} km/h)",
                description=f"Wind velocities of {eval_wind:.1f} km/h exceed the high wind threshold of {HIGH_WIND_KMH} km/h.",
                recommended_action="Hold doors firmly, secure loose light items, and exercise caution on elevated bridges.",
                relevant_parameter="wind_speed",
                relevant_value=round(eval_wind, 1),
                threshold_value=HIGH_WIND_KMH,
                unit="km/h",
                time_window=wind_window,
                source="open-meteo",
                created_at=now,
            )
        )

    # -------------------------------------------------------------------------
    # 5. THUNDERSTORM / SEVERE WEATHER (WMO Code Grounded)
    # -------------------------------------------------------------------------
    if current.weather_code in STORM_WMO_CODES:
        is_severe = current.weather_code in THUNDERSTORM_HAIL.codes
        rule = THUNDERSTORM_HAIL if is_severe else THUNDERSTORM
        severity_level: AlertSeverity = rule.level
        alerts.append(
            WeatherAlert(
                id=f"alert-storm-{int(now.timestamp())}",
                alert_type="storm",
                severity=severity_level,
                condition="Thunderstorm Activity Detected",
                headline="Active Thunderstorm / Lightning Warning" if is_severe else "Thunderstorm Watch",
                description=f"Verified WMO weather code {current.weather_code} indicates active convective thunderstorm{' and hail' if is_severe else ''} in the immediate area.",
                recommended_action="Seek immediate sturdy indoor shelter. Avoid open fields, metal fences, and water bodies. Unplug sensitive electrical equipment.",
                relevant_parameter="weather_code",
                relevant_value=float(current.weather_code),
                threshold_value=rule.value,
                unit="WMO code",
                time_window="Current",
                source="open-meteo",
                created_at=now,
            )
        )

    return alerts
