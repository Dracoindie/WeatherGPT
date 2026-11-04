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


def as_table() -> list[dict]:
    """JSON-ready rows for GET /api/alerts/thresholds."""
    rows = []
    for r in RULES:
        row = asdict(r)
        row["codes"] = list(r.codes)
        rows.append(row)
    return rows
