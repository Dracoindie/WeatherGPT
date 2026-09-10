"""
Deterministic weather intelligence module.
Provides transparent, threshold-based interpretations of weather facts.
"""

from typing import List, Optional
from models.chat import AdvisoryResult, WeatherFacts, WeatherParameter

# Conservative Fallback Thresholds
# These thresholds are used as reasonable fallbacks for generating advisories
# since there are no scientifically validated models in the current project scope.

HEAVY_RAIN_MM = 15.0      # 15 mm in a period is considered moderate-to-heavy
EXTREME_RAIN_MM = 50.0    # 50+ mm is extreme
HIGH_WIND_KMH = 40.0      # 40 km/h is strong
STORM_WIND_KMH = 65.0     # 65+ km/h is gale/storm
HOT_TEMP_C = 35.0         # 35C is hot
EXTREME_HEAT_C = 40.0     # 40C+ is extreme heat
COLD_TEMP_C = 5.0         # 5C is cold

def evaluate_advisory(facts: WeatherFacts, parameter: WeatherParameter) -> AdvisoryResult:
    severity = "low"
    condition = "Routine conditions"
    advisory = "No specific weather advisories at this time."
    reasons: List[str] = []

    if not facts.period_available:
        return AdvisoryResult(
            severity="low",
            condition="Unknown",
            advisory="Forecast data is unavailable for the requested time.",
            reasons=["No data available to evaluate."]
        )

    # Extract reliable values
    temp = facts.temperature_max if facts.temperature_max is not None else facts.temperature_2m
    wind = facts.wind_speed_10m
    rain = facts.precipitation
    rain_prob = facts.precipitation_probability

    is_heat = False
    is_rain = False
    is_wind = False
    is_cold = False

    # Check Rain
    if rain is not None and rain >= EXTREME_RAIN_MM:
        severity = "high"
        condition = "Extreme Rain / Flood Risk"
        advisory = "Severe precipitation expected. Avoid unnecessary travel and stay clear of waterlogged areas."
        reasons.append(f"Precipitation is forecasted at {rain} mm.")
        is_rain = True
    elif rain is not None and rain >= HEAVY_RAIN_MM:
        if severity != "high":
            severity = "moderate"
        condition = "Heavy Rain"
        advisory = "Heavy rain expected. Carry an umbrella and expect minor travel delays."
        reasons.append(f"Precipitation is forecasted at {rain} mm.")
        is_rain = True
    elif parameter in ("heavy_rain", "storm", "rain_likelihood") and rain is not None and rain > 0:
        # If they explicitly asked about rain, and there's some rain
        if severity == "low":
            severity = "low"
            condition = "Light to Moderate Rain"
            advisory = "Some rain is expected, but conditions remain largely manageable."
        reasons.append(f"Precipitation is forecasted at {rain} mm.")

    if rain_prob is not None and rain_prob > 50 and not is_rain:
        reasons.append(f"There is a {rain_prob}% chance of rain.")

    # Check Heat
    if temp is not None and temp >= EXTREME_HEAT_C:
        severity = "high"
        condition = "Extreme Heat"
        advisory = "Dangerous heat levels. Stay indoors, stay hydrated, and avoid direct sun exposure."
        reasons.append(f"Temperatures reaching {temp}°C.")
        is_heat = True
    elif temp is not None and temp >= HOT_TEMP_C:
        if severity != "high":
            severity = "moderate"
        condition = "High Heat"
        advisory = "Hot conditions expected. Keep hydrated if spending time outdoors."
        reasons.append(f"Temperatures reaching {temp}°C.")
        is_heat = True

    # Check Cold
    if temp is not None and temp <= COLD_TEMP_C:
        if severity != "high":
            severity = "moderate"
        condition = "Cold / Chilly"
        advisory = "Cold temperatures expected. Dress warmly."
        reasons.append(f"Temperatures dropping to {temp}°C.")
        is_cold = True

    # Check Wind
    if wind is not None and wind >= STORM_WIND_KMH:
        severity = "high"
        condition = "Storm / Gale Winds"
        advisory = "Dangerous wind speeds. Secure loose objects and avoid outdoor activities."
        reasons.append(f"Wind speeds reaching {wind} km/h.")
        is_wind = True
    elif wind is not None and wind >= HIGH_WIND_KMH:
        if severity != "high":
            severity = "moderate"
        condition = "Strong Winds"
        advisory = "Breezy to strong winds expected. Exercise caution if driving high-profile vehicles."
        reasons.append(f"Wind speeds reaching {wind} km/h.")
        is_wind = True

    # Default fallbacks if the user specifically asked for an advisory but nothing crossed the threshold
    if parameter == "advisory" and len(reasons) == 0:
        advisory = "Weather conditions are currently normal with no significant risks."
        reasons.append("Temperatures, precipitation, and winds are well within safe operating thresholds.")

    if len(reasons) > 0 and condition == "Routine conditions":
        condition = "Active Conditions"
        if advisory == "No specific weather advisories at this time.":
            advisory = "Conditions are active but within moderate levels."

    return AdvisoryResult(
        severity=severity,
        condition=condition,
        advisory=advisory,
        reasons=reasons
    )
