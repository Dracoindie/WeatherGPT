"""
The ONE place hazard thresholds and levels are defined.

Used by:
- ``alerts/engine.py``: /api/alerts, the dashboard and map status, the district
  risk board (``roles/risk.py``), Web Push (``dissemination/job.py``) and CAP
  export (``dissemination/cap.py``, from each alert's ``threshold_value``)
- ``advisory.py``: the advisory attached to chat replies
- ``GET /api/alerts/thresholds``: the table shown on /alerts

Change a number or a level here and every surface follows. Each value is a
conservative fallback, not a validated model and not an IMD criterion; see
docs/EARLY_WARNING.md.

Levels are the alert levels advisory < watch < warning. Chat advisories use
low / moderate / high; ``ADVISORY_SEVERITY`` maps the level to that scale, so
the same rule always gives the same answer on every surface.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Literal

Level = Literal["advisory", "watch", "warning"]
Hazard = Literal["rain", "heat", "cold", "wind", "storm"]


@dataclass(frozen=True)
class Rule:
    id: str
    hazard: Hazard
    level: Level
    label: str
    parameter: str  # precipitation | temperature | wind_speed | weather_code
    comparator: Literal[">=", "<=", "in"]
    value: float
    unit: str
    window: str
    codes: tuple[int, ...] = ()


HEAVY_RAIN = Rule("heavy_rain", "rain", "watch", "Heavy rain", "precipitation", ">=", 15.0, "mm", "24 h total")
EXTREME_RAIN = Rule("extreme_rain", "rain", "warning", "Extreme rain", "precipitation", ">=", 50.0, "mm", "24 h total")
HIGH_HEAT = Rule("high_heat", "heat", "advisory", "High heat", "temperature", ">=", 35.0, "°C", "24 h maximum")
EXTREME_HEAT = Rule("extreme_heat", "heat", "warning", "Extreme heat", "temperature", ">=", 40.0, "°C", "24 h maximum")
COLD = Rule("cold", "cold", "advisory", "Cold", "temperature", "<=", 5.0, "°C", "24 h minimum")
STRONG_WIND = Rule("strong_wind", "wind", "watch", "Strong wind", "wind_speed", ">=", 40.0, "km/h", "24 h maximum")
GALE = Rule("gale", "wind", "warning", "Gale", "wind_speed", ">=", 65.0, "km/h", "24 h maximum")
THUNDERSTORM = Rule("thunderstorm", "storm", "watch", "Thunderstorm", "weather_code", "in", 95.0, "WMO code", "current", (95,))
THUNDERSTORM_HAIL = Rule(
    "thunderstorm_hail", "storm", "warning", "Thunderstorm with hail", "weather_code", "in", 96.0, "WMO code", "current", (96, 99)
)

RULES: tuple[Rule, ...] = (
    HEAVY_RAIN,
    EXTREME_RAIN,
    HIGH_HEAT,
    EXTREME_HEAT,
    COLD,
    STRONG_WIND,
    GALE,
    THUNDERSTORM,
    THUNDERSTORM_HAIL,
)

# Chat advisory severity for a rule's level.
ADVISORY_SEVERITY: dict[Level, str] = {"warning": "high", "watch": "moderate", "advisory": "moderate"}

# Plain numbers, for code that only needs the value.
HEAVY_RAIN_MM = HEAVY_RAIN.value
EXTREME_RAIN_MM = EXTREME_RAIN.value
HOT_TEMP_C = HIGH_HEAT.value
EXTREME_HEAT_C = EXTREME_HEAT.value
COLD_TEMP_C = COLD.value
HIGH_WIND_KMH = STRONG_WIND.value
STORM_WIND_KMH = GALE.value
STORM_WMO_CODES = frozenset(THUNDERSTORM.codes + THUNDERSTORM_HAIL.codes)


def as_table() -> list[dict]:
    """JSON-ready rows for GET /api/alerts/thresholds."""
    rows = []
    for r in RULES:
        row = asdict(r)
        row["codes"] = list(r.codes)
        rows.append(row)
    return rows
