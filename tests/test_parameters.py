"""Weather parameters: fact focusing and template wording in en / hi / hinglish."""

import pytest

from llm.response_generator import is_grounded, template_response
from models.chat import AdvisoryResult, ChatIntent, WeatherFacts
from query_service import focus_facts
from test_chat import PUNE, chat_patches, post_chat, sample_weather


def _facts(**kwargs) -> WeatherFacts:
    base = dict(
        location="Pune",
        requested_time="tomorrow (2026-11-02T00:00 to 2026-11-02T23:00)",
        timezone="Asia/Kolkata",
        temperature_2m=31.0,
        temperature_min=24.5,
        temperature_max=36.2,
        precipitation=18.4,
        precipitation_probability=85,
        wind_speed_10m=52.0,
        relative_humidity_2m=70.0,
        weather_code=95,
        weather_description="Thunderstorm",
    )
    base.update(kwargs)
    return WeatherFacts(**base)


def _intent(parameter: str, language: str = "en", date_reference: str = "tomorrow") -> ChatIntent:
    return ChatIntent(
        intent="forecast",
        location_name="Pune",
        date_reference=date_reference,
        weather_parameter=parameter,
        language=language,
    )


def _reply(parameter: str, language: str = "en", **facts) -> str:
    intent = _intent(parameter, language)
    return template_response(intent, focus_facts(_facts(**facts), parameter))


class TestFocusFacts:
    @pytest.mark.parametrize("parameter", ["temperature", "high_temperature"])
    def test_temperature_parameters_drop_rain_and_wind(self, parameter):
        focused = focus_facts(_facts(), parameter)
        assert focused.temperature_max == 36.2
        assert focused.precipitation is None
        assert focused.precipitation_probability is None
        assert focused.wind_speed_10m is None

    @pytest.mark.parametrize("parameter", ["precipitation", "heavy_rain", "rain_likelihood"])
    def test_rain_parameters_keep_rain_drop_wind(self, parameter):
        focused = focus_facts(_facts(), parameter)
        assert focused.precipitation == 18.4
        assert focused.precipitation_probability == 85
        assert focused.wind_speed_10m is None
        assert focused.relative_humidity_2m is None

    @pytest.mark.parametrize("parameter", ["wind", "strong_wind"])
    def test_wind_parameters_keep_wind_drop_rain(self, parameter):
        focused = focus_facts(_facts(), parameter)
        assert focused.wind_speed_10m == 52.0
        assert focused.precipitation is None
        assert focused.precipitation_probability is None

    def test_storm_keeps_wind_rain_and_description(self):
        focused = focus_facts(_facts(), "storm")
        assert focused.wind_speed_10m == 52.0
        assert focused.precipitation == 18.4
        assert focused.weather_description == "Thunderstorm"
        assert focused.relative_humidity_2m is None

    def test_focus_does_not_mutate_input(self):
        facts = _facts()
        focus_facts(facts, "temperature")
        assert facts.precipitation == 18.4


class TestParameterTemplates:
    def test_high_temperature_en(self):
        text = _reply("high_temperature")
        assert "maximum temperature is 36.2°C" in text
        assert "18.4" not in text

    def test_high_temperature_hi(self):
        assert "अधिकतम तापमान 36.2°C" in _reply("high_temperature", "hi")

    def test_high_temperature_hinglish(self):
        assert "maximum temperature 36.2°C rahega" in _reply("high_temperature", "hinglish")

    def test_high_temperature_current_falls_back_to_temp(self):
        text = _reply("high_temperature", temperature_min=None, temperature_max=None)
        assert "is 31°C" in text

    def test_heavy_rain_en(self):
        text = _reply("heavy_rain")
        assert text.startswith("Heavy rain check for Pune tomorrow")
        assert "18.4 mm" in text and "85%" in text

    def test_heavy_rain_hi(self):
        text = _reply("heavy_rain", "hi")
        assert "भारी बारिश की जाँच" in text and "18.4 मिमी" in text

    def test_heavy_rain_hinglish(self):
        text = _reply("heavy_rain", "hinglish")
        assert "heavy rain check" in text and "18.4 mm" in text

    def test_rain_likelihood_en(self):
        text = _reply("rain_likelihood")
        assert "chance of rain in Pune tomorrow peaks at 85%" in text
        assert "18.4 mm expected" in text

    def test_rain_likelihood_hi(self):
        assert "बारिश की संभावना अधिकतम 85%" in _reply("rain_likelihood", "hi")

    def test_rain_likelihood_hinglish(self):
        assert "baarish ka chance 85% tak" in _reply("rain_likelihood", "hinglish")

    def test_rain_likelihood_without_probability_uses_amount(self):
        # Current conditions carry no probability.
        text = _reply("rain_likelihood", precipitation_probability=None)
        assert "precipitation is 18.4 mm" in text

    def test_storm_en(self):
        text = _reply("storm")
        assert text.startswith("Storm check for Pune tomorrow: thunderstorm")
        assert "wind up to 52 km/h" in text and "18.4 mm" in text

    def test_storm_hi(self):
        text = _reply("storm", "hi")
        assert "तूफान की जाँच" in text and "52 किमी/घंटा" in text

    def test_storm_hinglish(self):
        text = _reply("storm", "hinglish")
        assert "storm check" in text and "wind 52 km/h tak" in text

    def test_strong_wind_en(self):
        assert "reaches up to 52 km/h" in _reply("strong_wind")

    def test_strong_wind_hi(self):
        assert "52 किमी/घंटा तक" in _reply("strong_wind", "hi")

    def test_strong_wind_hinglish(self):
        assert "hawa 52 km/h tak" in _reply("strong_wind", "hinglish")

    @pytest.mark.parametrize(
        "parameter", ["high_temperature", "heavy_rain", "rain_likelihood", "storm", "strong_wind"]
    )
    @pytest.mark.parametrize("language", ["en", "hi", "hinglish"])
    def test_templates_are_grounded(self, parameter, language):
        facts = focus_facts(_facts(), parameter)
        text = template_response(_intent(parameter, language), facts)
        assert is_grounded(text, facts), text


class TestAdvisorySeesPeriodFacts:
    def test_heavy_rain_flagged_on_temperature_question(self):
        # 1.0 mm/h tomorrow = 24 mm: the advisory must see it even though the
        # temperature answer hides precipitation.
        patches = chat_patches(geo=PUNE, weather=sample_weather(tomorrow_precip_per_hour=1.0))
        with patches[0], patches[1], patches[2], patches[3]:
            body = post_chat("What is the temperature in Pune tomorrow?").json()
        assert body["intent"]["weather_parameter"] == "temperature"
        assert body["weather"]["precipitation"] is None
        assert body["advisory"]["condition"] == "Heavy Rain"
        assert "umbrella" in body["message"].lower()

    def test_grounding_accepts_advisory_reason_numbers(self):
        facts = focus_facts(_facts(), "temperature")
        advisory = AdvisoryResult(
            severity="moderate",
            condition="Heavy Rain",
            advisory="Heavy rain expected.",
            reasons=["Precipitation is forecasted at 18.4 mm."],
        )
        text = "Pune tomorrow reaches 36.2°C, and 18.4 mm of rain is expected."
        assert not is_grounded(text, facts)
        assert is_grounded(text, facts, advisory)
