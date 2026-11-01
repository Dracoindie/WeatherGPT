"""Backend env-var names: warn (never silently accept) NEXT_PUBLIC_ Supabase names."""

from __future__ import annotations

import asyncio
import logging

import pytest

from env_check import misnamed_env_vars, warn_misnamed_env_vars


def test_warns_when_only_prefixed_names_are_set(caplog):
    env = {"NEXT_PUBLIC_SUPABASE_URL": "https://x.supabase.co", "NEXT_PUBLIC_SUPABASE_ANON_KEY": "anon-secret"}
    with caplog.at_level(logging.WARNING, logger="weathergpt.env"):
        pairs = warn_misnamed_env_vars(env)
    assert pairs == [("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"), ("SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY")]
    text = caplog.text
    assert "rename it to SUPABASE_URL" in text and "rename it to SUPABASE_ANON_KEY" in text
    # names only, never values
    assert "anon-secret" not in text and "x.supabase.co" not in text


def test_no_warning_when_backend_names_are_set(caplog):
    env = {"SUPABASE_URL": "u", "NEXT_PUBLIC_SUPABASE_URL": "u", "SUPABASE_ANON_KEY": "k"}
    with caplog.at_level(logging.WARNING, logger="weathergpt.env"):
        assert warn_misnamed_env_vars(env) == []
    assert caplog.text == ""


def test_blank_backend_value_counts_as_missing():
    assert misnamed_env_vars({"SUPABASE_URL": "  ", "NEXT_PUBLIC_SUPABASE_URL": "u"}) == [
        ("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL")
    ]


def test_prefixed_names_are_not_accepted_by_trusted_location(monkeypatch):
    """The backend must not quietly read the frontend names."""
    from auth import trusted_location

    monkeypatch.setenv("NEXT_PUBLIC_SUPABASE_URL", "https://x.supabase.co")
    monkeypatch.setenv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon")
    token = "a." + "eyJzdWIiOiIxMjNlNDU2Ny1lODliLTEyZDMtYTQ1Ni00MjY2MTQxNzQwMDAifQ" + ".c"
    assert asyncio.run(trusted_location.get_trusted_default_location(f"Bearer {token}")) is None


def test_alert_job_warns_about_prefixed_names(monkeypatch, caplog):
    from dissemination import job

    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    monkeypatch.setenv("NEXT_PUBLIC_SUPABASE_URL", "https://x.supabase.co")
    with caplog.at_level(logging.WARNING, logger="weathergpt.env"):
        with pytest.raises(RuntimeError):
            asyncio.run(job.run_from_env())
    assert "rename it to SUPABASE_URL" in caplog.text


def test_startup_logs_the_warning(monkeypatch):
    """Importing main (app startup) logs the rename hint."""
    from test_app_config import _run

    body = """
import io, json, logging
buf = io.StringIO()
logging.getLogger("weathergpt.env").addHandler(logging.StreamHandler(buf))
import main
print(json.dumps({"log": buf.getvalue()}))
"""
    env = {"SUPABASE_URL": "", "NEXT_PUBLIC_SUPABASE_URL": "https://x.supabase.co", "SUPABASE_ANON_KEY": "set"}
    result = _run(body, env=env)
    assert "rename it to SUPABASE_URL" in result["log"]
    assert "SUPABASE_ANON_KEY is not set" not in result["log"]
