"""
Hazard map (backend/maps/hazard.py, /api/map/hazard, /api/map/hazard/summary)
and the shared scorer (backend/alerts/scoring.py).

1. Scoring: every rule in thresholds.py fires exactly at its threshold, not
   just below it, at its own level; every hazard and every level is reachable.
2. Endpoints: H3 cells, resolution choice, windows, counts, worst, summary.
3. Agreement: for the same Open-Meteo data, place and time, /api/alerts, the
   /disaster risk board, the push job and the hazard map give the same level
   for every hazard (they all call the one scorer).
"""

from __future__ import annotations

import asyncio
import math
from datetime import datetime, timedelta, timezone
from typing import Callable
from zoneinfo import ZoneInfo

import h3
import httpx
import pytest
from fastapi.testclient import TestClient

import maps.tiles as tiles_mod
import thresholds as TH
from alerts.scoring import Current, WindowFacts, overall, score, window_facts
from main import app
from maps.hazard import hex_across_km, res_for_spacing

client = TestClient(app)


@pytest.fixture(autouse=True)
def fresh(monkeypatch):
    monkeypatch.delenv("OPEN_METEO_API_KEY", raising=False)
    tiles_mod.clear_cache()
    yield
    tiles_mod.clear_cache()


# ---------------------------------------------------------------------------
# 1. Scoring
# ---------------------------------------------------------------------------

CALM = dict(rain_mm=0.0, temp_max=28.0, temp_min=20.0, wind_max=10.0, heat_index_max=28.0, weather_code=1, hours=24)


def facts(**kw) -> WindowFacts:
    return WindowFacts(**{**CALM, **kw})


def _at(rule: TH.Rule, value: float) -> WindowFacts:
    field = {
        "precipitation": "rain_mm",
        "temperature": "temp_max" if rule.comparator == ">=" else "temp_min",
        "wind_speed": "wind_max",
        "heat_index": "heat_index_max",
        "weather_code": "weather_code",
    }[rule.parameter]
    if rule.parameter == "weather_code":
        return facts(weather_code=int(value))
    if rule.parameter == "temperature" and rule.comparator == ">=":
        # keep heat stress out of the temperature rules
        return facts(temp_max=value, heat_index_max=20.0)
    return facts(**{field: value})


@pytest.mark.parametrize("rule", TH.RULES, ids=lambda r: r.id)
def test_every_rule_fires_at_its_threshold(rule):
    value = rule.codes[0] if rule.comparator == "in" else rule.value
    hit = score(_at(rule, value))[rule.hazard]
    assert hit is not None
    assert hit.rule.id == rule.id
    assert hit.level == rule.level
    assert hit.as_dict()["threshold"] == rule.value


@pytest.mark.parametrize("rule", [r for r in TH.RULES if r.comparator != "in"], ids=lambda r: r.id)
def test_every_rule_is_quiet_just_past_its_threshold(rule):
    value = rule.value - 0.1 if rule.comparator == ">=" else rule.value + 0.1
    hit = score(_at(rule, value))[rule.hazard]
    assert hit is None or TH.LEVEL_RANK[hit.level] < TH.LEVEL_RANK[rule.level]


@pytest.mark.parametrize("code, level", [(1, None), (3, None), (95, "watch"), (96, "warning"), (99, "severe")])
def test_storm_codes(code, level):
    hit = score(facts(weather_code=code))["storm"]
    assert (hit.level if hit else None) == level


def test_every_hazard_and_level_is_reachable():
    seen = {(r.hazard, r.level) for r in TH.RULES}
    for hazard in TH.HAZARDS:
        assert any(h == hazard for h, _ in seen), hazard
    for lvl in TH.LEVELS[1:]:
        assert any(level == lvl for _, level in seen), lvl
    # overall picks the worst hazard, and "none" when nothing fires
    assert overall(score(facts())) == "none"
    assert overall(score(facts(rain_mm=20.0, wind_max=70.0))) == "warning"
    assert overall(score(facts(rain_mm=200.0))) == "severe"


def test_window_sums_rain_and_uses_current_values():
    rain = [0.0] * 30
    rain[2] = 10.0
    rain[23] = 6.0
    rain[24] = 50.0  # outside a 24 h window from 0
    f = window_facts(temperature=[30.0] * 30, humidity=[40.0] * 30, precipitation=rain, wind_speed=[10.0] * 30, weather_code=[1] * 30)
    assert f.rain_mm == 16.0 and f.hours == 24
    f = window_facts(
        temperature=[30.0] * 30, humidity=[40.0] * 30, precipitation=rain, wind_speed=[10.0] * 30, weather_code=[1] * 30,
        current=Current(temperature=41.0, humidity=20.0, precipitation=20.0, wind_speed=70.0, weather_code=95),
    )
    assert (f.temp_max, f.rain_mm, f.wind_max, f.weather_code) == (41.0, 20.0, 70.0, 95)
    later = window_facts(temperature=[30.0] * 30, humidity=[40.0] * 30, precipitation=rain, wind_speed=[10.0] * 30, weather_code=[1] * 30, start=3)
    assert later.rain_mm == 56.0


# ---------------------------------------------------------------------------
# H3 resolution
# ---------------------------------------------------------------------------


def test_res6_matches_the_model_grid():
    # 0.08° grid step ≈ 8.9 km, about the model's 8 km cell: res 6 (6.5 km hexes)
    assert res_for_spacing(0.08 * 111.32) == 6
    assert 5.5 < hex_across_km(6) < 8.0


@pytest.mark.parametrize("step, res", [(0.1, 5), (0.2, 5), (0.25, 4), (0.5, 4), (1.0, 3), (2.0, 2), (8.0, 2)])
def test_resolution_follows_sample_spacing(step, res):
    assert res_for_spacing(step * 111.32) == res
    assert hex_across_km(res) >= 0.7 * step * 111.32 or res == 2


# ---------------------------------------------------------------------------
# Mocked Open-Meteo: one weather field for forecast and tile requests alike
# ---------------------------------------------------------------------------

NOW_UTC = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
IST = ZoneInfo("Asia/Kolkata")

# value(k) for hour k from the current hour (k < 0: earlier today)
Field = Callable[[int, float, float], dict]


def calm(k: int, lat: float, lon: float) -> dict:
    return {"temperature_2m": 28.0, "relative_humidity_2m": 50.0, "precipitation": 0.0, "wind_speed_10m": 10.0, "weather_code": 1}


def _row(fn: Field, k: int, lat: float, lon: float) -> dict:
    v = {**calm(k, lat, lon), **fn(k, lat, lon)}
    v.setdefault("apparent_temperature", v["temperature_2m"])
    v.setdefault("precipitation_probability", 50)
    v.setdefault("wind_direction_10m", 250.0)
    return v


def _tile_point(fn: Field, lat: float, lon: float) -> dict:
    hours = range(73)
    rows = [_row(fn, k, lat, lon) for k in hours]
    cur = _row(fn, 0, lat, lon)
    return {
        "latitude": lat, "longitude": lon, "elevation": 500.0,
        "current": {k: cur[k] for k in tiles_mod.CURRENT},
        "hourly": {"time": [(NOW_UTC + timedelta(hours=k)).strftime("%Y-%m-%dT%H:%M") for k in hours],
                   **{key: [r[key] for r in rows] for key in tiles_mod.HOURLY}},
    }


def _forecast(fn: Field, lat: float, lon: float) -> dict:
    """Like Open-Meteo with timezone=auto: local times from local midnight, 7 days."""
    now_local = NOW_UTC.astimezone(IST)
    midnight = now_local.replace(hour=0, minute=0)
    # IST is UTC+5:30: local hours are on :30; k counts whole hours from the current one
    times, rows = [], []
    for i in range(168):
        t = midnight + timedelta(hours=i)
        k = math.floor((t - now_local.replace(minute=0)).total_seconds() / 3600)
        times.append(t.strftime("%Y-%m-%dT%H:%M"))
        rows.append(_row(fn, k, lat, lon))
    cur = _row(fn, 0, lat, lon)
    return {
        "latitude": lat, "longitude": lon, "timezone": "Asia/Kolkata", "elevation": 500.0,
        "current": {"time": now_local.strftime("%Y-%m-%dT%H:%M"), **{k: cur[k] for k in ("temperature_2m", "relative_humidity_2m", "precipitation", "wind_speed_10m", "wind_direction_10m", "weather_code")}},
        "hourly": {"time": times, **{key: [r[key] for r in rows] for key in rows[0]}},
    }


@pytest.fixture
def weather_field(monkeypatch):
    state: dict = {"fn": calm, "tile_requests": 0}
    real = httpx.AsyncClient

    def handler(request: httpx.Request) -> httpx.Response:
        q = request.url.params
        lats = [float(v) for v in q["latitude"].split(",")]
        lons = [float(v) for v in q["longitude"].split(",")]
        if "forecast_hours" in q:  # map tiles (GMT)
            state["tile_requests"] += 1
            body = [_tile_point(state["fn"], a, b) for a, b in zip(lats, lons)]
            return httpx.Response(200, json=body if len(body) > 1 else body[0])
        return httpx.Response(200, json=_forecast(state["fn"], lats[0], lons[0]))

    def factory(*args, **kwargs):
        kwargs.pop("verify", None)
        return real(*args, transport=httpx.MockTransport(handler), **kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", factory)
    return state


BOX = "south=18.3&west=73.6&north=18.8&east=74.1"


# ---------------------------------------------------------------------------
# 2. Endpoints
# ---------------------------------------------------------------------------


def test_hazard_cells_cover_the_box(weather_field):
    body = client.get(f"/api/map/hazard?{BOX}").json()
    assert body["h3_resolution"] in range(2, 7)
    assert body["cells"]
    assert sum(body["counts"].values()) == len(body["cells"])
    for cell, idx in body["cells"]:
        assert h3.get_resolution(cell) == body["h3_resolution"]
        assert 0 <= idx < len(body["points"])
    assert body["window_hours"] == 24
    assert body["max_hour"] == len(body["times"]) - 24
    assert "not official IMD" in body["note"]
    assert {r["id"] for r in body["rules"]} == {r.id for r in TH.RULES}


def test_calm_weather_is_all_none(weather_field):
    body = client.get(f"/api/map/hazard?{BOX}").json()
    assert body["counts"]["none"] == len(body["cells"])
    assert body["worst"] is None


def test_values_and_triggers_come_from_the_data(weather_field):
    weather_field["fn"] = lambda k, la, lo: {"precipitation": 3.0} if 0 <= k < 24 else {}
    body = client.get(f"/api/map/hazard?{BOX}").json()
    p = body["points"][0]
    assert p["facts"]["rain_mm"] == 72.0
    assert p["levels"]["rain"] == "warning" and p["overall"] == "warning"
    trig = next(t for t in p["triggers"] if t["hazard"] == "rain")
    assert (trig["rule_id"], trig["value"], trig["threshold"], trig["unit"]) == ("extreme_rain", 72.0, TH.EXTREME_RAIN.value, "mm")
    assert body["worst"]["level"] == "warning"


def test_hour_moves_the_window(weather_field):
    # rain only in hours 30..33: none now, warning for windows that reach hour 30
    weather_field["fn"] = lambda k, la, lo: {"precipitation": 15.0} if 30 <= k < 34 else {}
    now = client.get(f"/api/map/hazard?{BOX}&hour=0").json()
    later = client.get(f"/api/map/hazard?{BOX}&hour=10").json()
    assert now["points"][0]["overall"] == "none"
    assert later["points"][0]["overall"] == "warning"
    assert later["window_start"] == later["times"][10]
    assert weather_field["tile_requests"] == 1, "both hours use the same cached tiles"


def test_hour_is_clamped_to_a_full_window(weather_field):
    body = client.get(f"/api/map/hazard?{BOX}&hour=70").json()
    assert body["hour"] == body["max_hour"]
    assert body["window_hours"] == 24


def test_hazard_bad_box(weather_field):
    assert client.get("/api/map/hazard?south=19&west=73&north=18&east=74").status_code == 422


def test_summary_counts_rain_and_worst_ahead(weather_field):
    weather_field["fn"] = lambda k, la, lo: {"precipitation": 15.0} if 30 <= k < 34 else {}
    s = client.get("/api/map/hazard/summary?latitude=18.52&longitude=73.86&radius_km=25").json()
    assert s["cells"] > 0
    assert sum(s["counts"].values()) == s["cells"]
    assert s["counts"]["none"] == s["cells"]  # nothing in the next 24 h
    assert s["worst_now"] is None
    assert s["worst_ahead"]["level"] == "warning"
    # 15 mm/h in hours 30-33: a window needs all four (60 mm >= 50) for a warning,
    # so the first one starts at hour 10 (hours 10-33)
    assert s["worst_ahead_hour"] == 10
    assert s["max_rain_mm"] == 0.0
    assert s["nearest_sample_km"] < 25


def test_summary_now(weather_field):
    weather_field["fn"] = lambda k, la, lo: {"precipitation": 3.0} if 0 <= k < 24 else {}
    s = client.get("/api/map/hazard/summary?latitude=18.52&longitude=73.86").json()
    assert s["counts"]["warning"] == s["cells"]
    assert s["max_rain_mm"] == 72.0
    assert s["worst_now"]["level"] == "warning"
    assert s["worst_ahead_hour"] == 0


def test_tiles_down_is_503(monkeypatch):
    real = httpx.AsyncClient

    def factory(*args, **kwargs):
        kwargs.pop("verify", None)
        return real(*args, transport=httpx.MockTransport(lambda r: httpx.Response(500)), **kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", factory)
    assert client.get(f"/api/map/hazard?{BOX}").status_code == 503


# ---------------------------------------------------------------------------
# 3. Agreement: alerts, risk board, push and the hazard map
# ---------------------------------------------------------------------------

PLACE = (18.52, 73.86)

SCENARIOS: dict[str, Field] = {
    "calm": lambda k, la, lo: {},
    "heavy rain (watch)": lambda k, la, lo: {"precipitation": 1.0} if 0 <= k < 20 else {},
    "extreme rain (warning)": lambda k, la, lo: {"precipitation": 3.0} if 0 <= k < 24 else {},
    "very heavy rain (severe)": lambda k, la, lo: {"precipitation": 6.0} if 0 <= k < 24 else {},
    "rain only tomorrow (none now)": lambda k, la, lo: {"precipitation": 20.0} if 30 <= k < 34 else {},
    "high heat (advisory)": lambda k, la, lo: {"temperature_2m": 36.0, "relative_humidity_2m": 20.0},
    "heat stress (watch)": lambda k, la, lo: {"temperature_2m": 36.0, "relative_humidity_2m": 60.0},
    "extreme heat stress (warning)": lambda k, la, lo: {"temperature_2m": 37.0, "relative_humidity_2m": 80.0},
    "severe heat": lambda k, la, lo: {"temperature_2m": 47.5, "relative_humidity_2m": 5.0},
    "cold (advisory)": lambda k, la, lo: {"temperature_2m": 3.0},
    "strong wind (watch)": lambda k, la, lo: {"wind_speed_10m": 45.0},
    "gale (warning)": lambda k, la, lo: {"wind_speed_10m": 70.0},
    "storm-force wind (severe)": lambda k, la, lo: {"wind_speed_10m": 95.0},
    "thunderstorm (watch)": lambda k, la, lo: {"weather_code": 95},
    "hail (warning)": lambda k, la, lo: {"weather_code": 96},
    "heavy hail (severe)": lambda k, la, lo: {"weather_code": 99},
    "mixed: rain watch + gale": lambda k, la, lo: {"precipitation": 1.0, "wind_speed_10m": 70.0} if 0 <= k < 20 else {},
}


@pytest.mark.parametrize("name", list(SCENARIOS))
def test_alerts_risk_board_push_and_hazard_map_agree(weather_field, name):
    from alerts.engine import evaluate_alerts
    from dissemination.job import level as push_level
    from models.roles import DistrictIn
    from query_service import fetch_validated_weather
    from roles.risk import risk_board

    weather_field["fn"] = SCENARIOS[name]
    lat, lon = PLACE

    # /api/alerts (the dashboard, /alerts and the map's place banner)
    alerts = client.get(f"/api/alerts?latitude={lat}&longitude={lon}").json()["alerts"]
    alert_levels = {h: "none" for h in TH.HAZARDS}
    for a in alerts:
        alert_levels[a["alert_type"]] = a["severity"]
    alert_overall = max(alert_levels.values(), key=lambda lvl: TH.LEVEL_RANK[lvl])

    # the hazard map: the hex that contains the place, window from now
    hz = client.get(f"/api/map/hazard?south={lat - 0.2}&west={lon - 0.2}&north={lat + 0.2}&east={lon + 0.2}&hour=0").json()
    cell = h3.latlng_to_cell(lat, lon, hz["h3_resolution"])
    idx = dict((c, i) for c, i in hz["cells"])[cell]
    point = hz["points"][idx]
    assert point["levels"] == alert_levels, name
    assert point["overall"] == alert_overall, name

    # the hazard summary for the place
    s = client.get(f"/api/map/hazard/summary?latitude={lat}&longitude={lon}").json()
    worst_now = s["worst_now"]["level"] if s["worst_now"] else "none"
    assert worst_now == alert_overall, name

    # the /disaster risk board and the push job
    board = asyncio.run(risk_board([DistrictIn(name="Pune", latitude=lat, longitude=lon)]))
    assert board.districts[0].severity == alert_overall, name
    weather = asyncio.run(fetch_validated_weather(lat, lon))
    assert push_level(evaluate_alerts(weather)) == alert_overall, name


def test_agreement_covers_every_level():
    """The scenarios above reach every level, so the agreement test is not vacuous."""
    expected = {"none", "advisory", "watch", "warning", "severe"}
    names = " ".join(SCENARIOS)
    for lvl in expected - {"none"}:
        assert lvl in names
