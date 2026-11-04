"""
The one rule for where a "next 24 h" window starts.

Every surface (alerts, the risk board, push, CAP, the hazard map, the grid
layers and routes) starts its window at the start of the CURRENT LOCAL HOUR of
the place, also in half-hour and 45-minute time zones such as Asia/Kolkata
(UTC+5:30) and Asia/Kathmandu (UTC+5:45).

Open-Meteo puts a place's hourly samples on that place's local hours: for
Asia/Kolkata the hour labelled 14:00 IST is the instant 08:30Z (checked with
``timeformat=unixtime`` on 2026-11-04). So "the sample of the current local
hour" is the sample at the instant where the local hour starts.

``window_start`` takes the samples as UTC instants, the place's UTC offset and
the clock, and returns the index of that sample. If the clock is outside the
series (old cached or recorded data), it tries the model's own current time,
then falls back to the first sample.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional, Sequence

HOUR = timedelta(hours=1)


def now_utc() -> datetime:
    """The clock every window uses (tests replace it)."""
    return datetime.now(timezone.utc)


def local_hour_start(now: datetime, utc_offset_s: int) -> datetime:
    """The UTC instant at which the place's current local hour began."""
    off = timedelta(seconds=utc_offset_s)
    local = (now.astimezone(timezone.utc) + off).replace(minute=0, second=0, microsecond=0)
    return local - off


def window_start(
    instants: Sequence[datetime],
    utc_offset_s: int,
    now: Optional[datetime] = None,
    model_now: Optional[datetime] = None,
) -> int:
    """Index of the sample in the current local hour (see the module docstring)."""
    for clock in (now or now_utc(), model_now):
        if clock is None:
            continue
        start = local_hour_start(clock, utc_offset_s)
        for i, t in enumerate(instants):
            if start <= t < start + HOUR:
                return i
    return 0


def utc_instant(label: str, utc_offset_s: int) -> datetime:
    """An Open-Meteo time label as a UTC instant. Labels without a zone are
    local wall times of the place (timezone=auto)."""
    dt = datetime.fromisoformat(label.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        return (dt - timedelta(seconds=utc_offset_s)).replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def from_unix(ts: int) -> datetime:
    return datetime.fromtimestamp(int(ts), tz=timezone.utc)
