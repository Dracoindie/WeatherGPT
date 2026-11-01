"""
Role modes: farmer guidance rules, aviation briefing, district risk board,
GFS vs Open-Meteo comparison, and the role note appended to chat replies.
"""

from __future__ import annotations

import os
import sys
from contextlib import ExitStack
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from llm.response_generator import allowed_numbers, numbers_grounded
from main import app
from models.chat import AdvisoryResult, WeatherFacts
from models.roles import DistrictIn, DistrictRisk
from models.weather import CurrentWeather, HourlyWeather, WeatherResponse
from nwp.models import NwpForecast, NwpMetadata, NwpResponse
from roles import farm
from roles.aviation import aviation_briefing, visibility_band
from roles.compare import compare_models
from roles.notes import role_note
from roles.risk import risk_board, sort_board
from test_chat import chat_patches, sample_weather

client = TestClient(app)
IST = ZoneInfo("Asia/Kolkata")
# 05:00 IST: the whole of today's daylight is ahead.
NOW = datetime(2026, 11, 2, 5, 0, tzinfo=IST)


def make_weather(hours: int = 96, **overrides) -> WeatherResponse:
    """Hourly series from NOW; overrides map field -> callable(hour_index, local_dt) -> value."""
    times, cols = [], {k: [] for k in ("temp", "prob", "rain", "wind", "code", "rh", "dir", "vis", "cloud", "gust")}
    defaults = {
        "temp": lambda i, t: 25.0,
        "prob": lambda i, t: 10,
        "rain": lambda i, t: 0.0,
        "wind": lambda i, t: 8.0,
        "code": lambda i, t: 1,
        "rh": lambda i, t: 60.0,
        "dir": lambda i, t: 270.0,
        "vis": lambda i, t: 20000.0,
        "cloud": lambda i, t: 20.0,
        "gust": lambda i, t: 15.0,
    }
    defaults.update(overrides)
    for i in range(hours):
        t = NOW + timedelta(hours=i)
        times.append(t.strftime("%Y-%m-%dT%H:%M"))
        for k in cols:
            cols[k].append(defaults[k](i, t))
    cur = {k: v[0] for k, v in cols.items()}
    return WeatherResponse(
        latitude=19.0,
        longitude=73.0,
        timezone="Asia/Kolkata",
        retrieved_at=datetime.now(timezone.utc),
        current=CurrentWeather(
            temperature_2m=cur["temp"], relative_humidity_2m=cur["rh"], precipitation=cur["rain"],
            wind_speed_10m=cur["wind"], wind_direction_10m=cur["dir"], weather_code=cur["code"],
            time=times[0], visibility=cur["vis"], cloud_cover=cur["cloud"], wind_gusts_10m=cur["gust"],
        ),
        hourly=HourlyWeather(
            time=times, temperature_2m=cols["temp"], precipitation_probability=cols["prob"],
            precipitation=cols["rain"], wind_speed_10m=cols["wind"], weather_code=cols["code"],
            relative_humidity_2m=cols["rh"], wind_direction_10m=cols["dir"], visibility=cols["vis"],
            cloud_cover=cols["cloud"], wind_gusts_10m=cols["gust"],
        ),
    )


def advice(**overrides):
    return farm.farm_advice(make_weather(**overrides), now=NOW)


# ---------------------------------------------------------------------------
# Farmer: spraying
# ---------------------------------------------------------------------------


def test_calm_dry_day_has_a_daylight_spray_window():
    windows = advice().spray_windows
    assert windows, "expected a window"
    first = windows[0]
    assert first.start == "2026-11-02T06:00" and first.end == "2026-11-02T18:00"
    assert first.hours == 13


@pytest.mark.parametrize(
    "field, value",
    [
        ("wind", farm.SPRAY_MAX_WIND_KMH + 0.1),
        ("wind", farm.SPRAY_MIN_WIND_KMH - 0.1),
        ("temp", farm.SPRAY_MAX_TEMP_C + 0.1),
        ("rh", farm.SPRAY_MIN_RH - 0.1),
        ("prob", farm.SPRAY_MAX_RAIN_PROBABILITY),
    ],
)
def test_each_spray_threshold_blocks_spraying(field, value):
    assert advice(**{field: lambda i, t: value}).spray_windows == []


def test_spray_thresholds_are_inclusive_at_the_edges():
    windows = advice(wind=lambda i, t: farm.SPRAY_MAX_WIND_KMH, temp=lambda i, t: farm.SPRAY_MAX_TEMP_C).spray_windows
    assert windows


def test_rain_needs_rain_free_hours_after_spraying():
    # Rain at 14:00 today: hours whose next 4 h include 14:00 (10:00-14:00) are out.
    rain_at = NOW.replace(hour=14)
    windows = advice(rain=lambda i, t: 2.0 if t == rain_at else 0.0).spray_windows
    today = [w for w in windows if w.start.startswith("2026-11-02")]
    assert [(w.start[-5:], w.end[-5:]) for w in today] == [("06:00", "09:00"), ("15:00", "18:00")]


# ---------------------------------------------------------------------------
# Farmer: irrigation, harvest, sowing
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "overrides, status",
    [
        ({"rain": lambda i, t: 0.5 if i < 24 else 0.0}, "skip"),  # 12 mm in 48 h
        ({"rain": lambda i, t: 0.25 if i < 24 else 0.0}, "delay"),  # 6 mm
        ({"prob": lambda i, t: 70 if i == 3 else 10}, "delay"),
        ({"temp": lambda i, t: 36.0 if i == 10 else 25.0}, "needed"),
        ({}, "as_usual"),
    ],
)
def test_irrigation_status(overrides, status):
    assert advice(**overrides).irrigation.status == status


def test_harvest_day_flags_rain_and_wind():
    tomorrow = (NOW + timedelta(days=1)).date()
    day_after = (NOW + timedelta(days=2)).date()
    a = advice(
        rain=lambda i, t: 2.0 if t.date() == tomorrow and t.hour == 12 else 0.0,
        wind=lambda i, t: farm.HARVEST_MAX_WIND_KMH if t.date() == day_after and t.hour == 15 else 8.0,
    )
    by_date = {d.date: d for d in a.harvest_days}
    assert by_date[NOW.date().isoformat()].harvest == "good"
    assert by_date[tomorrow.isoformat()].harvest == "avoid"
    assert by_date[tomorrow.isoformat()].reasons == ["2 mm rain"]
    assert by_date[day_after.isoformat()].harvest == "avoid"
    assert "wind up to 30 km/h" in by_date[day_after.isoformat()].reasons


@pytest.mark.parametrize(
    "overrides, status",
    [
        ({"rain": lambda i, t: 0.5 if i % 3 == 0 else 0.0}, "favourable"),  # 12 mm over 72 h
        ({}, "dry"),
        ({"rain": lambda i, t: 30.0 if i in (10, 11) else 0.0}, "wait"),  # 60 mm in one day
        ({"rain": lambda i, t: 0.5 if i % 3 == 0 else 0.0, "temp": lambda i, t: 39.0 if i == 8 else 25.0}, "wait"),
    ],
)
def test_sowing_status(overrides, status):
    assert advice(**overrides).sowing.status == status


def test_farm_response_is_labelled_guidance_and_lists_thresholds():
    a = advice()
    assert "not an official" in a.note
    assert a.thresholds["spray_max_wind_kmh"] == farm.SPRAY_MAX_WIND_KMH


# ---------------------------------------------------------------------------
# Aviation
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("km, band", [(10, "good"), (8, "good"), (7.9, "moderate"), (5, "moderate"), (1.5, "poor"), (1.4, "very_poor"), (None, None)])
def test_visibility_bands(km, band):
    assert visibility_band(km) == band


def test_aviation_briefing_flags():
    w = make_weather(
        code=lambda i, t: 95 if i == 3 else 1,
        vis=lambda i, t: 3000.0 if i == 2 else 20000.0,
        gust=lambda i, t: 50.0 if i == 4 else 15.0,
    )
    b = aviation_briefing(w, now=NOW)
    assert b.visibility_km == 20.0 and b.visibility_band == "good"
    assert b.wind_kt == 4  # 8 km/h
    assert b.next_min_visibility_km == 3.0
    assert b.next_max_weather_code == 95
    text = " ".join(b.flags)
    assert "Thunderstorm" in text and "Visibility down to 3 km" in text
    assert "Gusty" in text and "Strong wind" in text
    assert "not an official" in b.note


def test_quiet_aviation_briefing_has_no_flags():
    assert aviation_briefing(make_weather(), now=NOW).flags == []


# ---------------------------------------------------------------------------
# Disaster manager board
# ---------------------------------------------------------------------------


def test_board_sorts_most_severe_first():
    rows = [
        DistrictRisk(name="A", latitude=0, longitude=0, severity="none", rain_24h_mm=0),
        DistrictRisk(name="B", latitude=0, longitude=0, severity="warning", rain_24h_mm=80),
        DistrictRisk(name="C", latitude=0, longitude=0, severity="watch", rain_24h_mm=40),
        DistrictRisk(name="D", latitude=0, longitude=0, severity="unknown"),
        DistrictRisk(name="E", latitude=0, longitude=0, severity="watch", rain_24h_mm=55),
    ]
    assert [r.name for r in sort_board(rows)] == ["B", "E", "C", "A", "D"]


@pytest.mark.asyncio
async def test_board_evaluates_each_district_and_marks_failures():
    stormy = make_weather(rain=lambda i, t: 5.0 if i < 12 else 0.0)

    async def fetch(lat, lon):
        if lat == 1:
            raise RuntimeError("timeout")
        return stormy if lat == 2 else make_weather()

    with patch("roles.risk.fetch_validated_weather", side_effect=fetch):
        board = await risk_board([
            DistrictIn(name="Calm", latitude=3, longitude=0),
            DistrictIn(name="Down", latitude=1, longitude=0),
            DistrictIn(name="Wet", latitude=2, longitude=0),
        ])
    names = [d.name for d in board.districts]
    assert names[0] == "Wet" and names[-1] == "Down"
    wet = board.districts[0]
    assert wet.severity in {"warning", "watch"} and wet.rain_24h_mm == 60.0
    assert board.districts[-1].severity == "unknown"


def test_risk_endpoint_validates_size():
    assert client.post("/api/risk", json={"districts": []}).status_code == 422


# ---------------------------------------------------------------------------
# Researcher comparison
# ---------------------------------------------------------------------------


def test_compare_aligns_valid_hours_in_utc():
    w = make_weather(temp=lambda i, t: 20.0 + i)
    run = NOW.astimezone(timezone.utc).replace(minute=0)  # IST 05:00 = 23:30 UTC -> run 23:00 UTC
    gfs = NwpResponse(
        metadata=NwpMetadata(model="GFS", generationTime=run.isoformat(), latitude=19, longitude=73),
        forecasts=[NwpForecast(hour=h, temperatureC=21.0 + h, precipitationMm=0.0, windMs=2.5) for h in range(6)],
    )
    cmp = compare_models(w, gfs)
    assert cmp.stats.pairs == 5  # hours 1..5 (hour 0 skipped)
    assert cmp.stats.wind_bias_kmh == round(2.5 * 3.6 - 8.0, 2)
    # Open-Meteo hour index i is NOW+i; GFS hour h is valid at run+h (30 min before NOW+h).
    assert all(r.valid_time_utc.endswith(":00Z") for r in cmp.rows)


def test_compare_endpoint_503_when_gfs_fails():
    with ExitStack() as stack:
        stack.enter_context(patch("api.roles.fetch_validated_weather", AsyncMock(return_value=make_weather())))
        stack.enter_context(patch("nwp.service.get_nwp_forecast", AsyncMock(side_effect=RuntimeError("down"))))
        resp = client.get("/api/compare?latitude=19&longitude=73")
    assert resp.status_code == 503
    assert resp.json()["available"] is False


def test_farm_and_aviation_endpoints():
    with patch("api.roles.fetch_validated_weather", AsyncMock(return_value=make_weather())):
        farm_resp = client.get("/api/farm?latitude=19&longitude=73")
        av = client.get("/api/aviation?latitude=19&longitude=73")
    assert farm_resp.status_code == 200 and "spray_windows" in farm_resp.json()
    assert av.status_code == 200 and av.json()["visibility_band"] == "good"


def test_role_endpoints_503_when_weather_down():
    with patch("api.roles.fetch_validated_weather", AsyncMock(side_effect=RuntimeError("down"))):
        assert client.get("/api/farm?latitude=19&longitude=73").status_code == 503


# ---------------------------------------------------------------------------
# Role notes in chat replies
# ---------------------------------------------------------------------------

FACTS = WeatherFacts(
    location="Pune", requested_time="tomorrow (2026-11-03T00:00 to 2026-11-03T23:00)", timezone="Asia/Kolkata",
    temperature_2m=27.0, temperature_min=21.0, temperature_max=29.5, precipitation=0.4, precipitation_probability=20,
    wind_speed_10m=12.0, relative_humidity_2m=60.0, wind_gusts_10m=24.5, visibility=9.8, cloud_cover=40,
)
ADVISORY = AdvisoryResult(severity="moderate", condition="Rain likely", advisory="Carry an umbrella.", reasons=[])


@pytest.mark.parametrize(
    "update, expected",
    [
        ({"precipitation": 6.2}, "hold irrigation"),
        ({"precipitation_probability": 70}, "hold irrigation"),
        ({"wind_speed_10m": 18.0}, "not suitable for spraying"),
        ({"temperature_max": 33.0}, "early morning or evening"),
        ({}, "conditions suit spraying"),
    ],
)
def test_farmer_note(update, expected):
    facts = FACTS.model_copy(update=update)
    note = role_note("farmer", facts, ADVISORY, "en")
    assert expected in note
    assert numbers_grounded(note, allowed_numbers(facts)), note


@pytest.mark.parametrize("lang", ["en", "hi", "hinglish"])
@pytest.mark.parametrize("role", ["farmer", "aviation", "disaster_manager", "researcher"])
def test_role_notes_are_grounded_in_every_language(role, lang):
    note = role_note(role, FACTS, ADVISORY, lang)
    assert note
    assert numbers_grounded(note, allowed_numbers(FACTS)), note


def test_aviation_and_disaster_notes():
    assert role_note("aviation", FACTS, ADVISORY, "en") == (
        "Aviation: wind 12 km/h, gusts 24.5 km/h, visibility 9.8 km, cloud cover 40% (not a METAR/TAF)."
    )
    assert role_note("disaster_manager", FACTS, ADVISORY, "en") == "Risk level: moderate (Rain likely)."
    assert role_note("citizen", FACTS, ADVISORY, "en") is None


def test_chat_role_changes_the_reply_focus():
    def ask(role):
        with ExitStack() as stack:
            for p in chat_patches(weather=sample_weather()):
                stack.enter_context(p)
            return client.post("/api/chat", json={"message": "Pune weather tomorrow", "role": role}).json()

    citizen, farmer = ask("citizen"), ask("farmer")
    assert "Farm guidance" not in citizen["message"]
    assert "Farm guidance" in farmer["message"]
    # the numbers and facts themselves do not change with the role
    assert citizen["weather"] == farmer["weather"]
    assert client.post("/api/chat", json={"message": "x", "role": "pilot"}).status_code == 422
