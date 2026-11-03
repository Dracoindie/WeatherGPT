"""
thresholds.py is the single source of hazard thresholds and levels.

The alert engine, chat advisories, the /api/alerts/thresholds table and the
Playwright fixture must all agree with it.
"""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

import thresholds as T
from advisory import evaluate_advisory
from alerts.engine import evaluate_alerts
from main import app
from models.chat import WeatherFacts
from test_roles import make_weather

client = TestClient(app)
FIXTURE = Path(__file__).resolve().parents[1] / "weathergpt-web" / "e2e" / "support" / "thresholds.json"
BY_ID = {r.id: r for r in T.RULES}


def _alert_for(alerts, hazard):
    return [a for a in alerts if a.alert_type == hazard]


@pytest.mark.parametrize(
    "rule, weather",
    [
        (T.HEAVY_RAIN, make_weather(rain=lambda i, t: 20.0 / 24)),  # 20 mm in 24 h
        (T.EXTREME_RAIN, make_weather(rain=lambda i, t: 3.0)),
        # dry air, so heat stress (heat index 34 °C) stays below Danger
        (T.HIGH_HEAT, make_weather(temp=lambda i, t: 36.0, rh=lambda i, t: 20.0)),
        (T.EXTREME_HEAT, make_weather(temp=lambda i, t: 41.0)),
        (T.COLD, make_weather(temp=lambda i, t: 4.0)),
        (T.STRONG_WIND, make_weather(wind=lambda i, t: 45.0)),
        (T.GALE, make_weather(wind=lambda i, t: 70.0)),
        (T.THUNDERSTORM, make_weather(code=lambda i, t: 95)),
        (T.THUNDERSTORM_HAIL, make_weather(code=lambda i, t: 96)),
        (T.THUNDERSTORM_HEAVY_HAIL, make_weather(code=lambda i, t: 99)),
        (T.VERY_HEAVY_RAIN, make_weather(rain=lambda i, t: 5.0)),  # 120 mm in 24 h
        (T.SEVERE_HEAT, make_weather(temp=lambda i, t: 47.5, rh=lambda i, t: 5.0)),
        (T.STORM_FORCE_WIND, make_weather(wind=lambda i, t: 90.0)),
        # 36 °C at 60 % RH: heat index ≈ 45 °C (Danger) -> heat stress watch outranks the 35 °C advisory
        (T.HEAT_STRESS, make_weather(temp=lambda i, t: 36.0, rh=lambda i, t: 60.0)),
        # 37 °C at 80 % RH: heat index ≈ 66 °C (Extreme danger) -> warning without extreme heat (< 40 °C)
        (T.EXTREME_HEAT_STRESS, make_weather(temp=lambda i, t: 37.0, rh=lambda i, t: 80.0)),
    ],
)
def test_engine_levels_and_thresholds_come_from_the_table(rule, weather):
    """The real engine (not mocked): level and threshold_value match the rule."""
    hits = _alert_for(evaluate_alerts(weather), rule.hazard)
    assert len(hits) == 1
    assert hits[0].severity == rule.level
    assert hits[0].threshold_value == rule.value
    assert hits[0].unit == rule.unit


def test_twenty_mm_is_a_watch_at_fifteen_not_thirty_five():
    """The /alerts card and the threshold table must show the same number (15 mm)."""
    alert = _alert_for(evaluate_alerts(make_weather(rain=lambda i, t: 20.0 / 24)), "rain")[0]
    assert (alert.severity, alert.threshold_value) == ("watch", 15.0)


def _facts(**kw) -> WeatherFacts:
    base = dict(
        location="Pune", timezone="Asia/Kolkata",
        requested_time="2026-11-02", source="open-meteo",
        temperature_2m=25.0, precipitation=0.0, wind_speed_10m=10.0,
    )
    base.update(kw)
    return WeatherFacts(**base)


@pytest.mark.parametrize(
    "rule, facts, condition",
    [
        (T.HEAVY_RAIN, _facts(precipitation=20.0), "Heavy Rain"),
        (T.EXTREME_RAIN, _facts(precipitation=60.0), "Extreme Rain / Flood Risk"),
        (T.HIGH_HEAT, _facts(temperature_max=36.0), "High Heat"),
        (T.EXTREME_HEAT, _facts(temperature_max=41.0), "Extreme Heat"),
        (T.COLD, _facts(temperature_min=4.0), "Cold / Chilly"),
        (T.STRONG_WIND, _facts(wind_speed_10m=45.0), "Strong Winds"),
        (T.GALE, _facts(wind_speed_10m=70.0), "Storm / Gale Winds"),
    ],
)
def test_chat_advisory_uses_the_same_rule(rule, facts, condition):
    result = evaluate_advisory(facts, "general")
    assert result.condition == condition
    assert result.severity == T.ADVISORY_SEVERITY[rule.level]


@pytest.mark.parametrize("rule", [T.HEAVY_RAIN, T.HIGH_HEAT, T.STRONG_WIND])
def test_just_below_threshold_fires_nothing_anywhere(rule):
    below = rule.value - 0.1
    field = {"precipitation": "rain", "temperature": "temp", "wind_speed": "wind"}[rule.parameter]
    per_hour = below / 24 if field == "rain" else below
    # dry air, so the heat-stress rules stay out of the heat case
    weather = make_weather(rh=lambda i, t: 20.0, **{field: (lambda i, t, v=per_hour: v)})
    assert _alert_for(evaluate_alerts(weather), rule.hazard) == []


def test_thresholds_endpoint_serves_the_table():
    body = client.get("/api/alerts/thresholds").json()
    assert body["rules"] == T.as_table()
    assert "not official IMD warnings" in body["note"]
    assert {r["id"] for r in body["rules"]} == set(BY_ID)


def test_playwright_fixture_matches_the_table():
    """e2e mocks read this file; regenerate it if thresholds.py changes."""
    assert json.loads(FIXTURE.read_text(encoding="utf-8")) == T.as_table(), (
        f"{FIXTURE} is stale; run: backend/.venv/Scripts/python -c "
        "\"import json,sys; sys.path.insert(0,'backend'); import thresholds as t; "
        "open('weathergpt-web/e2e/support/thresholds.json','w',encoding='utf-8').write(json.dumps(t.as_table(), ensure_ascii=False, indent=2)+'\\n')\""
    )


def test_cap_parameter_carries_the_table_threshold():
    wet = make_weather(rain=lambda i, t: 20.0 / 24)
    with patch("api.dissemination.fetch_validated_weather", AsyncMock(return_value=wet)):
        xml = client.get("/api/alerts/cap?latitude=19&longitude=73").text
    assert "<value>15 mm</value>" in xml


def test_risk_board_and_push_use_the_engine():
    """Both import evaluate_alerts, so they inherit the table (no separate thresholds)."""
    import dissemination.job as job
    import roles.risk as risk

    assert risk.evaluate_alerts is evaluate_alerts
    assert job.evaluate_alerts is evaluate_alerts
