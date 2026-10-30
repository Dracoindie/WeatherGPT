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
