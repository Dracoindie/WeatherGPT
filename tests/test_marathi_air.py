"""
Marathi end to end (detection, parsing, templates, advisories, other sources)
and air quality (Indian AQI, CPCB method) + UV index in facts and replies.
"""

from __future__ import annotations

import os
import sys
from contextlib import ExitStack
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from advisory import localized_advisory
from air.aqi import PM10_BREAKPOINTS, PM25_BREAKPOINTS, aqi_category, indian_aqi, sub_index, uv_category
from air.service import AirQualityData, AirQualityHourly, summarise, trailing_24h
from llm.follow_up import apply_context
from llm.query_parser import detect_language, parse_query_fallback
from llm.response_generator import allowed_numbers, numbers_grounded, template_response
from llm.source_replies import allowed_numbers_in, climate_template, nwp_template
from main import app
from models.chat import AdvisoryResult, ChatContext, ChatIntent, ClimateFacts, NwpFacts, WeatherFacts
from roles.notes import role_note
from test_chat import chat_patches, sample_weather

client = TestClient(app)


# ---------------------------------------------------------------------------
# Language detection and parsing
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "message, lang",
    [
        ("पुण्यात उद्या पाऊस पडेल का?", "mr"),
        ("मुंबईत आत्ता हवामान कसे आहे?", "mr"),
        ("नागपुरात परवा तापमान किती असेल?", "mr"),
        ("punyat udya paus padel ka?", "mr"),
        ("दिल्ली में कल बारिश होगी क्या?", "hi"),
        ("मुंबई में आज तापमान?", "hi"),
        ("Pune mein kal baarish hogi kya?", "hinglish"),
        ("Will it rain in Pune tomorrow?", "en"),
    ],
)
def test_language_detection(message, lang):
    assert detect_language(message) == lang


@pytest.mark.parametrize(
    "message, place, date_ref, param",
    [
        ("पुण्यात उद्या पाऊस पडेल का?", "Pune", "tomorrow", "precipitation"),
        ("नागपुरात परवा तापमान किती असेल?", "Nagpur", "day_after_tomorrow", "temperature"),
        ("कोल्हापुरात मंगळवारी वारा किती?", "Kolhapur", "tuesday", "wind"),
        ("मुंबईत आज रात्री वादळ येईल का?", "Mumbai", "tonight", "storm"),
        ("साताऱ्यात उद्या मुसळधार पाऊस?", "Satara", "tomorrow", "heavy_rain"),
        ("ठाण्यात आज उकाडा किती?", "Thane", "today", "high_temperature"),
        ("मुंबईत आत्ता हवामान कसे आहे?", "Mumbai", "now", "general"),
        ("हवेची गुणवत्ता पुण्यात कशी आहे?", "Pune", "now", "air_quality"),
        ("punyat udya paus padel ka?", "Pune", "tomorrow", "precipitation"),
    ],
)
def test_marathi_parsing(message, place, date_ref, param):
    intent = parse_query_fallback(message)
    assert (intent.location_name, intent.date_reference, intent.weather_parameter, intent.language) == (
        place, date_ref, param, "mr"
    )


@pytest.mark.parametrize(
    "message, param",
    [
        ("What is the AQI in Delhi today?", "air_quality"),
        ("Delhi mein pollution kitna hai?", "air_quality"),
        ("दिल्ली में अभी प्रदूषण कितना है?", "air_quality"),
        ("PM2.5 levels in Mumbai?", "air_quality"),
        ("UV index in Chennai tomorrow?", "uv"),
        ("Is there a sunburn risk in Jaipur today?", "uv"),
    ],
)
def test_air_quality_and_uv_parameters(message, param):
    assert parse_query_fallback(message).weather_parameter == param


def test_hindi_wind_word_still_means_wind():
    assert parse_query_fallback("दिल्ली में हवा कैसी है?").weather_parameter == "wind"


def test_marathi_follow_up():
    ctx = ChatContext(intent="forecast", location_name="Pune", latitude=18.52, longitude=73.86,
                      date_reference="tomorrow", weather_parameter="precipitation")
    msg = "आणि परवा?"
    intent = apply_context(parse_query_fallback(msg), msg, ctx)
    assert (intent.date_reference, intent.weather_parameter, intent.language) == ("day_after_tomorrow", "precipitation", "mr")


# ---------------------------------------------------------------------------
# Indian AQI and UV bands
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "conc, expected",
    [(0, 0), (30, 50), (45, 76), (60, 100), (90, 200), (120, 300), (250, 400), (300, 421), (900, 500)],
)
def test_pm25_sub_index(conc, expected):
    assert sub_index(conc, PM25_BREAKPOINTS) == expected


@pytest.mark.parametrize("conc, expected", [(50, 50), (100, 100), (250, 200), (350, 300), (430, 400)])
def test_pm10_sub_index(conc, expected):
    assert sub_index(conc, PM10_BREAKPOINTS) == expected


@pytest.mark.parametrize(
    "aqi, cat",
    [(0, "good"), (50, "good"), (51, "satisfactory"), (100, "satisfactory"), (101, "moderate"), (201, "poor"),
     (301, "very_poor"), (401, "severe"), (500, "severe")],
)
def test_aqi_categories(aqi, cat):
    assert aqi_category(aqi) == cat


def test_indian_aqi_takes_the_worse_pollutant():
    assert indian_aqi(20.0, 260.0) == (211, "poor", "pm10")  # 201 + 99*10/100
    assert indian_aqi(95.0, 40.0) == (218, "poor", "pm2_5")
    assert indian_aqi(None, None) is None


@pytest.mark.parametrize("uv, cat", [(0, "low"), (2.9, "low"), (3, "moderate"), (6, "high"), (8, "very_high"), (11, "extreme"), (None, None)])
def test_uv_bands(uv, cat):
    assert uv_category(uv) == cat


def _aq(hours: int = 48, pm25=lambda i: 40.0, pm10=lambda i: 80.0, start=datetime(2026, 11, 1, 0, 0)):
    times = [(start + timedelta(hours=i)).strftime("%Y-%m-%dT%H:%M") for i in range(hours)]
    return AirQualityData(
        timezone="Asia/Kolkata",
        hourly=AirQualityHourly(time=times, pm2_5=[pm25(i) for i in range(hours)], pm10=[pm10(i) for i in range(hours)]),
    )


def test_trailing_24h_mean_and_index():
    data = _aq(pm25=lambda i: 20.0 if i < 24 else 60.0)
    s = trailing_24h(data, datetime(2026, 11, 2, 23, 30))  # hours 24..47
    assert s.hours == 24 and s.pm2_5 == 60.0 and s.aqi == 100 and s.aqi_category == "satisfactory"
    assert "not a CPCB station" in s.note


def test_summarise_outside_data_is_none():
    assert summarise(_aq(), datetime(2027, 1, 1), datetime(2027, 1, 2)) is None


# ---------------------------------------------------------------------------
# Templates: Marathi for every parameter, AQ/UV in every language, all grounded
# ---------------------------------------------------------------------------

FACTS = WeatherFacts(
    location="Pune", requested_time="tomorrow (2026-11-02T00:00 to 2026-11-02T23:00)", timezone="Asia/Kolkata",
    temperature_2m=27.5, temperature_min=21.2, temperature_max=30.4, precipitation=12.6, precipitation_probability=80,
    wind_speed_10m=22.0, relative_humidity_2m=78.0, weather_code=63, weather_description="Rain",
    uv_index=7.4, pm2_5=48.2, pm10=92.6, aqi=81, aqi_category="satisfactory", aqi_dominant="pm2_5",
)
PARAMS = ["temperature", "high_temperature", "precipitation", "heavy_rain", "rain_likelihood", "wind",
          "strong_wind", "storm", "humidity", "advisory", "air_quality", "uv", "general"]


@pytest.mark.parametrize("param", PARAMS)
def test_marathi_template_for_every_parameter_is_grounded(param):
    text = template_response(ChatIntent(intent="forecast", date_reference="tomorrow", weather_parameter=param, language="mr"), FACTS)
    assert "Pune" in text and "उद्या" in text, text
    assert numbers_grounded(text, allowed_numbers(FACTS)), text


@pytest.mark.parametrize("lang", ["en", "hi", "hinglish", "mr"])
def test_air_quality_and_uv_replies_are_grounded(lang):
    for param, must in (("air_quality", "AQI 81"), ("uv", "7.4")):
        text = template_response(ChatIntent(intent="forecast", date_reference="tomorrow", weather_parameter=param, language=lang), FACTS)
        assert must in text, text
        assert numbers_grounded(text, allowed_numbers(FACTS)), text
    aq = template_response(ChatIntent(weather_parameter="air_quality", language=lang), FACTS)
    assert "CPCB" in aq


def test_pollutant_names_do_not_open_the_grounding_check():
    allowed = allowed_numbers(FACTS)
    assert numbers_grounded("PM2.5 48.2 µg/m³ and PM10 92.6 µg/m³", allowed)
    assert not numbers_grounded("PM2.5 is 10 µg/m³", allowed)  # 10 is not a fact


def test_missing_air_quality_says_unavailable():
    facts = FACTS.model_copy(update={"aqi": None, "aqi_category": None})
    text = template_response(ChatIntent(weather_parameter="air_quality", language="mr"), facts)
    assert "उपलब्ध नाही" in text


def test_marathi_period_unavailable_and_location_prompts():
    from llm.response_generator import ask_for_location, unknown_location

    text = template_response(ChatIntent(date_reference="sunday", language="mr"), FACTS.model_copy(update={"period_available": False}))
    assert "रविवारी" in text and "उपलब्ध नाही" in text
    assert "ठिकाण" in ask_for_location(ChatIntent(language="mr"))
    assert "Shirdi" in unknown_location(ChatIntent(language="mr"), "Shirdi")


def test_every_advisory_has_marathi_text():
    for text in (
        "Heavy rain expected. Carry an umbrella and expect minor travel delays.",
        "Weather conditions are currently normal with no significant risks.",
    ):
        mr = localized_advisory(AdvisoryResult(severity="moderate", condition="x", advisory=text, reasons=[]), "mr")
        assert mr != text and any("ऀ" <= ch <= "ॿ" for ch in mr)


def test_marathi_climate_gfs_and_role_notes():
    climate = ClimateFacts(
        location="Pune", timezone="Asia/Kolkata", period="this_year", period_start="2026-01-01", period_end="2026-10-26",
        baseline_start_year=2016, baseline_end_year=2025, baseline_years=10, days_with_data=299,
        mean_temperature_max=32.1, baseline_mean_temperature_max=31.2, temperature_max_anomaly=0.9,
        total_precipitation=812.5, baseline_total_precipitation=701.3, precipitation_anomaly_percent=16,
    )
    text = climate_template(ChatIntent(intent="climate", language="mr", climate_period="this_year"), climate)
    assert "या वर्षी आतापर्यंत" in text and numbers_grounded(text, allowed_numbers_in(climate))
    gfs = NwpFacts(run="2026-11-01T06:00:00+00:00", location="Pune", requested_time="tomorrow (2026-11-02T00:30 to 2026-11-02T23:30)",
                   timezone="Asia/Kolkata", hours=24, temperature_min=21.6, temperature_max=28.1, precipitation=13.2, wind_speed_max=11.8)
    text = nwp_template(ChatIntent(intent="nwp", date_reference="tomorrow", language="mr"), gfs)
    assert "अधिकृत अंदाज नाही" in text and numbers_grounded(text, allowed_numbers_in(gfs))
    for role in ("farmer", "aviation", "disaster_manager", "researcher"):
        note = role_note(role, FACTS, AdvisoryResult(severity="high", condition="Heavy rain", advisory="x", reasons=[]), "mr")
        assert note and numbers_grounded(note, allowed_numbers(FACTS)), note


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------


def test_chat_marathi_end_to_end():
    with ExitStack() as stack:
        for p in chat_patches(weather=sample_weather()):
            stack.enter_context(p)
        body = client.post("/api/chat", json={"message": "पुण्यात उद्या पाऊस पडेल का?"}).json()
    assert body["intent"]["language"] == "mr"
    assert "उद्या" in body["message"] and "पाऊस" in body["message"]


def test_chat_air_quality_uses_the_air_quality_api():
    data = _aq(hours=24 * 7, start=datetime.now().replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=1))
    with ExitStack() as stack:
        for p in chat_patches(weather=sample_weather()):
            stack.enter_context(p)
        stack.enter_context(patch("api.chat.fetch_air_quality", AsyncMock(return_value=data)))
        body = client.post("/api/chat", json={"message": "What is the AQI in Pune right now?"}).json()
    # PM2.5 40 -> 67, PM10 80 -> 80 (51 + 49*30/50): PM10 dominates
    assert body["weather"]["aqi"] == 80 and body["weather"]["aqi_dominant"] == "pm10"
    assert "AQI 80" in body["message"]
    assert numbers_grounded(body["message"], allowed_numbers(WeatherFacts(**body["weather"])))


def test_chat_air_quality_failure_is_graceful():
    with ExitStack() as stack:
        for p in chat_patches(weather=sample_weather()):
            stack.enter_context(p)
        stack.enter_context(patch("api.chat.fetch_air_quality", AsyncMock(side_effect=RuntimeError("down"))))
        resp = client.post("/api/chat", json={"message": "Pune air quality now?"})
    assert resp.status_code == 200
    assert "not available" in resp.json()["message"]


def test_air_quality_endpoint():
    now = datetime.now().replace(minute=0, second=0, microsecond=0)
    data = _aq(hours=72, start=now - timedelta(hours=30), pm25=lambda i: 100.0)
    with patch("api.air.fetch_air_quality", AsyncMock(return_value=data)), patch(
        "api.air.fetch_validated_weather", AsyncMock(side_effect=RuntimeError("down"))
    ):
        body = client.get("/api/air-quality?latitude=28.6&longitude=77.2").json()
    assert body["last_24h"]["aqi"] == 234  # 201 + 99*10/30 and body["last_24h"]["aqi_category"] == "poor"
    assert body["next_24h"]["hours"] == 24
    assert body["uv_index"] is None  # UV failure does not fail the report
    assert "not a CPCB monitoring-station reading" in body["note"]
