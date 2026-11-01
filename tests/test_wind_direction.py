"""wind_direction_10m: fetched, validated and exposed on /api/weather and /api/chat."""

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from models.chat import ChatIntent
from query_service import focus_facts, select_period_facts
from test_chat import PUNE, chat_patches, post_chat, sample_weather
from weather.open_meteo import CURRENT_VARIABLES, HOURLY_VARIABLES


def _intent(date_reference="tomorrow", parameter="wind"):
    return ChatIntent(
        intent="forecast",
        location_name="Pune",
        date_reference=date_reference,
        weather_parameter=parameter,
        language="en",
    )


def test_requested_from_open_meteo():
    assert "wind_direction_10m" in CURRENT_VARIABLES
    assert "wind_direction_10m" in HOURLY_VARIABLES


def test_current_direction_in_facts():
    facts = select_period_facts(sample_weather(), _intent("now"), "Pune")
    assert facts.wind_direction_10m == 250.0


def test_forecast_direction_is_at_peak_wind_hour():
    weather = sample_weather()
    tomorrow = (datetime.now(ZoneInfo("Asia/Kolkata")).date() + timedelta(days=1)).isoformat()
    peak = weather.hourly.time.index(f"{tomorrow}T14:00")
    weather.hourly.wind_speed_10m[peak] = 30.0
    weather.hourly.wind_direction_10m[peak] = 95.0
    facts = select_period_facts(weather, _intent(), "Pune")
    assert facts.wind_speed_10m == 30.0
    assert facts.wind_direction_10m == 95


def test_direction_dropped_with_wind_on_rain_questions():
    facts = select_period_facts(sample_weather(), _intent(parameter="precipitation"), "Pune")
    assert focus_facts(facts, "precipitation").wind_direction_10m is None
    assert focus_facts(facts, "wind").wind_direction_10m == 250


def test_chat_exposes_direction():
    patches = chat_patches(geo=PUNE)
    with patches[0], patches[1], patches[2], patches[3]:
        body = post_chat("How windy is Pune right now?").json()
    assert body["weather"]["wind_direction_10m"] == 250.0
