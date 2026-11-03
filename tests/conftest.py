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
