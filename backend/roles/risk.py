"""
District risk board for disaster managers: the deterministic alert engine run
for each district, sorted most severe first.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from alerts.engine import evaluate_alerts
from models.roles import DistrictIn, DistrictRisk, RiskBoard
from query_service import fetch_validated_weather

logger = logging.getLogger(__name__)

RANK = {"warning": 3, "watch": 2, "advisory": 1, "none": 0, "unknown": -1}
# Open-Meteo is polite-use: a handful of requests at a time.
CONCURRENCY = 6


async def _district(d: DistrictIn, gate: asyncio.Semaphore) -> DistrictRisk:
    async with gate:
        try:
            weather = await fetch_validated_weather(d.latitude, d.longitude)
        except RuntimeError as exc:
            logger.warning("Risk board: weather fetch failed for %s: %s", d.name, exc)
            return DistrictRisk(**d.model_dump(), severity="unknown", error="Weather service did not respond")
    alerts = evaluate_alerts(weather)
    top = max(alerts, key=lambda a: RANK[a.severity], default=None)
    h = weather.hourly
    n = min(24, len(h.time))
    return DistrictRisk(
        **d.model_dump(),
        severity=top.severity if top else "none",
        alerts_count=len(alerts),
        headline=top.headline if top else None,
        rain_24h_mm=round(sum(p for p in h.precipitation[:n] if p is not None), 1),
        max_wind_24h_kmh=round(max(h.wind_speed_10m[:n]), 1) if n else None,
        max_temperature_24h_c=round(max(h.temperature_2m[:n]), 1) if n else None,
    )


def sort_board(rows: list[DistrictRisk]) -> list[DistrictRisk]:
    """Most severe first; ties by 24 h rain, then wind (both descending), then name."""
    return sorted(
        rows,
        key=lambda r: (-RANK[r.severity], -(r.rain_24h_mm or 0), -(r.max_wind_24h_kmh or 0), r.name),
    )


async def risk_board(districts: list[DistrictIn]) -> RiskBoard:
    gate = asyncio.Semaphore(CONCURRENCY)
    rows = await asyncio.gather(*(_district(d, gate) for d in districts))
    return RiskBoard(generated_at=datetime.now(timezone.utc), districts=sort_board(list(rows)))
