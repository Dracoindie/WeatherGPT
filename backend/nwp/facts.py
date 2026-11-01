"""
GFS output summarised over a chat date reference.

Forecast hour ``h`` of a run is valid at ``run + h hours`` (UTC). Valid times
are converted to the location's timezone and filtered with the same windows
the Open-Meteo path uses (query_service._hour_in_window), so "tomorrow" means
the same local hours in both.
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from typing import Optional

from models.chat import ChatIntent, NwpFacts
from nwp.models import NwpResponse
from query_service import _hour_in_window, _label, _zone

MAX_HOURS = 48
# GFS cycles are published roughly 4-6 h after their nominal time.
RUN_LAG_HOURS = 7


def hourly_precipitation(apcp: list[float]) -> list[float]:
    """
    Per-hour precipitation from GFS APCP.

    In the 0.25° hourly files APCP at forecast hour h accumulates from the
    start of its 6-hour bucket (f001..f006 are 0-1 ... 0-6 h sums, then it
    resets). Index i is forecast hour i; hour 0 has no accumulation.
    """
    out: list[float] = []
    for h, value in enumerate(apcp):
        if h == 0:
            out.append(0.0)
        elif (h - 1) % 6 == 0:
            out.append(max(0.0, value))
        else:
            out.append(max(0.0, value - apcp[h - 1]))
    return out


def hours_to_request(intent: ChatIntent, tz_name: str, now_utc: datetime) -> Optional[int]:
    """Forecast hours needed to cover the window, or None if it is beyond MAX_HOURS."""
    tz = _zone(tz_name)
    now = now_utc.astimezone(tz)
    if intent.date_reference == "now":
        return 1 + RUN_LAG_HOURS
    end = now
    probe = now.replace(minute=0, second=0, microsecond=0)
    for _ in range(24 * 8):
        if _hour_in_window(probe, now, intent.date_reference):
            end = probe
        probe += timedelta(hours=1)
    needed = math.ceil((end - now).total_seconds() / 3600) + 1 + RUN_LAG_HOURS
    return needed if needed <= MAX_HOURS else None


def summarise_nwp(
    nwp: NwpResponse,
    intent: ChatIntent,
    location: str,
    tz_name: str,
    now_utc: datetime,
) -> NwpFacts:
    tz = _zone(tz_name)
    now = now_utc.astimezone(tz)
    run = datetime.fromisoformat(nwp.metadata.generationTime)
    if run.tzinfo is None:
        run = run.replace(tzinfo=timezone.utc)

    valid = [(run + timedelta(hours=f.hour)).astimezone(tz) for f in nwp.forecasts]
    if intent.date_reference == "now":
        # the model hour closest to now
        best = min(range(len(valid)), key=lambda i: abs((valid[i] - now).total_seconds()), default=None)
        picked = [best] if best is not None and abs((valid[best] - now).total_seconds()) <= 3 * 3600 else []
    else:
        picked = [i for i, v in enumerate(valid) if _hour_in_window(v, now, intent.date_reference) and v >= now - timedelta(hours=1)]

    label = _label(intent.date_reference)
    if not picked:
        return NwpFacts(
            run=run.isoformat(),
            location=location,
            requested_time=label,
            timezone=tz_name,
            hours=0,
            period_available=False,
        )
    rows = [nwp.forecasts[i] for i in picked]
    rain = hourly_precipitation([f.precipitationMm for f in nwp.forecasts])
    temps = [r.temperatureC for r in rows if not math.isnan(r.temperatureC)]
    start, end = valid[picked[0]], valid[picked[-1]]
    return NwpFacts(
        run=run.isoformat(),
        location=location,
        requested_time=f"{label} ({start.strftime('%Y-%m-%dT%H:%M')} to {end.strftime('%Y-%m-%dT%H:%M')})",
        timezone=tz_name,
        hours=len(rows),
        temperature_min=round(min(temps), 1) if temps else None,
        temperature_max=round(max(temps), 1) if temps else None,
        precipitation=round(sum(rain[i] for i in picked), 1),
        wind_speed_max=round(max(r.windMs for r in rows) * 3.6, 1),
    )
