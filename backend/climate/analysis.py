"""
Climate comparison for chat: a recent window vs the same calendar window in
the previous ``BASELINE_YEARS`` years, from Open-Meteo archive daily values.

Pure computation (``compare_periods``) is separate from the fetch so it can
be tested without the network. Nothing here is estimated: every number is a
mean or sum of archive values, rounded for display.
"""

from __future__ import annotations

from datetime import date, timedelta
from statistics import mean
from typing import Iterable, Optional

from climate.service import fetch_historical_weather
from models.chat import ClimateFacts, ClimatePeriod
from models.climate import HistoricalDaily

BASELINE_YEARS = 10
# The archive (reanalysis) lags real time by several days.
ARCHIVE_LAG_DAYS = 6
# A window shorter than this is too noisy; fall back to the last 30 days.
MIN_WINDOW_DAYS = 14
# Below this share of days with data, a year is left out of the baseline.
MIN_COVERAGE = 0.8


def _shift_year(d: date, years: int) -> date:
    try:
        return d.replace(year=d.year - years)
    except ValueError:  # 29 Feb in a non-leap year
        return d.replace(year=d.year - years, day=28)


def period_window(period: ClimatePeriod, today: date) -> tuple[ClimatePeriod, date, date]:
    """(effective period, start, end) of the recent window, ending at the archive's edge."""
    end = today - timedelta(days=ARCHIVE_LAG_DAYS)
    if period == "this_year":
        start = date(end.year, 1, 1)
    elif period == "this_month":
        start = end.replace(day=1)
    else:
        start = end - timedelta(days=29)
    if (end - start).days + 1 < MIN_WINDOW_DAYS:
        return "last_30_days", end - timedelta(days=29), end
    return period, start, end


def _summarise(days: Iterable[HistoricalDaily], expected: int) -> Optional[dict]:
    rows = list(days)
    tmax = [d.temperature_max for d in rows if d.temperature_max is not None]
    tmin = [d.temperature_min for d in rows if d.temperature_min is not None]
    rain = [d.precipitation_sum for d in rows if d.precipitation_sum is not None]
    if not tmax or len(tmax) < MIN_COVERAGE * expected:
        return None
    return {
        "days": len(tmax),
        "tmax": mean(tmax),
        "tmin": mean(tmin) if tmin else None,
        # scale to the full window so a missing day or two does not read as "drier"
        "rain": sum(rain) * expected / len(rain) if rain else None,
    }


def _r(value: Optional[float], digits: int = 1) -> Optional[float]:
    return None if value is None else round(value, digits)


def compare_periods(
    daily: list[HistoricalDaily],
    period: ClimatePeriod,
    start: date,
    end: date,
    location: str,
    timezone: str,
) -> ClimateFacts:
    """Recent window vs the same window in each of the previous BASELINE_YEARS years."""
    by_date = {d.date_: d for d in daily}
    length = (end - start).days + 1

    def window(s: date, e: date) -> list[HistoricalDaily]:
        out, d = [], s
        while d <= e:
            if d in by_date:
                out.append(by_date[d])
            d += timedelta(days=1)
        return out

    recent = _summarise(window(start, end), length)
    baseline = []
    for years_back in range(1, BASELINE_YEARS + 1):
        s, e = _shift_year(start, years_back), _shift_year(end, years_back)
        summary = _summarise(window(s, e), (e - s).days + 1)
        if summary:
            baseline.append(summary)

    facts = ClimateFacts(
        location=location,
        timezone=timezone,
        period=period,
        period_start=start.isoformat(),
        period_end=end.isoformat(),
        baseline_start_year=start.year - BASELINE_YEARS,
        baseline_end_year=start.year - 1,
        baseline_years=len(baseline),
        days_with_data=recent["days"] if recent else 0,
        available=bool(recent and baseline),
    )
    if not recent or not baseline:
        return facts

    base_tmax = mean(b["tmax"] for b in baseline)
    tmins = [b["tmin"] for b in baseline if b["tmin"] is not None]
    rains = [b["rain"] for b in baseline if b["rain"] is not None]
    base_tmin = mean(tmins) if tmins else None
    base_rain = mean(rains) if rains else None

    facts.mean_temperature_max = _r(recent["tmax"])
    facts.mean_temperature_min = _r(recent["tmin"])
    facts.total_precipitation = _r(recent["rain"])
    facts.baseline_mean_temperature_max = _r(base_tmax)
    facts.baseline_mean_temperature_min = _r(base_tmin)
    facts.baseline_total_precipitation = _r(base_rain)
    # Anomalies from the rounded values, so the reply's arithmetic adds up.
    facts.temperature_max_anomaly = _r(facts.mean_temperature_max - facts.baseline_mean_temperature_max)
    if facts.mean_temperature_min is not None and facts.baseline_mean_temperature_min is not None:
        facts.temperature_min_anomaly = _r(facts.mean_temperature_min - facts.baseline_mean_temperature_min)
    if facts.total_precipitation is not None and base_rain:
        facts.precipitation_anomaly_percent = int(round((recent["rain"] - base_rain) / base_rain * 100))
    return facts


async def fetch_climate_facts(
    latitude: float,
    longitude: float,
    location: str,
    period: ClimatePeriod,
    today: date,
) -> ClimateFacts:
    """One archive request covering the recent window and all baseline windows."""
    period, start, end = period_window(period, today)
    first = _shift_year(start, BASELINE_YEARS)
    archive = await fetch_historical_weather(latitude, longitude, first.isoformat(), end.isoformat())
    return compare_periods(archive.daily, period, start, end, location, archive.timezone)
