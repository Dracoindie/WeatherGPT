"""Unit tests for the deterministic advisory engine (backend/advisory.py)."""

from advisory import evaluate_advisory
from models.chat import WeatherFacts


def _facts(**kwargs) -> WeatherFacts:
    base = dict(location="Pune", requested_time="today", timezone="Asia/Kolkata")
    base.update(kwargs)
    return WeatherFacts(**base)


class TestAdvisoryPrecedence:
    def test_extreme_rain_not_overwritten_by_high_heat(self):
        result = evaluate_advisory(_facts(precipitation=60.0, temperature_max=36.0), "general")
        assert result.severity == "high"
        assert result.condition == "Extreme Rain / Flood Risk"
        assert "avoid unnecessary travel" in result.advisory.lower()
        assert any("60.0 mm" in r for r in result.reasons)
        assert any("36.0°C" in r for r in result.reasons)

    def test_extreme_rain_not_overwritten_by_strong_wind(self):
        result = evaluate_advisory(_facts(precipitation=60.0, wind_speed_10m=45.0), "general")
        assert result.severity == "high"
        assert result.condition == "Extreme Rain / Flood Risk"
        assert len(result.reasons) == 2

    def test_extreme_heat_not_overwritten_by_cold_or_wind(self):
        result = evaluate_advisory(
            _facts(temperature_max=41.0, temperature_min=4.0, wind_speed_10m=45.0), "general"
        )
        assert result.severity == "high"
        assert result.condition == "Extreme Heat"
        assert len(result.reasons) == 3

    def test_later_higher_severity_wins_over_earlier_moderate(self):
        result = evaluate_advisory(_facts(precipitation=20.0, temperature_max=42.0), "general")
        assert result.severity == "high"
        assert result.condition == "Extreme Heat"
        assert any("20.0 mm" in r for r in result.reasons)

    def test_storm_wind_beats_heavy_rain(self):
        result = evaluate_advisory(_facts(precipitation=20.0, wind_speed_10m=70.0), "general")
        assert result.severity == "high"
        assert result.condition == "Storm / Gale Winds"

    def test_equal_severity_keeps_check_order(self):
        # Heavy rain and high heat are both moderate; rain is checked first.
        result = evaluate_advisory(_facts(precipitation=20.0, temperature_max=36.0), "general")
        assert result.severity == "moderate"
        assert result.condition == "Heavy Rain"
        assert len(result.reasons) == 2

    def test_light_rain_does_not_mask_strong_wind(self):
        result = evaluate_advisory(_facts(precipitation=2.0, wind_speed_10m=45.0), "heavy_rain")
        assert result.severity == "moderate"
        assert result.condition == "Strong Winds"
        assert any("2.0 mm" in r for r in result.reasons)


class TestAdvisoryThresholds:
    def test_cold_uses_period_minimum(self):
        result = evaluate_advisory(_facts(temperature_min=3.0, temperature_max=12.0), "general")
        assert result.severity == "moderate"
        assert result.condition == "Cold / Chilly"
        assert any("3.0°C" in r for r in result.reasons)

    def test_current_temperature_used_without_range(self):
        result = evaluate_advisory(_facts(temperature_2m=36.5), "general")
        assert result.condition == "High Heat"

    def test_routine_conditions(self):
        result = evaluate_advisory(
            _facts(temperature_2m=25.0, precipitation=0.0, wind_speed_10m=10.0), "general"
        )
        assert result.severity == "low"
        assert result.condition == "Routine conditions"
        assert result.reasons == []

    def test_high_rain_probability_only_is_active(self):
        result = evaluate_advisory(_facts(precipitation_probability=80), "general")
        assert result.severity == "low"
        assert result.condition == "Active Conditions"
        assert result.reasons == ["There is a 80% chance of rain."]

    def test_explicit_advisory_request_when_normal(self):
        result = evaluate_advisory(_facts(temperature_2m=25.0), "advisory")
        assert result.severity == "low"
        assert result.condition == "Routine conditions"
        assert "normal" in result.advisory.lower()

    def test_period_unavailable(self):
        result = evaluate_advisory(_facts(period_available=False), "general")
        assert result.condition == "Unknown"


class TestAdvisoryInReply:
    """Task 2: the reply carries the advisory only when it says something."""

    def _intent(self, language="en", parameter="general"):
        from models.chat import ChatIntent

        return ChatIntent(
            intent="forecast",
            location_name="Pune",
            date_reference="today",
            weather_parameter=parameter,
            language=language,
        )

    def _reply(self, facts, language="en", parameter="general"):
        import asyncio

        from llm.response_generator import generate_response

        advisory = evaluate_advisory(facts, parameter)
        return asyncio.run(generate_response(self._intent(language, parameter), facts, advisory))

    def test_routine_low_advisory_not_appended(self):
        text = self._reply(_facts(temperature_2m=25.0))
        assert "Advisory" not in text
        assert "No specific weather advisories" not in text

    def test_active_conditions_without_trigger_not_appended(self):
        text = self._reply(_facts(temperature_2m=25.0, precipitation_probability=80))
        assert "Advisory" not in text

    def test_unavailable_period_not_appended(self):
        text = self._reply(_facts(period_available=False))
        assert "Advisory" not in text

    def test_low_severity_trigger_is_appended(self):
        text = self._reply(_facts(temperature_2m=25.0, precipitation=2.0), parameter="heavy_rain")
        assert "Advisory: Some rain is expected" in text

    def test_explicit_advisory_request_appends_normal_text(self):
        text = self._reply(_facts(temperature_2m=25.0), parameter="advisory")
        assert "Advisory: Weather conditions are currently normal" in text

    def test_moderate_advisory_appended_in_english(self):
        text = self._reply(_facts(temperature_max=36.0))
        assert "Advisory: Hot conditions expected." in text

    def test_advisory_localized_hindi(self):
        text = self._reply(_facts(precipitation=60.0), language="hi")
        assert "सलाह: भारी वर्षा की संभावना है।" in text
        assert "Severe precipitation" not in text

    def test_advisory_localized_hinglish(self):
        text = self._reply(_facts(wind_speed_10m=70.0), language="hinglish")
        assert "Advisory: Khatarnak tez hawa hai." in text
        assert "Dangerous wind" not in text

    def test_every_triggered_advisory_has_translations(self):
        from advisory import _ADVISORY_TRANSLATIONS

        cases = [
            _facts(precipitation=60.0),
            _facts(precipitation=20.0),
            _facts(precipitation=2.0),
            _facts(temperature_max=41.0),
            _facts(temperature_max=36.0),
            _facts(temperature_min=2.0),
            _facts(wind_speed_10m=70.0),
            _facts(wind_speed_10m=45.0),
        ]
        for facts in cases:
            result = evaluate_advisory(facts, "heavy_rain")
            assert set(_ADVISORY_TRANSLATIONS[result.advisory]) == {"hi", "hinglish"}
