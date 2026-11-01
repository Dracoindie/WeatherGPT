"""
Unified chat: climate (archive) and GFS (NWP) intents, follow-up context, and
the grounding rule for both new sources. External services are mocked.
"""

from __future__ import annotations

import os
import sys
from contextlib import ExitStack
from datetime import date, datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from climate.analysis import BASELINE_YEARS, compare_periods, period_window
from llm.follow_up import apply_context, is_follow_up
from llm.query_parser import parse_query_fallback
from llm.response_generator import numbers_grounded
from llm.source_replies import allowed_numbers_in, climate_template, grounded_reply, nwp_template
from main import app
from models.chat import ChatContext, ChatIntent, NwpFacts
from models.climate import ClimateResponse, HistoricalDaily
from nwp.facts import hourly_precipitation, hours_to_request, summarise_nwp
from nwp.models import NwpForecast, NwpMetadata, NwpResponse
from test_chat import PUNE, chat_patches, sample_weather

client = TestClient(app)
TODAY = date(2026, 11, 1)


# ---------------------------------------------------------------------------
# Parser
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "message, period, param, lang",
    [
        ("Is this year hotter than usual in Delhi?", "this_year", "high_temperature", "en"),
        ("Has Pune been wetter than normal this month?", "this_month", "precipitation", "en"),
        ("Mumbai mein is saal normal se zyada garmi hai kya?", "this_year", "high_temperature", "hinglish"),
        ("दिल्ली में इस साल सामान्य से ज्यादा गर्मी है?", "this_year", "high_temperature", "hi"),
        ("How does the last month compare to the historical average in Nagpur?", "last_30_days", "general", "en"),
    ],
)
def test_parser_detects_climate_questions(message, period, param, lang):
    intent = parse_query_fallback(message)
    assert intent.intent == "climate"
    assert intent.climate_period == period
    assert intent.weather_parameter == param
    assert intent.language == lang


@pytest.mark.parametrize(
    "message, date_ref",
    [
        ("What does GFS say for tomorrow in Pune?", "tomorrow"),
        ("Show the NWP model forecast for Mumbai tonight", "tonight"),
        ("WRF output for Nagpur today?", "today"),
        ("Pune ke liye GFS model kya keh raha hai kal?", "tomorrow"),
    ],
)
def test_parser_detects_nwp_questions(message, date_ref):
    intent = parse_query_fallback(message)
    assert intent.intent == "nwp"
    assert intent.date_reference == date_ref
    assert intent.climate_period is None


@pytest.mark.parametrize(
    "message",
    ["Will it rain in Pune tomorrow?", "What is the temperature in Delhi right now?", "Mumbai mein abhi mausam?"],
)
def test_ordinary_questions_stay_weather_intents(message):
    assert parse_query_fallback(message).intent in {"forecast", "current_weather"}


# ---------------------------------------------------------------------------
# Climate analysis (pure)
# ---------------------------------------------------------------------------


def _archive(start: date, end: date, recent_from: date, warm_by: float, rain_recent: float, rain_past: float):
    rows, d = [], start
    while d <= end:
        recent = d >= recent_from
        rows.append(
            HistoricalDaily(
                date=d,
                temperature_max=30.0 + (warm_by if recent else 0.0),
                temperature_min=20.0 + (warm_by if recent else 0.0),
                precipitation_sum=rain_recent if recent else rain_past,
            )
        )
        d += timedelta(days=1)
    return rows


def test_compare_periods_reports_anomalies_from_archive_values():
    period, start, end = period_window("last_30_days", TODAY)
    first = start.replace(year=start.year - BASELINE_YEARS)
    daily = _archive(first, end, start, warm_by=1.6, rain_recent=2.0, rain_past=1.0)
    facts = compare_periods(daily, period, start, end, "Delhi", "Asia/Kolkata")
    assert facts.available
    assert facts.baseline_years == BASELINE_YEARS
    assert facts.mean_temperature_max == 31.6
    assert facts.baseline_mean_temperature_max == 30.0
    assert facts.temperature_max_anomaly == 1.6
    assert facts.total_precipitation == 60.0
    assert facts.baseline_total_precipitation == 30.0
    assert facts.precipitation_anomaly_percent == 100


def test_compare_periods_without_baseline_is_unavailable():
    period, start, end = period_window("last_30_days", TODAY)
    daily = _archive(start, end, start, 1.0, 1.0, 1.0)  # no earlier years
    facts = compare_periods(daily, period, start, end, "Delhi", "Asia/Kolkata")
    assert not facts.available
    assert facts.mean_temperature_max is None


def test_short_this_year_window_falls_back_to_last_30_days():
    period, start, end = period_window("this_year", date(2026, 1, 10))
    assert period == "last_30_days"
    assert (end - start).days == 29


@pytest.mark.parametrize("lang", ["en", "hi", "hinglish"])
@pytest.mark.parametrize("param", ["high_temperature", "precipitation", "general"])
def test_climate_template_is_grounded(lang, param):
    period, start, end = period_window("this_year", TODAY)
    first = start.replace(year=start.year - BASELINE_YEARS)
    facts = compare_periods(_archive(first, end, start, -0.8, 0.5, 1.5), period, start, end, "Delhi", "Asia/Kolkata")
    intent = ChatIntent(intent="climate", language=lang, weather_parameter=param, climate_period="this_year")
    text = climate_template(intent, facts)
    assert "Delhi" in text
    assert numbers_grounded(text, allowed_numbers_in(facts)), text


# ---------------------------------------------------------------------------
# GFS summary (pure)
# ---------------------------------------------------------------------------


def test_gfs_apcp_buckets_become_hourly_amounts():
    # f001..f006 accumulate 0-1..0-6 h; f007 starts a new bucket.
    apcp = [0.0, 1.0, 1.5, 1.5, 3.0, 3.0, 4.0, 0.5]
    assert hourly_precipitation(apcp) == [0.0, 1.0, 0.5, 0.0, 1.5, 0.0, 1.0, 0.5]


def _gfs(run: datetime, hours: int) -> NwpResponse:
    return NwpResponse(
        metadata=NwpMetadata(model="GFS", generationTime=run.isoformat(), latitude=18.52, longitude=73.86),
        forecasts=[
            NwpForecast(hour=h, temperatureC=22.0 + (h % 24) * 0.25, precipitationMm=0.6 if h % 6 else 0.0, windMs=3.0 + h * 0.05)
            for h in range(hours)
        ],
    )


def test_summarise_nwp_tomorrow_uses_local_hours():
    now = datetime(2026, 11, 1, 6, 30, tzinfo=timezone.utc)  # 12:00 IST
    run = datetime(2026, 11, 1, 0, 0, tzinfo=timezone.utc)
    intent = ChatIntent(intent="nwp", date_reference="tomorrow")
    facts = summarise_nwp(_gfs(run, 48), intent, "Pune", "Asia/Kolkata", now)
    assert facts.period_available
    # tomorrow IST 00:00-23:00 is 18:30 UTC Nov 1 .. 17:30 UTC Nov 2 -> run hours 19..42
    assert facts.hours == 24
    assert facts.requested_time.startswith("tomorrow (2026-11-02T00:30")
    assert facts.wind_speed_max == round((3.0 + 42 * 0.05) * 3.6, 1)
    for lang in ("en", "hi", "hinglish"):
        text = nwp_template(intent.model_copy(update={"language": lang}), facts)
        assert numbers_grounded(text, allowed_numbers_in(facts)), text
        assert "GFS" in text


def test_nwp_window_beyond_48_hours_is_not_requested():
    now = datetime(2026, 11, 1, 6, 30, tzinfo=timezone.utc)
    assert hours_to_request(ChatIntent(intent="nwp", date_reference="day_after_tomorrow"), "Asia/Kolkata", now) is None
    assert 24 < hours_to_request(ChatIntent(intent="nwp", date_reference="tomorrow"), "Asia/Kolkata", now) <= 48


# ---------------------------------------------------------------------------
# /api/chat routing
# ---------------------------------------------------------------------------


def _climate_archive(start: str, end: str) -> ClimateResponse:
    s, e = date.fromisoformat(start), date.fromisoformat(end)
    period, rs, _ = period_window("this_year", datetime.now(timezone.utc).date())
    return ClimateResponse(
        latitude=28.61, longitude=77.21, timezone="Asia/Kolkata", generation_time=0.1,
        daily=_archive(s, e, rs, warm_by=1.2, rain_recent=1.0, rain_past=1.0),
    )


def test_chat_routes_climate_question_to_the_archive():
    archive = AsyncMock(side_effect=lambda lat, lon, start, end: _climate_archive(start, end))
    with ExitStack() as stack:
        for p in chat_patches():
            stack.enter_context(p)
        stack.enter_context(patch("climate.analysis.fetch_historical_weather", archive))
        resp = client.post("/api/chat", json={"message": "Is this year hotter than usual in Pune?"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["intent"]["intent"] == "climate"
    assert body["source"] == "open-meteo-archive"
    assert body["weather"] is None and body["climate"]["available"] is True
    assert body["climate"]["temperature_max_anomaly"] == 1.2
    assert "1.2" in body["message"] and "warmer than usual" in body["message"]
    archive.assert_awaited_once()


def test_chat_routes_gfs_question_to_nwp():
    run = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0) - timedelta(hours=6)
    gfs = AsyncMock(return_value=_gfs(run, 48))
    with ExitStack() as stack:
        for p in chat_patches():
            stack.enter_context(p)
        stack.enter_context(patch("nwp.service.get_nwp_forecast", gfs))
        resp = client.post("/api/chat", json={"message": "What does GFS say for tomorrow in Pune?"})
    body = resp.json()
    assert resp.status_code == 200
    assert body["intent"]["intent"] == "nwp"
    assert body["source"] == "gfs-nomads"
    assert body["nwp"]["period_available"] is True
    assert "GFS model" in body["message"] and "not an official forecast" in body["message"]
    assert numbers_grounded(body["message"], allowed_numbers_in(NwpFacts(**body["nwp"])))
    gfs.assert_awaited_once()


def test_chat_gfs_failure_says_unavailable():
    with ExitStack() as stack:
        for p in chat_patches():
            stack.enter_context(p)
        stack.enter_context(patch("nwp.service.get_nwp_forecast", AsyncMock(side_effect=RuntimeError("down"))))
        resp = client.post("/api/chat", json={"message": "GFS forecast for Pune tomorrow"})
    assert resp.status_code == 200
    assert resp.json()["message"] == "GFS model data is not available on this server right now."
    assert resp.json()["nwp"] is None


# ---------------------------------------------------------------------------
# Follow-ups
# ---------------------------------------------------------------------------

PUNE_CTX = ChatContext(
    intent="forecast",
    location_name="Pune, Maharashtra, India",
    latitude=18.5204,
    longitude=73.8567,
    date_reference="tomorrow",
    weather_parameter="precipitation",
)


def test_follow_up_detection():
    assert is_follow_up("aur parso?")
    assert is_follow_up("What about Mumbai?")
    assert is_follow_up("और कल?")
    assert not is_follow_up("Will it rain in Pune tomorrow evening after the match ends?")


def test_aur_parso_keeps_parameter_and_changes_date():
    intent = apply_context(parse_query_fallback("aur parso?"), "aur parso?", PUNE_CTX)
    assert intent.date_reference == "day_after_tomorrow"
    assert intent.weather_parameter == "precipitation"
    assert intent.intent == "forecast"
    assert intent.language == "hinglish"


def test_what_about_mumbai_keeps_date_and_parameter():
    intent = apply_context(parse_query_fallback("What about Mumbai?"), "What about Mumbai?", PUNE_CTX)
    assert intent.location_name == "Mumbai"
    assert intent.date_reference == "tomorrow"
    assert intent.weather_parameter == "precipitation"


def test_follow_up_to_climate_stays_climate():
    ctx = PUNE_CTX.model_copy(update={"intent": "climate", "climate_period": "this_year", "date_reference": "now"})
    intent = apply_context(parse_query_fallback("aur Mumbai mein?"), "aur Mumbai mein?", ctx)
    assert intent.intent == "climate"
    assert intent.climate_period == "this_year"
    assert intent.location_name == "Mumbai"


def test_explicit_slots_win_over_context():
    msg = "What about the wind right now?"
    intent = apply_context(parse_query_fallback(msg), msg, PUNE_CTX)
    assert intent.weather_parameter == "wind"
    assert intent.date_reference == "now"


def test_new_full_question_does_not_inherit():
    msg = "What is the temperature in Delhi today, and should I carry a jacket?"
    intent = apply_context(parse_query_fallback(msg), msg, PUNE_CTX)
    assert intent.date_reference == "today"
    assert intent.weather_parameter == "temperature"


def test_chat_follow_up_uses_context_location_without_geocoding():
    patches = chat_patches(weather=sample_weather())
    with ExitStack() as stack:
        mocks = [stack.enter_context(p) for p in patches]
        resp = client.post(
            "/api/chat",
            json={"message": "aur parso?", "context": PUNE_CTX.model_dump()},
        )
    geocode = mocks[0]
    body = resp.json()
    assert resp.status_code == 200
    assert geocode.call_count == 0
    assert body["location"]["source"] == "conversation_context"
    assert body["location"]["latitude"] == pytest.approx(18.5204)
    assert body["intent"]["date_reference"] == "day_after_tomorrow"
    assert body["intent"]["weather_parameter"] == "precipitation"
    assert body["weather"]["period_available"] is True


def test_named_place_beats_context_location():
    with ExitStack() as stack:
        mocks = [stack.enter_context(p) for p in chat_patches()]
        resp = client.post("/api/chat", json={"message": "What about Mumbai?", "context": PUNE_CTX.model_dump()})
    assert resp.json()["location"]["source"] == "explicit_query"
    assert mocks[0].call_count == 1


# ---------------------------------------------------------------------------
# LLM wording is grounded like the weather replies
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_llm_reply_with_invented_number_falls_back_to_template():
    period, start, end = period_window("last_30_days", TODAY)
    first = start.replace(year=start.year - BASELINE_YEARS)
    facts = compare_periods(_archive(first, end, start, 1.0, 1.0, 1.0), period, start, end, "Delhi", "Asia/Kolkata")
    intent = ChatIntent(intent="climate", climate_period="last_30_days")
    templated = climate_template(intent, facts)
    with patch("llm.provider.is_configured", return_value=True), patch(
        "llm.provider.complete_text", AsyncMock(return_value="Delhi was 4.7°C hotter than usual.")
    ):
        assert await grounded_reply(intent, facts, templated) == templated
    with patch("llm.provider.is_configured", return_value=True), patch(
        "llm.provider.complete_text", AsyncMock(return_value="Delhi ran 1°C warmer than usual.")
    ):
        assert await grounded_reply(intent, facts, templated) == "Delhi ran 1°C warmer than usual."
