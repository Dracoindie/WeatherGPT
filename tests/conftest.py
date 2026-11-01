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
    ):
        monkeypatch.delenv(key, raising=False)


@pytest.fixture(autouse=True)
def reset_geocoding_cache():
    """Each test starts with an empty Nominatim cache and rate-limit clock."""
    import geocoding

    geocoding.clear_cache()
    yield
    geocoding.clear_cache()
