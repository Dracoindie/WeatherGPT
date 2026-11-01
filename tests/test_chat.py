"""
tests/test_chat.py

POST /api/chat — current contract.

Request:  { message, optional latitude, optional longitude }
Response: { message, intent, location, weather, source }

External Nominatim / Open-Meteo / LLM / Supabase calls are mocked.
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, patch
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from auth.trusted_location import TrustedDefaultLocation
from geocoding import GeoResult
from llm.query_parser import parse_query_fallback
from llm.response_generator import is_grounded, template_response
from main import app
from models.chat import ChatIntent, WeatherFacts
from models.weather import CurrentWeather, HourlyWeather, WeatherResponse

client = TestClient(app)

PUNE = GeoResult(18.5204, 73.8567, "Pune")
NAGPUR = GeoResult(21.1458, 79.0882, "Nagpur")
DELHI = TrustedDefaultLocation(latitude=28.6139, longitude=77.2090, name="New Delhi")


def sample_weather(
    latitude: float = 18.5204,
    longitude: float = 73.8567,
    current_temp: float = 28.3,
    tomorrow_precip_per_hour: float = 0.2,
    tomorrow_prob: int = 80,
    hourly_code: int = 2,
    hourly_humidity: float = 65.0,
    days: int = 7,
) -> WeatherResponse:
    tz = ZoneInfo("Asia/Kolkata")
    now = datetime.now(tz)
    times: list[str] = []
    temps: list[float] = []
    probs: list[int] = []
    precs: list[float] = []
    winds: list[float] = []
    codes: list[int] = []
    hums: list[float] = []
    for day_offset in range(0, days):
        day = now.date() + timedelta(days=day_offset)
        for hour in range(24):
            times.append(f"{day.isoformat()}T{hour:02d}:00")
            temps.append(31.0 if hour == 15 else 24.5)
            if day_offset == 1:
                probs.append(tomorrow_prob)
                precs.append(tomorrow_precip_per_hour)
            else:
                probs.append(10)
                precs.append(0.0)
            winds.append(12.5)
            codes.append(hourly_code)
            hums.append(hourly_humidity)
    return WeatherResponse(
        latitude=latitude,
        longitude=longitude,
        timezone="Asia/Kolkata",
        retrieved_at=now,
        current=CurrentWeather(
            temperature_2m=current_temp,
            relative_humidity_2m=74.0,
            precipitation=0.0,
            wind_speed_10m=12.5,
            weather_code=2,
            time=now.replace(minute=0, second=0, microsecond=0).strftime("%Y-%m-%dT%H:%M"),
        ),
        hourly=HourlyWeather(
            time=times,
            temperature_2m=temps,
            precipitation_probability=probs,
            precipitation=precs,
            wind_speed_10m=winds,
            weather_code=codes,
            relative_humidity_2m=hums,
        ),
    )


def chat_patches(
    *,
    geo: GeoResult | None = PUNE,
    weather: WeatherResponse | None = None,
    weather_error: Exception | None = None,
    trusted: TrustedDefaultLocation | None = None,
    reverse_name: str = "selected location",
):
    """Patch chat.py's imported collaborators (not the live HTTP clients)."""
    if weather is None:
        weather = sample_weather()

    async def _geocode(_place: str):
        return geo

    fetch = AsyncMock()
    if weather_error is not None:
        fetch.side_effect = weather_error
    else:
        fetch.return_value = weather

    return (
        patch("api.chat.geocode_place", side_effect=_geocode),
        patch("api.chat.reverse_geocode", AsyncMock(return_value=reverse_name)),
        patch("api.chat.fetch_validated_weather", fetch),
        patch("api.chat.get_trusted_default_location", AsyncMock(return_value=trusted)),
    )


def post_chat(message: str, **kwargs):
    return client.post("/api/chat", json={"message": message, **kwargs})


# ---------------------------------------------------------------------------
# Request validation
# ---------------------------------------------------------------------------


class TestChatRequestValidation:
    def test_missing_message_returns_422(self):
        resp = client.post("/api/chat", json={"latitude": 18.52, "longitude": 73.85})
        assert resp.status_code == 422

    def test_empty_message_returns_422(self):
        resp = post_chat("")
        assert resp.status_code == 422

    def test_message_too_long_returns_422(self):
        resp = post_chat("x" * 2001)
        assert resp.status_code == 422

    def test_message_at_max_length_passes(self):
        patches = chat_patches(geo=PUNE)
        with patches[0], patches[1], patches[2], patches[3]:
            resp = post_chat("x" * 2000)
        assert resp.status_code == 200

    def test_invalid_latitude_returns_422(self):
        resp = post_chat("weather?", latitude=91.0, longitude=73.0)
        assert resp.status_code == 422

    def test_invalid_longitude_returns_422(self):
        resp = post_chat("weather?", latitude=18.0, longitude=181.0)
        assert resp.status_code == 422

    def test_legacy_explicit_fields_are_ignored(self):
        """Old body keys must not be treated as coordinates."""
        patches = chat_patches(trusted=None)
        with patches[0], patches[1], patches[2], patches[3]:
            resp = client.post(
                "/api/chat",
                json={
                    "message": "Will it rain tomorrow?",
                    "explicit_latitude": 18.5204,
                    "explicit_longitude": 73.8567,
                    "user_id": "550e8400-e29b-41d4-a716-446655440000",
                    "default_latitude": 28.6139,
                    "default_longitude": 77.2090,
                },
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["location"] is None
        assert body["weather"] is None
        assert "location" in body["message"].lower()


# ---------------------------------------------------------------------------
# Query understanding (deterministic parser — no network)
# ---------------------------------------------------------------------------


class TestQueryUnderstanding:
    def test_english_temperature_tomorrow(self):
        intent = parse_query_fallback("What is the temperature in Nagpur tomorrow?")
        assert intent.intent == "forecast"
        assert intent.location_name == "Nagpur"
        assert intent.date_reference == "tomorrow"
        assert intent.weather_parameter == "temperature"
        assert intent.language == "en"

    def test_hindi_temperature(self):
        intent = parse_query_fallback("नागपुर का तापमान क्या है?")
        assert intent.location_name == "Nagpur"
        assert intent.weather_parameter == "temperature"
        assert intent.language == "hi"

    def test_hinglish_rain_tomorrow(self):
        intent = parse_query_fallback("Pune mein kal baarish hogi kya?")
        assert intent.intent == "forecast"
        assert intent.location_name == "Pune"
        assert intent.date_reference == "tomorrow"
        assert intent.weather_parameter == "precipitation"
        assert intent.language == "hinglish"

    def test_missing_location_not_invented(self):
        intent = parse_query_fallback("Will it rain tomorrow?")
        assert intent.location_name is None
        assert intent.date_reference == "tomorrow"
        assert intent.weather_parameter == "precipitation"


# ---------------------------------------------------------------------------
# Endpoint behaviour
# ---------------------------------------------------------------------------


class TestChatLanguages:
    def test_english_query(self):
        patches = chat_patches(geo=NAGPUR, weather=sample_weather(21.1458, 79.0882, 29.1))
        with patches[0], patches[1], patches[2], patches[3]:
            resp = post_chat("What is the temperature in Nagpur tomorrow?")
        assert resp.status_code == 200
        body = resp.json()
        assert body["source"] == "open-meteo"
        assert body["intent"]["language"] == "en"
        assert body["intent"]["weather_parameter"] == "temperature"
        assert body["location"]["source"] == "explicit_query"
        assert body["weather"]["temperature_min"] is not None

    def test_hindi_query(self):
        patches = chat_patches(geo=NAGPUR, weather=sample_weather(21.1458, 79.0882, 29.1))
        with patches[0], patches[1], patches[2], patches[3]:
            resp = post_chat("नागपुर का तापमान क्या है?")
        assert resp.status_code == 200
        body = resp.json()
        assert body["intent"]["language"] == "hi"
        assert "29.1" in body["message"] or "29" in body["message"]
        assert body["source"] == "open-meteo"

    def test_hinglish_query(self):
        patches = chat_patches(geo=PUNE)
        with patches[0], patches[1], patches[2], patches[3]:
            resp = post_chat("Pune mein kal baarish hogi kya?")
        assert resp.status_code == 200
        body = resp.json()
        assert body["intent"]["language"] == "hinglish"
        assert body["intent"]["weather_parameter"] == "precipitation"
        assert body["intent"]["date_reference"] == "tomorrow"
        assert body["weather"]["precipitation"] is not None
        assert body["location"]["name"] == "Pune"


class TestChatLocations:
    def test_explicit_location_name(self):
        patches = chat_patches(geo=PUNE)
        with patches[0], patches[1], patches[2], patches[3]:
            resp = post_chat("Pune ka weather kaisa hai?")
        assert resp.status_code == 200
        body = resp.json()
        assert body["location"]["source"] == "explicit_query"
        assert body["location"]["latitude"] == pytest.approx(18.5204)
        assert body["location"]["longitude"] == pytest.approx(73.8567)
        assert set(body.keys()) >= {"message", "intent", "location", "weather", "source"}

    def test_explicit_coordinates(self):
        patches = chat_patches(reverse_name="Pune, Maharashtra")
        with patches[0], patches[1], patches[2], patches[3]:
            resp = post_chat(
                "What is the weather right now?",
                latitude=18.5204,
                longitude=73.8567,
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["location"]["source"] == "request_coordinates"
        assert body["location"]["latitude"] == pytest.approx(18.5204)
        assert body["weather"]["temperature_2m"] == 28.3

    def test_partial_coordinates_not_used(self):
        patches = chat_patches(trusted=None)
        with patches[0], patches[1], patches[2], patches[3]:
            resp = post_chat("Will it rain tomorrow?", latitude=18.5204)
        assert resp.status_code == 200
        assert resp.json()["location"] is None

    def test_default_location_from_trusted_session(self):
        patches = chat_patches(
            trusted=DELHI,
            weather=sample_weather(28.6139, 77.2090, 33.0),
        )
        with patches[0], patches[1], patches[2], patches[3]:
            resp = client.post(
                "/api/chat",
                json={"message": "What is the weather today?"},
                headers={"Authorization": "Bearer fake-session-token"},
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["location"]["source"] == "trusted_user_default"
        assert body["location"]["latitude"] == pytest.approx(28.6139)
        assert body["location"]["name"] == "New Delhi"

    def test_named_location_beats_trusted_default(self):
        patches = chat_patches(
            geo=PUNE,
            trusted=DELHI,
            weather=sample_weather(18.5204, 73.8567, 28.3),
        )
        with patches[0], patches[1], patches[2], patches[3]:
            resp = client.post(
                "/api/chat",
                json={"message": "Pune ka weather kaisa hai?"},
                headers={"Authorization": "Bearer fake-session-token"},
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["location"]["source"] == "explicit_query"
        assert body["location"]["latitude"] == pytest.approx(18.5204)

    def test_named_location_beats_request_coordinates(self):
        patches = chat_patches(geo=PUNE)
        with patches[0], patches[1], patches[2], patches[3]:
            resp = post_chat(
                "Pune mein kal baarish hogi kya?",
                latitude=28.6139,
                longitude=77.2090,
            )
        assert resp.status_code == 200
        assert resp.json()["location"]["source"] == "explicit_query"

    def test_client_default_fields_cannot_inject_location(self):
        patches = chat_patches(trusted=None)
        with patches[0], patches[1], patches[2], patches[3]:
            resp = client.post(
                "/api/chat",
                json={
                    "message": "Will it rain tomorrow?",
                    "user_id": "someone-else",
                    "default_latitude": 28.6139,
                    "default_longitude": 77.2090,
                    "default_location_name": "New Delhi",
                },
            )
        assert resp.status_code == 200
        assert resp.json()["location"] is None

    def test_missing_location_asks_user(self):
        patches = chat_patches(trusted=None)
        with patches[0], patches[1], patches[2], patches[3]:
            resp = post_chat("Will it rain tomorrow?")
        assert resp.status_code == 200
        body = resp.json()
        assert body["location"] is None
        assert body["weather"] is None
        assert "location" in body["message"].lower()
        assert body["source"] == "open-meteo"

    def test_unknown_location(self):
        patches = chat_patches(geo=None)
        with patches[0], patches[1], patches[2], patches[3]:
            resp = post_chat("Weather in Atlantis?")
        assert resp.status_code == 200
        body = resp.json()
        assert body["location"] is None
        assert body["weather"] is None
        assert "Atlantis" in body["message"]


class TestChatWeatherSelection:
    def test_temperature_query_uses_temperature(self):
        patches = chat_patches(geo=PUNE, weather=sample_weather(current_temp=28.3))
        with patches[0], patches[1], patches[2], patches[3]:
            resp = post_chat("What is the temperature in Pune?")
        body = resp.json()
        assert body["intent"]["weather_parameter"] == "temperature"
        assert body["weather"]["temperature_2m"] == 28.3
        assert "28.3" in body["message"]
        assert body["weather"]["precipitation"] is None

    def test_rain_query_uses_precipitation(self):
        patches = chat_patches(geo=PUNE)
        with patches[0], patches[1], patches[2], patches[3]:
            resp = post_chat("Pune mein kal baarish hogi kya?")
        body = resp.json()
        assert body["intent"]["weather_parameter"] == "precipitation"
        assert body["weather"]["precipitation"] == pytest.approx(4.8)
        assert body["weather"]["precipitation_probability"] == 80
        assert body["weather"]["wind_speed_10m"] is None

    def test_tomorrow_uses_hourly_window(self):
        patches = chat_patches(geo=NAGPUR, weather=sample_weather(21.1458, 79.0882, 29.1))
        with patches[0], patches[1], patches[2], patches[3]:
            resp = post_chat("What is the temperature in Nagpur tomorrow?")
        body = resp.json()
        assert body["intent"]["date_reference"] == "tomorrow"
        assert "tomorrow" in body["weather"]["requested_time"]
        assert body["weather"]["period_available"] is True
        assert body["weather"]["temperature_min"] == 24.5
        assert body["weather"]["temperature_max"] == 31.0

    def test_weather_api_failure_returns_502(self):
        patches = chat_patches(
            geo=PUNE,
            weather_error=RuntimeError("Weather service is temporarily unavailable."),
        )
        with patches[0], patches[1], patches[2], patches[3]:
            resp = post_chat("Pune ka weather kaisa hai?")
        assert resp.status_code == 502
        assert "temporarily unavailable" in resp.json()["detail"].lower()


class TestChatGrounding:
    def test_response_contains_retrieved_values_only(self):
        patches = chat_patches(geo=PUNE, weather=sample_weather(current_temp=28.3))
        with patches[0], patches[1], patches[2], patches[3]:
            resp = post_chat("What is the temperature in Pune?")
        body = resp.json()
        assert body["weather"]["source"] == "open-meteo"
        assert is_grounded(body["message"], WeatherFacts(**body["weather"]))

    def test_ungrounded_numbers_are_rejected(self):
        facts = WeatherFacts(
            source="open-meteo",
            location="Pune",
            requested_time="now",
            timezone="Asia/Kolkata",
            temperature_2m=28.3,
            period_available=True,
        )
        assert is_grounded("The temperature in Pune is 28.3°C (Open-Meteo).", facts)
        assert not is_grounded("The temperature in Pune is 99°C.", facts)

    def test_template_uses_facts(self):
        intent = ChatIntent(
            intent="current_weather",
            location_name="Pune",
            date_reference="now",
            weather_parameter="temperature",
            language="en",
        )
        facts = WeatherFacts(
            source="open-meteo",
            location="Pune",
            requested_time="now",
            timezone="Asia/Kolkata",
            temperature_2m=28.3,
            period_available=True,
        )
        text = template_response(intent, facts)
        assert "28.3" in text
        assert "Pune" in text
        assert "Open-Meteo" in text

class TestAdvisoryIntelligence:
    def test_rain_advisory_heavy(self):
        # 1.0 * 24 = 24.0 mm -> moderate severity (Heavy Rain)
        patches = chat_patches(geo=PUNE, weather=sample_weather(tomorrow_precip_per_hour=1.0))
        with patches[0], patches[1], patches[2], patches[3]:
            resp = post_chat("Is there heavy rain in Pune tomorrow?")
        
        body = resp.json()
        assert body["intent"]["weather_parameter"] == "heavy_rain"
        assert body["advisory"] is not None
        assert body["advisory"]["severity"] == "moderate"
        assert body["advisory"]["condition"] == "Heavy Rain"
        assert "umbrella" in body["advisory"]["advisory"].lower()

    def test_rain_advisory_extreme(self):
        # 3.0 * 24 = 72.0 mm -> high severity (Extreme Rain / Flood Risk)
        patches = chat_patches(geo=PUNE, weather=sample_weather(tomorrow_precip_per_hour=3.0))
        with patches[0], patches[1], patches[2], patches[3]:
            resp = post_chat("Flood in Pune tomorrow?")
        
        body = resp.json()
        assert body["intent"]["weather_parameter"] == "heavy_rain"
        assert body["advisory"]["severity"] == "high"
        assert "Extreme Rain" in body["advisory"]["condition"]
        assert "avoid unnecessary travel" in body["advisory"]["advisory"].lower()

    def test_heat_advisory_extreme(self):
        # For 'now', it uses current_temp
        patches = chat_patches(geo=PUNE, weather=sample_weather(current_temp=41.5))
        with patches[0], patches[1], patches[2], patches[3]:
            resp = post_chat("Is it hot in Pune right now?")
        
        body = resp.json()
        assert body["intent"]["weather_parameter"] == "high_temperature"
        assert body["advisory"]["severity"] == "high"
        assert body["advisory"]["condition"] == "Extreme Heat"
        assert "stay indoors" in body["advisory"]["advisory"].lower()

    def test_wind_advisory_moderate(self):
        weather = sample_weather()
        weather.current.wind_speed_10m = 45.0
        patches = chat_patches(geo=PUNE, weather=weather)
        with patches[0], patches[1], patches[2], patches[3]:
            resp = post_chat("Is there a strong wind in Pune now?")
        
        body = resp.json()
        assert body["intent"]["weather_parameter"] == "strong_wind"
        assert body["advisory"]["severity"] == "moderate"
        assert "Strong Winds" in body["advisory"]["condition"]

    def test_general_advisory_when_routine(self):
        patches = chat_patches(geo=PUNE, weather=sample_weather(current_temp=25.0, tomorrow_precip_per_hour=0.0, tomorrow_prob=0))
        with patches[0], patches[1], patches[2], patches[3]:
            resp = post_chat("Are there any weather advisories for Pune tomorrow?")
        
        body = resp.json()
        assert body["intent"]["weather_parameter"] == "advisory"
        assert body["advisory"]["severity"] == "low"
        assert "normal" in body["advisory"]["advisory"].lower()
