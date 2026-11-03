"""
The one hazard scorer. Every level shown anywhere comes from here.

``window_facts`` reduces hourly series (plus, for "now", the model's current
values) to the numbers the rules in thresholds.py look at: the 24 h rain
total, maximum and minimum temperature, maximum wind, maximum heat index and
the weather code. ``score`` applies every rule and keeps the highest level per
hazard.

Callers:
- ``alerts/engine.py`` (alerts, risk board, push, CAP): the place's forecast,
  the 24 h from the current hour, with current values;
- ``maps/hazard.py`` (the hazard map): each grid point, the 24 h from the
  slider hour, with current values only for hour 0.

The same inputs therefore give the same levels on every surface
(tests/test_hazard.py checks this end to end).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Sequence

from maps.heat_index import heat_index_c
from thresholds import HAZARDS, LEVEL_RANK, RULES, Rule

WINDOW_HOURS = 24

Series = Sequence[Optional[float]]


@dataclass(frozen=True)
class Current:
    temperature: Optional[float]
    humidity: Optional[float]
    precipitation: Optional[float]
    wind_speed: Optional[float]
    weather_code: Optional[int]


@dataclass(frozen=True)
class WindowFacts:
    rain_mm: Optional[float]
    temp_max: Optional[float]
    temp_min: Optional[float]
    wind_max: Optional[float]
    heat_index_max: Optional[float]
    weather_code: Optional[int]
    hours: int  # hourly values in the window

    def value(self, rule: Rule) -> Optional[float]:
        if rule.parameter == "precipitation":
            return self.rain_mm
        if rule.parameter == "temperature":
            return self.temp_max if rule.comparator == ">=" else self.temp_min
        if rule.parameter == "wind_speed":
            return self.wind_max
        if rule.parameter == "heat_index":
            return self.heat_index_max
        if rule.parameter == "weather_code":
            return None if self.weather_code is None else float(self.weather_code)
        return None

    def as_dict(self) -> dict:
        return {
            "rain_mm": None if self.rain_mm is None else round(self.rain_mm, 1),
            "temp_max": self.temp_max,
            "temp_min": self.temp_min,
            "wind_max": self.wind_max,
            "heat_index_max": self.heat_index_max,
            "weather_code": self.weather_code,
        }


@dataclass(frozen=True)
class Hit:
    rule: Rule
    value: float

    @property
    def hazard(self) -> str:
        return self.rule.hazard

    @property
    def level(self) -> str:
        return self.rule.level

    def as_dict(self) -> dict:
        return {
            "hazard": self.rule.hazard,
            "level": self.rule.level,
            "rule_id": self.rule.id,
            "label": self.rule.label,
            "value": round(self.value, 1),
            "threshold": self.rule.value,
            "comparator": self.rule.comparator,
            "unit": self.rule.unit,
            "window": self.rule.window,
        }


def _vals(xs: Optional[Series], start: int, hours: int) -> list[float]:
    return [v for v in list(xs or [])[start : start + hours] if v is not None]


def window_facts(
    *,
    temperature: Optional[Series],
    humidity: Optional[Series],
    precipitation: Optional[Series],
    wind_speed: Optional[Series],
    weather_code: Optional[Series],
    start: int = 0,
    hours: int = WINDOW_HOURS,
    current: Optional[Current] = None,
) -> WindowFacts:
    temps = _vals(temperature, start, hours)
    winds = _vals(wind_speed, start, hours)
    rains = _vals(precipitation, start, hours)
    t_win = list(temperature or [])[start : start + hours]
    h_win = list(humidity or [])[start : start + hours]
    his = [hi for hi in (heat_index_c(t, h) for t, h in zip(t_win, h_win)) if hi is not None]
    codes = list(weather_code or [])[start : start + hours]

    rain = sum(rains) if rains else None
    code: Optional[int] = int(codes[0]) if codes and codes[0] is not None else None
    if current is not None:
        if current.temperature is not None:
            temps.append(current.temperature)
            hi = heat_index_c(current.temperature, current.humidity)
            if hi is not None:
                his.append(hi)
        if current.wind_speed is not None:
            winds.append(current.wind_speed)
        if current.precipitation is not None:
            rain = current.precipitation if rain is None else max(rain, current.precipitation)
        if current.weather_code is not None:
            code = int(current.weather_code)

    return WindowFacts(
        rain_mm=rain,
        temp_max=max(temps) if temps else None,
        temp_min=min(temps) if temps else None,
        wind_max=max(winds) if winds else None,
        heat_index_max=max(his) if his else None,
        weather_code=code,
        hours=len(t_win),
    )


def _fires(rule: Rule, value: float) -> bool:
    if rule.comparator == ">=":
        return value >= rule.value
    if rule.comparator == "<=":
        return value <= rule.value
    return int(value) in rule.codes


def score(facts: WindowFacts) -> dict[str, Optional[Hit]]:
    """The highest-level rule that fires for each hazard (None when none does)."""
    best: dict[str, Optional[Hit]] = {h: None for h in HAZARDS}
    for rule in RULES:
        value = facts.value(rule)
        if value is None or not _fires(rule, value):
            continue
        cur = best[rule.hazard]
        # strictly higher only: on a tie the earlier rule in RULES wins
        if cur is None or LEVEL_RANK[rule.level] > LEVEL_RANK[cur.level]:
            best[rule.hazard] = Hit(rule, value)
    return best


def level_of(hit: Optional[Hit]) -> str:
    return hit.level if hit else "none"


def overall(hits: dict[str, Optional[Hit]]) -> str:
    return max((level_of(h) for h in hits.values()), key=lambda lvl: LEVEL_RANK[lvl], default="none")
