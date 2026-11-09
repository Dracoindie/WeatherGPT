"""
The ONE place hazard thresholds and levels are defined.

Used by:
- ``alerts/scoring.py``: the one scorer. ``alerts/engine.py`` (/api/alerts, the
  dashboard and map status, the district risk board ``roles/risk.py``, Web Push
  ``dissemination/job.py`` and CAP export ``dissemination/cap.py``) and the
  hazard map (``maps/hazard.py``, GET /api/map/hazard) both call it, so the
  same data in the same window always gets the same level everywhere.
- ``advisory.py``: the advisory attached to chat replies
- ``GET /api/alerts/thresholds``: the table shown on /alerts

Change a number or a level here and every surface follows. Each value is a
conservative fallback, not a validated model and not an IMD criterion; see
docs/EARLY_WARNING.md. The "severe" rules borrow published category bounds
(cited next to each) so the top level is not an invented number.

Levels: none < advisory < watch < warning < severe. Chat advisories use
low / moderate / high; ``ADVISORY_SEVERITY`` maps the level to that scale, so
the same rule always gives the same answer on every surface.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Literal

Level = Literal["advisory", "watch", "warning", "severe"]
Hazard = Literal["rain", "heat", "cold", "wind", "storm"]

# Order matters: index = rank. "none" is the absence of any rule firing.
LEVELS: tuple[str, ...] = ("none", "advisory", "watch", "warning", "severe")
LEVEL_RANK: dict[str, int] = {lvl: i for i, lvl in enumerate(LEVELS)}
HAZARDS: tuple[Hazard, ...] = ("rain", "heat", "wind", "storm", "cold")


# ---------------------------------------------------------------------------
# Heat index bands (heat stress for people working outdoors)
# ---------------------------------------------------------------------------
# The US National Weather Service heat index categories (80 / 90 / 103 / 125 °F),
# converted to °C. They colour the map's heat-stress layer and pick the
# outdoor-work advice; the top two also drive the heat-stress rules below. The
# heat index itself is computed in maps/heat_index.py (Rothfusz regression).


@dataclass(frozen=True)
class HeatBand:
    id: Literal["caution", "extreme_caution", "danger", "extreme_danger"]
    label: str
    min_c: float  # heat index at or above this value


HEAT_CAUTION = 26.7
HEAT_EXTREME_CAUTION = 32.2
HEAT_DANGER = 39.4
HEAT_EXTREME_DANGER = 51.7

HEAT_INDEX_BANDS: tuple[HeatBand, ...] = (
    HeatBand("caution", "Caution", HEAT_CAUTION),
    HeatBand("extreme_caution", "Extreme caution", HEAT_EXTREME_CAUTION),
    HeatBand("danger", "Danger", HEAT_DANGER),
    HeatBand("extreme_danger", "Extreme danger", HEAT_EXTREME_DANGER),
)


def heat_band(heat_index_c: float | None) -> str | None:
    """The band id for a heat index, "lower_risk" below Caution, None without data."""
    if heat_index_c is None:
        return None
    band = "lower_risk"
    for b in HEAT_INDEX_BANDS:
        if heat_index_c >= b.min_c:
            band = b.id
    return band


def heat_bands_table() -> list[dict]:
    return [asdict(b) for b in HEAT_INDEX_BANDS]


# ---------------------------------------------------------------------------
# Rules
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Rule:
    id: str
    hazard: Hazard
    level: Level
    label: str
    parameter: str  # precipitation | temperature | wind_speed | heat_index | weather_code
    comparator: Literal[">=", "<=", "in"]
    value: float
    unit: str
    window: str
    codes: tuple[int, ...] = ()


HEAVY_RAIN = Rule("heavy_rain", "rain", "watch", "Heavy rain", "precipitation", ">=", 15.0, "mm", "24 h total")
EXTREME_RAIN = Rule("extreme_rain", "rain", "warning", "Extreme rain", "precipitation", ">=", 50.0, "mm", "24 h total")
# IMD "very heavy rainfall" is 115.6-204.4 mm in 24 h (IMD rainfall intensity
# categories; sources in docs/EARLY_WARNING.md, "Sources of the severe rules").
VERY_HEAVY_RAIN = Rule("very_heavy_rain", "rain", "severe", "Very heavy rain", "precipitation", ">=", 115.6, "mm", "24 h total")
HIGH_HEAT = Rule("high_heat", "heat", "advisory", "High heat", "temperature", ">=", 35.0, "°C", "24 h maximum")
EXTREME_HEAT = Rule("extreme_heat", "heat", "warning", "Extreme heat", "temperature", ">=", 40.0, "°C", "24 h maximum")
# IMD declares a severe heat wave (plains) when the actual maximum reaches 47 °C
# (IMD heat wave FAQ; docs/EARLY_WARNING.md, "Sources of the severe rules").
SEVERE_HEAT = Rule("severe_heat", "heat", "severe", "Severe heat", "temperature", ">=", 47.0, "°C", "24 h maximum")
# Heat stress: the NWS "Danger" and "Extreme danger" heat index bands.
HEAT_STRESS = Rule("heat_stress", "heat", "watch", "Heat stress", "heat_index", ">=", HEAT_DANGER, "°C", "24 h maximum heat index")
EXTREME_HEAT_STRESS = Rule(
    "extreme_heat_stress", "heat", "warning", "Extreme heat stress", "heat_index", ">=", HEAT_EXTREME_DANGER, "°C", "24 h maximum heat index"
)
COLD = Rule("cold", "cold", "advisory", "Cold", "temperature", "<=", 5.0, "°C", "24 h minimum")
STRONG_WIND = Rule("strong_wind", "wind", "watch", "Strong wind", "wind_speed", ">=", 40.0, "km/h", "24 h maximum")
GALE = Rule("gale", "wind", "warning", "Gale", "wind_speed", ">=", 65.0, "km/h", "24 h maximum")
# Beaufort force 10 ("storm") starts at 89 km/h.
STORM_FORCE_WIND = Rule("storm_force_wind", "wind", "severe", "Storm-force wind", "wind_speed", ">=", 89.0, "km/h", "24 h maximum")
THUNDERSTORM = Rule("thunderstorm", "storm", "watch", "Thunderstorm", "weather_code", "in", 95.0, "WMO code", "current", (95,))
THUNDERSTORM_HAIL = Rule(
    "thunderstorm_hail", "storm", "warning", "Thunderstorm with hail", "weather_code", "in", 96.0, "WMO code", "current", (96,)
)
# WMO 99: thunderstorm with heavy hail.
THUNDERSTORM_HEAVY_HAIL = Rule(
    "thunderstorm_heavy_hail", "storm", "severe", "Thunderstorm with heavy hail", "weather_code", "in", 99.0, "WMO code", "current", (99,)
)

RULES: tuple[Rule, ...] = (
    HEAVY_RAIN,
    EXTREME_RAIN,
    VERY_HEAVY_RAIN,
    HIGH_HEAT,
    EXTREME_HEAT,
    SEVERE_HEAT,
    HEAT_STRESS,
    EXTREME_HEAT_STRESS,
    COLD,
    STRONG_WIND,
    GALE,
    STORM_FORCE_WIND,
    THUNDERSTORM,
    THUNDERSTORM_HAIL,
    THUNDERSTORM_HEAVY_HAIL,
)

# ---------------------------------------------------------------------------
# Route rules (routing/weather.py): one forecast HOUR at the point a traveller
# passes, not a 24 h window. The instant rules above apply unchanged; the 24 h
# rain totals cannot be compared with one hour of rain, so on routes rain comes
# from the model's WMO weather code for that hour (WMO code table 4677, as
# published by Open-Meteo: 61/63/65 rain slight/moderate/heavy, 80/81/82 rain
# showers slight/moderate/violent). No mm-per-hour threshold is invented.
# ---------------------------------------------------------------------------
MODERATE_RAIN_HOUR = Rule(
    "moderate_rain_hour", "rain", "advisory", "Moderate rain", "weather_code", "in", 63.0, "WMO code", "that hour", (63, 81)
)
HEAVY_RAIN_HOUR = Rule(
    "heavy_rain_hour", "rain", "watch", "Heavy rain", "weather_code", "in", 65.0, "WMO code", "that hour", (65, 82)
)
ROUTE_RULES: tuple[Rule, ...] = tuple(r for r in RULES if r.parameter != "precipitation") + (MODERATE_RAIN_HOUR, HEAVY_RAIN_HOUR)

# Chat advisory severity for a rule's level.
ADVISORY_SEVERITY: dict[Level, str] = {"severe": "high", "warning": "high", "watch": "moderate", "advisory": "moderate"}

# Plain numbers, for code that only needs the value.
HEAVY_RAIN_MM = HEAVY_RAIN.value
EXTREME_RAIN_MM = EXTREME_RAIN.value
HOT_TEMP_C = HIGH_HEAT.value
EXTREME_HEAT_C = EXTREME_HEAT.value
COLD_TEMP_C = COLD.value
HIGH_WIND_KMH = STRONG_WIND.value
STORM_WIND_KMH = GALE.value
STORM_WMO_CODES = frozenset(THUNDERSTORM.codes + THUNDERSTORM_HAIL.codes + THUNDERSTORM_HEAVY_HAIL.codes)


def rules_table(rules: tuple[Rule, ...]) -> list[dict]:
    """JSON-ready rows for a set of rules."""
    rows = []
    for r in rules:
        row = asdict(r)
        row["codes"] = list(r.codes)
        rows.append(row)
    return rows


def as_table() -> list[dict]:
    """JSON-ready rows for GET /api/alerts/thresholds."""
    return rules_table(RULES)


# ---------------------------------------------------------------------------
# Community reports and the experimental waterlogging estimate
# (docs/REPORTS.md, docs/WATERLOGGING.md). These never set an alert level:
# they only weigh a report's agreement with the model and draw the
# experimental waterlogging layer.
# ---------------------------------------------------------------------------
# Hourly rain intensity, American Meteorological Society Glossary of
# Meteorology ("rain"): light up to 2.5 mm/h, moderate 2.6-7.6 mm/h, heavy
# above 7.6 mm/h. Used for one model HOUR of rain (the 24 h rules above are
# totals and cannot be compared with an hour).
RAIN_RATE_LIGHT_MM_H = 2.5
RAIN_RATE_HEAVY_MM_H = 7.6
# Below this an hour counts as dry (Open-Meteo reports 0.1 mm steps).
RAIN_TRACE_MM_H = 0.2

# How well the model supports a report, 0..1, by the model's peak around the
# report time. Rain kinds (heavy rain, waterlogging): peak hourly rain over the
# past 3 h and the next hour. Wind kinds (strong wind, fallen tree): peak gust,
# with the Beaufort-based wind rules above (STRONG_WIND, GALE). Landslide and
# road blocked: the past 24 h rain total against HEAVY_RAIN / EXTREME_RAIN.
# Hail: the WMO hail codes 96/99, else any rain.
REPORT_AGREEMENT_RAIN = ((RAIN_TRACE_MM_H, 0.1), (RAIN_RATE_LIGHT_MM_H, 0.4), (RAIN_RATE_HEAVY_MM_H, 0.7))  # (below mm/h, score); above the last: 1.0
REPORT_AGREEMENT_GUST = ((20.0, 0.2), (STRONG_WIND.value, 0.5), (GALE.value, 0.8))  # (below km/h, score); above: 1.0
REPORT_AGREEMENT_RAIN_24H = ((5.0, 0.3), (HEAVY_RAIN.value, 0.5), (EXTREME_RAIN.value, 0.8))  # (below mm, score); above: 1.0
REPORT_AGREEMENT_HAIL_CODES = THUNDERSTORM_HAIL.codes + THUNDERSTORM_HEAVY_HAIL.codes
# A fallen tree with calm model wind is still plausible (old trees, rain-soaked soil).
REPORT_AGREEMENT_FALLEN_TREE_FLOOR = 0.35
# When the model could not be asked: neither support nor contradiction.
REPORT_AGREEMENT_UNKNOWN = 0.5

# Trust bands of a report's 0..1 score (docs/REPORTS.md has the formula).
REPORT_TRUST_MEDIUM = 0.4
REPORT_TRUST_HIGH = 0.65

# Waterlogging estimate (experimental), 0..1 per H3 cell; levels by score.
# Rain factor: the 9 h window (past 3 h + next 6 h) total against EXTREME_RAIN
# (50 mm in 24 h, so 50 mm in 9 h is far beyond it), or its peak hour against
# twice the AMS heavy-rain rate, whichever is larger.
WATERLOG_RAIN_TOTAL_MM = EXTREME_RAIN.value
WATERLOG_RAIN_PEAK_MM_H = 2 * RAIN_RATE_HEAVY_MM_H
# Lowness: metres below the mean of the surrounding cells for a full score.
WATERLOG_LOW_METRES = 15.0
WATERLOG_LEVELS = (("low", 0.15), ("moderate", 0.35), ("high", 0.6))  # (level, score from which it applies)


def band(value: float, bands: tuple[tuple[float, float], ...], top: float = 1.0) -> float:
    """Score for ``value`` from (below, score) bands, ``top`` above the last one."""
    for below, score in bands:
        if value < below:
            return score
    return top


def waterlog_level(score: float) -> str:
    """"none", "low", "moderate" or "high" for a 0..1 waterlogging score."""
    level = "none"
    for name, start in WATERLOG_LEVELS:
        if score >= start:
            level = name
    return level
