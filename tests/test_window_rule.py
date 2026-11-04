"""
One window rule for every surface (backend/window_rule.py): a "next 24 h"
window starts at the start of the place's CURRENT LOCAL HOUR, also in
half-hour (Asia/Kolkata, UTC+5:30) and 45-minute (Asia/Kathmandu, UTC+5:45)
time zones.

The agreement tests freeze the clock inside the half hour that used to differ
(14:20 IST = 08:50Z: alerts started at 14:00 IST = 08:30Z, the map at the UTC
hour 08:00Z) and put rain exactly on the window's edges. Alerts, the risk
board, push, the hazard map (hex and summary) must all include or exclude the
same samples. Open-Meteo is mocked like the real API: the forecast with local
labels from local midnight, tiles with unix instants on local hours.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

import h3
import httpx
import pytest
from fastapi.testclient import TestClient

import window_rule as W
from main import app
from maps import tiles as T
from thresholds import HAZARDS, LEVEL_RANK

client = TestClient(app)
UTC = timezone.utc

ZONES = {
    "Asia/Kolkata": 19800,  # +5:30
    "Asia/Kathmandu": 20700,  # +5:45
    "Europe/London": 0,  # whole hour (GMT in November)
}


def test_local_hour_start_in_half_and_quarter_hour_zones():
    now = datetime(2026, 11, 4, 8, 50, tzinfo=UTC)  # 14:20 IST, 14:35 NPT
    assert W.local_hour_start(now, 19800) == datetime(2026, 11, 4, 8, 30, tzinfo=UTC)
    assert W.local_hour_start(now, 20700) == datetime(2026, 11, 4, 8, 15, tzinfo=UTC)
    assert W.local_hour_start(now, 0) == datetime(2026, 11, 4, 8, 0, tzinfo=UTC)
    # 08:20Z is 13:50 IST: the local hour began at 07:30Z
    assert W.local_hour_start(now.replace(minute=20), 19800) == datetime(2026, 11, 4, 7, 30, tzinfo=UTC)


def test_window_start_picks_the_current_local_hour_sample():
    # Open-Meteo labels for Asia/Kolkata: 13:00 IST is the instant 07:30Z
    labels = [f"2026-11-04T{h:02d}:00" for h in range(12, 18)]
    instants = [W.utc_instant(t, 19800) for t in labels]
    assert instants[1] == datetime(2026, 11, 4, 7, 30, tzinfo=UTC)

    def at(h: int, m: int) -> datetime:
        return datetime(2026, 11, 4, h, m, tzinfo=UTC)

    assert labels[W.window_start(instants, 19800, now=at(8, 50))] == "2026-11-04T14:00"  # 14:20 IST
    assert labels[W.window_start(instants, 19800, now=at(8, 29))] == "2026-11-04T13:00"  # 13:59 IST
    assert labels[W.window_start(instants, 19800, now=at(8, 30))] == "2026-11-04T14:00"  # 14:00 IST
    # a clock outside the series falls back to the model's time, then to 0
    far = datetime(2000, 1, 1, tzinfo=UTC)
    assert W.window_start(instants, 19800, now=far, model_now=at(10, 40)) == 4  # 16:10 IST
    assert W.window_start(instants, 19800, now=far) == 0


# ---------------------------------------------------------------------------
# Agreement with a frozen clock
# ---------------------------------------------------------------------------

NOW = datetime(2026, 11, 4, 8, 50, tzinfo=UTC)
PLACE = (18.52, 73.86)
CALM = {"temperature_2m": 28.0, "relative_humidity_2m": 50.0, "precipitation": 0.0, "wind_speed_10m": 10.0, "weather_code": 1}


def _hour0(offset: int) -> datetime:
    """The UTC instant of the current local hour's sample."""
    return W.local_hour_start(NOW, offset)


def _row(rain_at: set[int], k: int) -> dict:
    v = {**CALM}
    if k in rain_at:
        v["precipitation"] = 60.0  # one sample alone is a warning (>= 50 mm in 24 h)
    v.update({"apparent_temperature": v["temperature_2m"], "precipitation_probability": 50, "wind_direction_10m": 250.0})
    return v


def _forecast(zone: str, rain_at: set[int], lat: float, lon: float) -> dict:
    """Open-Meteo with timezone=auto: local labels from local midnight, 7 days."""
    off = ZONES[zone]
    local_now = (NOW + timedelta(seconds=off)).replace(tzinfo=None)
    midnight = local_now.replace(hour=0, minute=0, second=0, microsecond=0)
    h0 = (local_now.replace(minute=0, second=0, microsecond=0) - midnight) // timedelta(hours=1)
    times = [(midnight + timedelta(hours=i)).strftime("%Y-%m-%dT%H:%M") for i in range(168)]
    rows = [_row(rain_at, i - h0) for i in range(168)]
    cur_label = local_now.replace(minute=local_now.minute // 15 * 15).strftime("%Y-%m-%dT%H:%M")
    return {
        "latitude": lat, "longitude": lon, "timezone": zone, "utc_offset_seconds": off, "elevation": 500.0,
        "current": {"time": cur_label, **CALM, "wind_direction_10m": 250.0},
        "hourly": {"time": times, **{key: [r[key] for r in rows] for key in rows[0]}},
    }


def _tile_point(zone: str, rain_at: set[int], lat: float, lon: float, fetched_hours_ago: int, q) -> dict:
    """Open-Meteo for map tiles. With timezone=auto&timeformat=unixtime: unix
    instants on the point's local hours, starting at the local hour when the
    tile was fetched. With timezone=GMT (the old request): the same values on
    whole UTC hours, as ISO labels (Open-Meteo's 08:00Z holds the 13:00 IST
    values: checked against the live API on 2026-11-04)."""
    off = ZONES[zone]
    first = _hour0(off) - timedelta(hours=fetched_hours_ago)
    instants = [first + timedelta(hours=i) for i in range(73)]
    rows = [_row(rain_at, i - fetched_hours_ago) for i in range(73)]
    cur_t = first + timedelta(minutes=15)
    if q.get("timezone") == "GMT":
        shift = timedelta(seconds=(-first.timestamp()) % 3600)
        times: list = [(t + shift).strftime("%Y-%m-%dT%H:%M") for t in instants]
        cur = cur_t.strftime("%Y-%m-%dT%H:%M")
        off = 0
    else:
        assert q.get("timezone") == "auto" and q.get("timeformat") == "unixtime"
        times = [int(t.timestamp()) for t in instants]
        cur = int(cur_t.timestamp())
    return {
        "latitude": lat, "longitude": lon, "elevation": 500.0, "utc_offset_seconds": off,
        "current": {"time": cur, **{k: CALM[k] for k in T.CURRENT}},
        "hourly": {"time": times, **{key: [r[key] for r in rows] for key in T.HOURLY}},
    }


@pytest.fixture
def upstream(monkeypatch):
    state = {"zone": "Asia/Kolkata", "rain_at": set(), "fetched_hours_ago": 0}
    real = httpx.AsyncClient

    def handler(request: httpx.Request) -> httpx.Response:
        q = request.url.params
        lats = [float(v) for v in q["latitude"].split(",")]
        lons = [float(v) for v in q["longitude"].split(",")]
        if "forecast_hours" in q:
            body = [_tile_point(state["zone"], state["rain_at"], a, b, state["fetched_hours_ago"], q) for a, b in zip(lats, lons)]
            return httpx.Response(200, json=body if len(body) > 1 else body[0])
        return httpx.Response(200, json=_forecast(state["zone"], state["rain_at"], lats[0], lons[0]))

    def factory(*args, **kwargs):
        kwargs.pop("verify", None)
        return real(*args, transport=httpx.MockTransport(handler), **kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", factory)
    monkeypatch.setattr(W, "now_utc", lambda: NOW)
    return state


def _levels_everywhere() -> dict[str, str]:
    from alerts.engine import evaluate_alerts
    from dissemination.job import level as push_level
    from models.roles import DistrictIn
    from query_service import fetch_validated_weather
    from roles.risk import risk_board

    lat, lon = PLACE
    alerts = client.get(f"/api/alerts?latitude={lat}&longitude={lon}").json()["alerts"]
    lv = {h: "none" for h in HAZARDS}
    for a in alerts:
        lv[a["alert_type"]] = a["severity"]
    alert_overall = max(lv.values(), key=lambda x: LEVEL_RANK[x])

    hz = client.get(f"/api/map/hazard?south={lat - 0.2}&west={lon - 0.2}&north={lat + 0.2}&east={lon + 0.2}&hour=0").json()
    cell = h3.latlng_to_cell(lat, lon, hz["h3_resolution"])
    point = hz["points"][dict(map(tuple, hz["cells"]))[cell]]
    s = client.get(f"/api/map/hazard/summary?latitude={lat}&longitude={lon}").json()
    board = asyncio.run(risk_board([DistrictIn(name="Pune", latitude=lat, longitude=lon)]))
    weather = asyncio.run(fetch_validated_weather(lat, lon))
    return {
        "alerts": alert_overall,
        "hazard_hex": point["overall"],
        "summary": s["worst_now"]["level"] if s["worst_now"] else "none",
        "risk_board": board.districts[0].severity,
        "push": push_level(evaluate_alerts(weather)),
        "window_start": hz["window_start"],
    }


CASES = {
    # sample k is k local hours after the current one (k=0: 14:00 IST at 14:20 IST)
    "rain in the previous local hour only": ({-1}, "none"),
    "rain in the current local hour": ({0}, "warning"),
    "rain in the last hour of the window": ({23}, "warning"),
    "rain just after the window": ({24}, "none"),
}


@pytest.mark.parametrize("zone", list(ZONES))
@pytest.mark.parametrize("fetched_hours_ago", [0, 1])
@pytest.mark.parametrize("case", list(CASES))
def test_every_surface_uses_the_same_window(upstream, zone, fetched_hours_ago, case):
    rain_at, expected = CASES[case]
    upstream.update(zone=zone, rain_at=rain_at, fetched_hours_ago=fetched_hours_ago)
    got = _levels_everywhere()
    expect_start = _hour0(ZONES[zone]).strftime("%Y-%m-%dT%H:%MZ")
    assert got.pop("window_start") == expect_start, (zone, case)
    assert set(got.values()) == {expected}, (zone, case, got)
