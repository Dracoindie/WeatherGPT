"""
Community report types and the public shape the API returns.

A public report never carries the reporter's identity: no user id, no name,
and a creation time rounded down to 10 minutes ("about 40 min ago").
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Literal, Optional

from pydantic import BaseModel

ReportKind = Literal["waterlogging", "fallen_tree", "landslide", "hail", "heavy_rain", "strong_wind", "road_blocked"]
KINDS: tuple[str, ...] = ("waterlogging", "fallen_tree", "landslide", "hail", "heavy_rain", "strong_wind", "road_blocked")

# How long a report stays on the map.
LIFETIME = {kind: timedelta(hours=6) for kind in KINDS}
LIFETIME["landslide"] = timedelta(hours=24)
LIFETIME["road_blocked"] = timedelta(hours=24)

# Kinds that corroborate each other (a waterlogging report near a heavy-rain
# report supports both).
GROUP = {
    "heavy_rain": "rain",
    "waterlogging": "rain",
    "hail": "rain",
    "strong_wind": "wind",
    "fallen_tree": "wind",
    "landslide": "ground",
    "road_blocked": "ground",
}

HIDE_AFTER_FLAGS = 3  # a report with this many flags is hidden for everyone
NOTE_MAX = 280
APPROX_MINUTES = 10  # public times are rounded down to this

LABEL = "Community report, unverified. Not an official warning; it never changes forecasts or alert levels."

Vote = Literal["confirm", "flag"]
TrustLevel = Literal["low", "medium", "high"]


@dataclass
class ReportRow:
    """A stored report (server side only: it holds the reporter's id)."""

    id: str
    user_id: str
    kind: str
    latitude: float
    longitude: float
    created_at: datetime
    expires_at: datetime
    model_agreement: float
    reporter_accuracy: float
    note: Optional[str] = None
    photo_path: Optional[str] = None
    confirm_count: int = 0
    flag_count: int = 0
    model_known: bool = True
    votes: dict[str, str] = field(default_factory=dict)  # memory store only

    def live(self, now: datetime) -> bool:
        return self.expires_at > now and self.flag_count < HIDE_AFTER_FLAGS


class TrustParts(BaseModel):
    model: float
    nearby: float
    age: float
    reporter: float
    flags: int


class Trust(BaseModel):
    level: TrustLevel
    score: float
    parts: TrustParts


class PublicReport(BaseModel):
    id: str
    kind: ReportKind
    latitude: float
    longitude: float
    note: Optional[str]
    has_photo: bool
    # rounded down to 10 minutes: the time is approximate on purpose
    reported_at: str
    expires_at: str
    confirms: int
    flags: int
    trust: Trust
    # the caller's own vote ("confirm" / "flag"), and whether this is the caller's report
    my_vote: Optional[Vote] = None
    mine: bool = False
    reporter: str = "a resident"


class ReportList(BaseModel):
    reports: list[PublicReport]
    label: str = LABEL
    hide_after_flags: int = HIDE_AFTER_FLAGS


def approx(ts: datetime) -> datetime:
    ts = ts.astimezone(timezone.utc)
    return ts.replace(minute=ts.minute - ts.minute % APPROX_MINUTES, second=0, microsecond=0)


def iso(ts: datetime) -> str:
    return ts.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
