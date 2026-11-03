"""
Heat index ("feels like" from heat and humidity) for heat-stress guidance.

Method: the US National Weather Service heat index (Rothfusz regression with
Steadman's simple formula for mild conditions and the NWS low/high humidity
adjustments), https://www.wpc.ncep.noaa.gov/html/heatindex_equation.shtml.

Inputs are Open-Meteo's 2 m temperature and relative humidity; the output is
rounded to 0.1 °C. It assumes shade and light wind: in full sun it can feel up
to about 8 °C hotter. It is guidance for outdoor workers, not a medical or
official IMD product. Bands live in thresholds.py (HEAT_INDEX_BANDS).
"""

from __future__ import annotations

import math
from typing import Optional


def _c_to_f(c: float) -> float:
    return c * 9 / 5 + 32


def _f_to_c(f: float) -> float:
    return (f - 32) * 5 / 9


def heat_index_c(temperature_c: Optional[float], humidity_pct: Optional[float]) -> Optional[float]:
    """Heat index in °C, or None when either input is missing."""
    if temperature_c is None or humidity_pct is None:
        return None
    t = _c_to_f(temperature_c)
    rh = max(0.0, min(100.0, humidity_pct))

    simple = 0.5 * (t + 61.0 + (t - 68.0) * 1.2 + rh * 0.094)
    if (simple + t) / 2 < 80.0:
        hi = simple
    else:
        hi = (
            -42.379
            + 2.04901523 * t
            + 10.14333127 * rh
            - 0.22475541 * t * rh
            - 0.00683783 * t * t
            - 0.05481717 * rh * rh
            + 0.00122874 * t * t * rh
            + 0.00085282 * t * rh * rh
            - 0.00000199 * t * t * rh * rh
        )
        if rh < 13 and 80 <= t <= 112:
            hi -= ((13 - rh) / 4) * math.sqrt((17 - abs(t - 95)) / 17)
        elif rh > 85 and 80 <= t <= 87:
            hi += ((rh - 85) / 10) * ((87 - t) / 5)
    return round(_f_to_c(hi), 1)
