"""Date references: parsing (en / hi / hinglish), forecast windows and wording."""

from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from llm.query_parser import _intent_from_llm_dict, parse_query_fallback
from llm.response_generator import template_response
from models.chat import WEEKDAYS, ChatIntent, WeatherFacts
from query_service import _hour_in_window, _target_date, select_period_facts
from test_chat import sample_weather

IST = ZoneInfo("Asia/Kolkata")


def _today() -> date:
    return datetime.now(IST).date()


def _intent(date_reference: str, parameter: str = "general") -> ChatIntent:
    return ChatIntent(
        intent="forecast",
        location_name="Pune",
        date_reference=date_reference,
        weather_parameter=parameter,
        language="en",
    )


class TestDayAfterTomorrowParsing:
    @pytest.mark.parametrize(
        "message, language",
        [
            ("Will it rain in Pune the day after tomorrow?", "en"),
            ("Pune mein parso baarish hogi kya?", "hinglish"),
            ("Parso Pune ka mausam kaisa rahega?", "hinglish"),
            ("पुणे में परसों बारिश होगी?", "hi"),
        ],
    )
    def test_day_after_tomorrow(self, message, language):
        intent = parse_query_fallback(message)
        assert intent.date_reference == "day_after_tomorrow"
        assert intent.intent == "forecast"
        assert intent.language == language
        assert intent.location_name == "Pune"

    @pytest.mark.parametrize(
        "message", ["Will it rain in Pune tomorrow?", "Pune mein kal baarish hogi kya?", "पुणे में कल बारिश होगी?"]
    )
    def test_tomorrow_is_unchanged(self, message):
        assert parse_query_fallback(message).date_reference == "tomorrow"


WEEKDAY_NAMES = {
    "monday": ("Monday", "somvar", "सोमवार"),
    "tuesday": ("Tuesday", "mangalwar", "मंगलवार"),
    "wednesday": ("Wednesday", "budhvar", "बुधवार"),
    "thursday": ("Thursday", "guruvar", "गुरुवार"),
    "friday": ("Friday", "shukrawar", "शुक्रवार"),
    "saturday": ("Saturday", "shanivaar", "शनिवार"),
    "sunday": ("Sunday", "itwar", "रविवार"),
}


class TestWeekdayParsing:
    @pytest.mark.parametrize("day", WEEKDAYS)
    def test_english(self, day):
        intent = parse_query_fallback(f"Will it rain in Pune on {WEEKDAY_NAMES[day][0]}?")
        assert intent.date_reference == day
        assert intent.intent == "forecast"
        assert intent.language == "en"
        assert intent.location_name == "Pune"

    @pytest.mark.parametrize("day", WEEKDAYS)
    def test_hinglish(self, day):
        intent = parse_query_fallback(f"Pune mein {WEEKDAY_NAMES[day][1]} ko baarish hogi?")
        assert intent.date_reference == day
        assert intent.language == "hinglish"

    @pytest.mark.parametrize("day", WEEKDAYS)
    def test_hindi(self, day):
        intent = parse_query_fallback(f"पुणे में {WEEKDAY_NAMES[day][2]} को बारिश होगी?")
        assert intent.date_reference == day
        assert intent.language == "hi"

    @pytest.mark.parametrize(
        "word, day",
        [
            ("somwar", "monday"),
            ("mangalvaar", "tuesday"),
            ("budhwaar", "wednesday"),
            ("brihaspativar", "thursday"),
            ("veerwar", "thursday"),
            ("shukravar", "friday"),
            ("shaniwar", "saturday"),
            ("ravivar", "sunday"),
            ("itvaar", "sunday"),
        ],
    )
    def test_hinglish_spelling_variants(self, word, day):
        assert parse_query_fallback(f"Nagpur mein {word} ko mausam kaisa hai?").date_reference == day

    @pytest.mark.parametrize("hindi, day", [("बृहस्पतिवार", "thursday"), ("इतवार", "sunday")])
    def test_hindi_variants(self, hindi, day):
        assert parse_query_fallback(f"नागपुर में {hindi} को मौसम?").date_reference == day

    def test_unlisted_city_before_weekday(self):
        intent = parse_query_fallback("Will it rain in Satna on Friday?")
        assert intent.location_name == "Satna"
        assert intent.date_reference == "friday"

    def test_weekday_word_is_not_a_location(self):
        intent = parse_query_fallback("Parso ka mausam kaisa hai?")
        assert intent.location_name is None

    def test_llm_may_return_new_date_references(self):
        fallback = parse_query_fallback("weather")
        for value in ("day_after_tomorrow", "friday"):
            assert _intent_from_llm_dict({"date_reference": value}, fallback).date_reference == value
        assert _intent_from_llm_dict({"date_reference": "next_week"}, fallback).date_reference == "now"


class TestTargetDates:
    def test_day_after_tomorrow(self):
        assert _target_date("day_after_tomorrow", date(2026, 11, 1)) == date(2026, 11, 3)

    def test_weekday_next_occurrence(self):
        sunday = date(2026, 11, 1)
        assert _target_date("monday", sunday) == date(2026, 11, 2)
        assert _target_date("saturday", sunday) == date(2026, 11, 7)

    def test_weekday_today_counts(self):
        sunday = date(2026, 11, 1)
        assert _target_date("sunday", sunday) == sunday


class TestTonightWindow:
    NOW = datetime(2026, 11, 1, 18, 0, tzinfo=IST)

    @pytest.mark.parametrize(
        "dt, inside",
        [
            (datetime(2026, 11, 1, 19, 0, tzinfo=IST), False),
            (datetime(2026, 11, 1, 20, 0, tzinfo=IST), True),
            (datetime(2026, 11, 1, 23, 0, tzinfo=IST), True),
            (datetime(2026, 11, 2, 0, 0, tzinfo=IST), True),
            (datetime(2026, 11, 2, 5, 0, tzinfo=IST), True),
            (datetime(2026, 11, 2, 6, 0, tzinfo=IST), False),
            (datetime(2026, 11, 3, 2, 0, tzinfo=IST), False),
        ],
    )
    def test_tonight_covers_early_morning(self, dt, inside):
        assert _hour_in_window(dt, self.NOW, "tonight") is inside

    def test_tonight_facts_span_midnight(self):
        facts = select_period_facts(sample_weather(), _intent("tonight"), "Pune")
        tomorrow = (_today() + timedelta(days=1)).isoformat()
        assert facts.period_available
        assert facts.requested_time.endswith(f"to {tomorrow}T05:00)")


class TestForecastWindows:
    def test_day_after_tomorrow_window(self):
        facts = select_period_facts(sample_weather(), _intent("day_after_tomorrow"), "Pune")
        day = (_today() + timedelta(days=2)).isoformat()
        assert facts.requested_time == f"day after tomorrow ({day}T00:00 to {day}T23:00)"

    def test_weekday_window(self):
        target = _today() + timedelta(days=5)
        day = WEEKDAYS[target.weekday()]
        facts = select_period_facts(sample_weather(), _intent(day), "Pune")
        assert facts.period_available
        assert facts.requested_time.startswith(f"{day.capitalize()} ({target.isoformat()}T00:00")

    def test_weekday_outside_window_is_unavailable(self):
        target = _today() + timedelta(days=4)
        facts = select_period_facts(sample_weather(days=3), _intent(WEEKDAYS[target.weekday()]), "Pune")
        assert facts.period_available is False

    def test_forecast_includes_description_and_humidity(self):
        facts = select_period_facts(
            sample_weather(hourly_code=63, hourly_humidity=82.0), _intent("tomorrow"), "Pune"
        )
        assert facts.weather_code == 63
        assert facts.weather_description == "Rain"
        assert facts.relative_humidity_2m == 82.0

    def test_headline_code_is_most_significant_hour(self):
        weather = sample_weather(hourly_code=1)
        tomorrow = (_today() + timedelta(days=1)).isoformat()
        weather.hourly.weather_code[weather.hourly.time.index(f"{tomorrow}T16:00")] = 95
        facts = select_period_facts(weather, _intent("tomorrow"), "Pune")
        assert facts.weather_description == "Thunderstorm"

    def test_humidity_is_period_mean(self):
        weather = sample_weather(hourly_humidity=60.0)
        tomorrow = (_today() + timedelta(days=1)).isoformat()
        for hour in range(12):
            weather.hourly.relative_humidity_2m[weather.hourly.time.index(f"{tomorrow}T{hour:02d}:00")] = 80.0
        facts = select_period_facts(weather, _intent("tomorrow", "humidity"), "Pune")
        assert facts.relative_humidity_2m == 70.0


class TestDateWording:
    def _facts(self, **kwargs):
        base = dict(location="Pune", requested_time="x", timezone="Asia/Kolkata", temperature_2m=30.0)
        base.update(kwargs)
        return WeatherFacts(**base)

    @pytest.mark.parametrize(
        "language, phrase",
        [("en", "the day after tomorrow"), ("hi", "परसों"), ("hinglish", "parso")],
    )
    def test_day_after_tomorrow_phrase(self, language, phrase):
        intent = _intent("day_after_tomorrow").model_copy(update={"language": language})
        assert phrase in template_response(intent, self._facts())

    @pytest.mark.parametrize(
        "language, phrase", [("en", "on Friday"), ("hi", "शुक्रवार को"), ("hinglish", "Friday ko")]
    )
    def test_weekday_phrase(self, language, phrase):
        intent = _intent("friday").model_copy(update={"language": language})
        assert phrase in template_response(intent, self._facts())

    @pytest.mark.parametrize("day", WEEKDAYS)
    def test_unavailable_weekday_reply(self, day):
        text = template_response(_intent(day), self._facts(period_available=False))
        assert f"on {day.capitalize()}" in text

    def test_forecast_reply_includes_description(self):
        text = template_response(
            _intent("tomorrow"), self._facts(weather_description="Rain", precipitation=4.0)
        )
        assert "rain" in text and "4 mm" in text

    def test_forecast_humidity_reply(self):
        text = template_response(_intent("tomorrow", "humidity"), self._facts(relative_humidity_2m=72.5))
        assert text == "Relative humidity in Pune tomorrow is 72.5% (Open-Meteo)."
