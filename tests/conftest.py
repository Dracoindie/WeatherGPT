"""Shared pytest fixtures. Keep all tests offline (no LLM / Nominatim / Open-Meteo / Supabase)."""

import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))


@pytest.fixture(autouse=True)
def disable_live_integrations(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "none")
    for key in (
        "GEMINI_API_KEY",
        "GOOGLE_API_KEY",
        "GROQ_API_KEY",
        "OPENAI_API_KEY",
        "LLM_API_KEY",
        "SUPABASE_URL",
        "SUPABASE_ANON_KEY",
        "OPEN_METEO_API_KEY",
    ):
        monkeypatch.delenv(key, raising=False)


@pytest.fixture(autouse=True)
def isolated_geocode_file(monkeypatch, tmp_path):
    """Never read or write the real backend/data/geocode_cache.json in tests."""
    monkeypatch.setenv("GEOCODE_CACHE_PATH", str(tmp_path / "geocode_cache.json"))


@pytest.fixture(autouse=True)
def reset_geocoding_cache(isolated_geocode_file):
    """Each test starts with an empty Nominatim cache and rate-limit clock."""
    import geocoding

    geocoding.clear_cache()
    yield
    geocoding.clear_cache()


@pytest.fixture(autouse=True)
def reset_alerts_cache():
    """Each test starts without last-known-good alert data."""
    from api import alerts

    alerts.clear_cache()
    yield
    alerts.clear_cache()


@pytest.fixture(autouse=True)
def reset_map_tile_hooks():
    """demo_replay.install() sets the tile layer's replay/record hooks; never leak them."""
    from maps import tiles

    tiles.fixture_loader = None
    tiles.fixture_saver = None
    tiles.clear_cache()
    yield
    tiles.fixture_loader = None
    tiles.fixture_saver = None
    tiles.clear_cache()


@pytest.fixture(autouse=True)
def fixture_clock(monkeypatch):
    """Fixtures carry fixed dates, so the wall clock would land anywhere in (or
    outside) their series. By default the window rule's clock is far outside
    every fixture, so windows start at the model's own current time (the
    fallback in window_rule.window_start). Tests of the clock set it themselves."""
    from datetime import datetime, timezone

    import window_rule

    monkeypatch.setattr(window_rule, "now_utc", lambda: datetime(2000, 1, 1, tzinfo=timezone.utc))
