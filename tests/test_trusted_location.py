"""
tests/test_trusted_location.py

Mocked tests for JWT-backed default location lookup.
Never calls real Supabase. Never uses client user_id.
"""

from __future__ import annotations

import os
import sys
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from auth.trusted_location import TrustedDefaultLocation, get_trusted_default_location


def _httpx_client(response: MagicMock | None = None, error: Exception | None = None):
    mock_client = AsyncMock()
    if error is not None:
        mock_client.get.side_effect = error
    else:
        mock_client.get.return_value = response
    mock_cls = MagicMock()
    mock_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
    mock_cls.return_value.__aexit__ = AsyncMock(return_value=False)
    return mock_cls, mock_client


@pytest.mark.asyncio
async def test_missing_bearer_token_returns_none():
    result = await get_trusted_default_location(None)
    assert result is None
    result = await get_trusted_default_location("")
    assert result is None


@pytest.mark.asyncio
async def test_invalid_bearer_token_returns_none():
    assert await get_trusted_default_location("Token abc") is None
    assert await get_trusted_default_location("Bearer") is None
    assert await get_trusted_default_location("Bearer ") is None


@pytest.mark.asyncio
async def test_valid_bearer_without_supabase_env_returns_none(monkeypatch):
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_ANON_KEY", raising=False)
    result = await get_trusted_default_location("Bearer valid-jwt")
    assert result is None


@pytest.mark.asyncio
async def test_valid_bearer_returns_profile_default(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon-key")

    response = MagicMock(spec=httpx.Response)
    response.status_code = 200
    response.json.return_value = [
        {
            "default_latitude": 18.5204,
            "default_longitude": 73.8567,
            "default_location_name": "Pune",
        }
    ]
    mock_cls, mock_client = _httpx_client(response)

    with patch("auth.trusted_location.httpx.AsyncClient", mock_cls):
        result = await get_trusted_default_location("Bearer valid-jwt")

    assert result == TrustedDefaultLocation(
        latitude=18.5204,
        longitude=73.8567,
        name="Pune",
    )
    kwargs = mock_client.get.call_args
    assert kwargs.kwargs["headers"]["Authorization"] == "Bearer valid-jwt"
    assert kwargs.kwargs["headers"]["apikey"] == "anon-key"
    assert "user_id" not in (kwargs.kwargs.get("params") or {})


@pytest.mark.asyncio
async def test_no_default_location_on_empty_profile(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon-key")

    response = MagicMock(spec=httpx.Response)
    response.status_code = 200
    response.json.return_value = [
        {
            "default_latitude": None,
            "default_longitude": None,
            "default_location_name": None,
        }
    ]
    mock_cls, _ = _httpx_client(response)

    with patch("auth.trusted_location.httpx.AsyncClient", mock_cls):
        result = await get_trusted_default_location("Bearer valid-jwt")
    assert result is None


@pytest.mark.asyncio
async def test_no_default_when_profile_rows_empty(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon-key")

    response = MagicMock(spec=httpx.Response)
    response.status_code = 200
    response.json.return_value = []
    mock_cls, _ = _httpx_client(response)

    with patch("auth.trusted_location.httpx.AsyncClient", mock_cls):
        assert await get_trusted_default_location("Bearer valid-jwt") is None


@pytest.mark.asyncio
async def test_invalid_session_http_returns_none(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon-key")

    response = MagicMock(spec=httpx.Response)
    response.status_code = 401
    mock_cls, _ = _httpx_client(response)

    with patch("auth.trusted_location.httpx.AsyncClient", mock_cls):
        assert await get_trusted_default_location("Bearer not-a-real-jwt") is None


@pytest.mark.asyncio
async def test_network_error_returns_none(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon-key")
    mock_cls, _ = _httpx_client(error=httpx.ConnectError("offline"))

    with patch("auth.trusted_location.httpx.AsyncClient", mock_cls):
        assert await get_trusted_default_location("Bearer valid-jwt") is None
