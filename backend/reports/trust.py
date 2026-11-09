"""
How much to trust a community report (docs/REPORTS.md).

score = 0.35 * model + 0.25 * nearby + 0.15 * age + 0.25 * reporter - 0.1 * flags

- model: does the forecast model support it? Asked once, when the report is
  made (``model_agreement``), from Open-Meteo around the report's time and
  place; bands in thresholds.py.
- nearby: confirmations, plus other people's reports of a related kind within
  NEARBY_KM and NEARBY_HOURS; 3 or more give the full share.
- age: 1 when new, falling to 0 at the end of the report's lifetime.
- reporter: the reporter's past reports (their model agreement, confirmations
  and flags), with a prior of 0.5 so a new reporter starts in the middle.
- flags: each flag costs 0.1 (HIDE_AFTER_FLAGS hides it).

Levels: below REPORT_TRUST_MEDIUM low, below REPORT_TRUST_HIGH medium, else
high. A report never changes a forecast number or an alert level.
"""

from __future__ import annotations

import logging
import math
from datetime import datetime, timezone
from typing import Any, Iterable, Optional

import httpx

import open_meteo_access
import thresholds as th
from reports.models import GROUP, LIFETIME, ReportRow, Trust, TrustParts
from weather.open_meteo import TIMEOUT

logger = logging.getLogger(__name__)

WEIGHTS = {"model": 0.35, "nearby": 0.25, "age": 0.15, "reporter": 0.25}
FLAG_PENALTY = 0.1
NEARBY_KM = 2.0
NEARBY_HOURS = 3.0
NEARBY_FULL = 3  # confirmations + corroborating reports for the full share
PRIOR = 0.5
PRIOR_WEIGHT = 2


def km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


# ----------------------------------------------------------- model agreement ---

def agreement_from_series(kind: str, hourly: dict[str, list[Optional[float]]], now_index: int) -> float:
    """
    0..1 support for a report of ``kind`` from Open-Meteo hourly series, where
    ``now_index`` is the index of the report's hour (24 past hours before it).
    """
    def window(key: str, before: int, after: int) -> list[float]:
        values = hourly.get(key) or []
        lo, hi = max(0, now_index - before), min(len(values), now_index + after + 1)
        return [v for v in values[lo:hi] if v is not None]

    if kind in ("heavy_rain", "waterlogging"):
        rain = window("precipitation", 3, 1)
        return th.band(max(rain, default=0.0), th.REPORT_AGREEMENT_RAIN)
    if kind == "hail":
        codes = {int(c) for c in window("weather_code", 3, 1)}
        if codes & set(th.REPORT_AGREEMENT_HAIL_CODES):
            return 1.0
        rain = window("precipitation", 3, 1)
        return 0.6 if max(rain, default=0.0) >= th.RAIN_TRACE_MM_H else 0.2
    if kind in ("strong_wind", "fallen_tree"):
        gust = max(window("wind_gusts_10m", 3, 1), default=0.0)
        score = th.band(gust, th.REPORT_AGREEMENT_GUST)
        if kind == "fallen_tree":
            score = max(score, th.REPORT_AGREEMENT_FALLEN_TREE_FLOOR)
        return score
    if kind in ("landslide", "road_blocked"):
        total = sum(window("precipitation", 24, 0))
        return th.band(total, th.REPORT_AGREEMENT_RAIN_24H)
    return th.REPORT_AGREEMENT_UNKNOWN


async def model_agreement(kind: str, latitude: float, longitude: float, now: Optional[datetime] = None) -> tuple[float, bool]:
    """
    (agreement, known): the model's support for the report, from ONE Open-Meteo
    call (past 24 h and the next 2 h at the point). If the model cannot be
    asked, (REPORT_AGREEMENT_UNKNOWN, False): neither support nor contradiction.
    """
    base: dict[str, Any] = {
        "latitude": f"{latitude:.4f}",
        "longitude": f"{longitude:.4f}",
        "hourly": "precipitation,wind_gusts_10m,weather_code",
        "past_hours": 24,
        "forecast_hours": 2,
        "timezone": "UTC",
        "timeformat": "unixtime",
    }
    try:
        resp = await open_meteo_access.fetch("forecast", base, timeout=TIMEOUT)
        if resp.status_code != 200:
            raise RuntimeError(f"HTTP {resp.status_code}")
        hourly = resp.json().get("hourly") or {}
        times = [int(t) for t in hourly.get("time") or []]
    except (httpx.RequestError, RuntimeError, ValueError, TypeError) as exc:
        logger.warning("Report model agreement unavailable: %s", exc)
        return th.REPORT_AGREEMENT_UNKNOWN, False
    if not times:
        return th.REPORT_AGREEMENT_UNKNOWN, False
    t = (now or datetime.now(timezone.utc)).timestamp()
    # the hour that contains the report time (or the last past hour)
    now_index = max((i for i, ts in enumerate(times) if ts <= t), default=0)
    return round(agreement_from_series(kind, hourly, now_index), 3), True


# ------------------------------------------------------------ reporter history ---

def reporter_accuracy(history: Iterable[ReportRow]) -> float:
    """The reporter's track record, 0..1, with a 0.5 prior (2 reports' weight)."""
    total, n = 0.0, 0
    for r in history:
        acc = r.model_agreement + 0.1 * min(r.confirm_count, 3) - 0.2 * min(r.flag_count, 3)
        total += min(1.0, max(0.0, acc))
        n += 1
    return round((total + PRIOR * PRIOR_WEIGHT) / (n + PRIOR_WEIGHT), 3)


# ------------------------------------------------------------------- trust ---

def nearby_support(report: ReportRow, others: Iterable[ReportRow]) -> int:
    """Other people's reports of a related kind close in space and time."""
    n = 0
    for o in others:
        if o.id == report.id or o.user_id == report.user_id:
            continue
        if GROUP.get(o.kind) != GROUP.get(report.kind):
            continue
        if abs((o.created_at - report.created_at).total_seconds()) > NEARBY_HOURS * 3600:
            continue
        if km(report.latitude, report.longitude, o.latitude, o.longitude) <= NEARBY_KM:
            n += 1
    return n


def level_for(score: float) -> str:
    if score >= th.REPORT_TRUST_HIGH:
        return "high"
    if score >= th.REPORT_TRUST_MEDIUM:
        return "medium"
    return "low"


def trust(report: ReportRow, others: Iterable[ReportRow], now: datetime) -> Trust:
    life = LIFETIME[report.kind].total_seconds()
    age_s = max(0.0, (now - report.created_at).total_seconds())
    parts = TrustParts(
        model=round(report.model_agreement, 3),
        nearby=round(min(1.0, (report.confirm_count + nearby_support(report, others)) / NEARBY_FULL), 3),
        age=round(max(0.0, 1.0 - age_s / life), 3),
        reporter=round(report.reporter_accuracy, 3),
        flags=report.flag_count,
    )
    score = (
        WEIGHTS["model"] * parts.model
        + WEIGHTS["nearby"] * parts.nearby
        + WEIGHTS["age"] * parts.age
        + WEIGHTS["reporter"] * parts.reporter
        - FLAG_PENALTY * parts.flags
    )
    score = round(min(1.0, max(0.0, score)), 3)
    return Trust(level=level_for(score), score=score, parts=parts)
