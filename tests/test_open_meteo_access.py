"""open_meteo_access.fetch: retry with backoff (Retry-After honoured), one call per identical request in flight."""

from __future__ import annotations

import asyncio
import email.utils
import time

import httpx
import pytest

import open_meteo_access as oma


@pytest.fixture
def upstream(monkeypatch):
    """Mock Open-Meteo: a list of responses (or exceptions) served in order; records requests and sleeps."""
    state = {"queue": [], "requests": [], "sleeps": [], "gate": None}
    real = httpx.AsyncClient

    async def handler(request: httpx.Request) -> httpx.Response:
        state["requests"].append(request)
        if state["gate"] is not None:
            await state["gate"].wait()
        item = state["queue"].pop(0) if len(state["queue"]) > 1 else state["queue"][0]
        if isinstance(item, Exception):
            raise item
        return item

    def factory(*args, **kwargs):
        kwargs.pop("verify", None)
        return real(*args, transport=httpx.MockTransport(handler), **kwargs)

    async def fake_sleep(s):
        state["sleeps"].append(s)

    monkeypatch.setattr(oma.httpx, "AsyncClient", factory)
    monkeypatch.setattr(oma, "_sleep", fake_sleep)
    monkeypatch.delenv("OPEN_METEO_API_KEY", raising=False)
    oma._inflight.clear()
    yield state
    oma._inflight.clear()


def ok(body=None):
    return httpx.Response(200, json=body or {"ok": True})


def run(coro):
    return asyncio.run(coro)


def test_429_with_short_retry_after_waits_that_long_then_succeeds(upstream):
    upstream["queue"] = [httpx.Response(429, headers={"Retry-After": "2"}), ok()]
    resp = run(oma.fetch("forecast", {"latitude": 18.5}, timeout=5))
    assert resp.status_code == 200
    assert len(upstream["requests"]) == 2
    assert upstream["sleeps"] == [2.0]


def test_429_with_long_retry_after_fails_fast_for_the_cache_or_stale_path(upstream):
    upstream["queue"] = [httpx.Response(429, headers={"Retry-After": "60"}), ok()]
    resp = run(oma.fetch("forecast", {"latitude": 18.5}, timeout=5))
    assert resp.status_code == 429
    assert len(upstream["requests"]) == 1
    assert upstream["sleeps"] == []


def test_retry_after_as_http_date():
    when = email.utils.formatdate(time.time() + 3, usegmt=True)
    s = oma.retry_after_s(httpx.Response(429, headers={"Retry-After": when}))
    assert s is not None and 1.5 <= s <= 3.5
    assert oma.retry_after_s(httpx.Response(429)) is None
    assert oma.retry_after_s(httpx.Response(429, headers={"Retry-After": "soon"})) is None


def test_503_backs_off_and_gives_up_after_max_retries(upstream):
    upstream["queue"] = [httpx.Response(503)]
    resp = run(oma.fetch("forecast", {"latitude": 18.5}, timeout=5))
    assert resp.status_code == 503
    assert len(upstream["requests"]) == oma.MAX_RETRIES + 1
    assert len(upstream["sleeps"]) == oma.MAX_RETRIES
    assert upstream["sleeps"][1] > upstream["sleeps"][0]  # backoff grows


def test_500_is_not_retried(upstream):
    upstream["queue"] = [httpx.Response(500)]
    assert run(oma.fetch("forecast", {"latitude": 18.5}, timeout=5)).status_code == 500
    assert len(upstream["requests"]) == 1


def test_connection_error_is_retried_once_then_raised(upstream):
    upstream["queue"] = [httpx.ConnectError("refused")]
    with pytest.raises(httpx.ConnectError):
        run(oma.fetch("forecast", {"latitude": 18.5}, timeout=5))
    assert len(upstream["requests"]) == 2


def test_timeout_is_not_retried(upstream):
    upstream["queue"] = [httpx.ReadTimeout("slow")]
    with pytest.raises(httpx.ReadTimeout):
        run(oma.fetch("forecast", {"latitude": 18.5}, timeout=5))
    assert len(upstream["requests"]) == 1


def test_identical_requests_in_flight_share_one_upstream_call(upstream):
    upstream["queue"] = [ok({"n": 1})]

    async def go():
        upstream["gate"] = asyncio.Event()
        same = [asyncio.create_task(oma.fetch("forecast", {"latitude": 18.5, "longitude": 73.9}, timeout=5)) for _ in range(5)]
        other = asyncio.create_task(oma.fetch("forecast", {"latitude": 19.0, "longitude": 72.8}, timeout=5))
        for _ in range(5):
            await asyncio.sleep(0)
        upstream["gate"].set()
        return await asyncio.gather(*same), await other

    same, other = run(go())
    assert len(upstream["requests"]) == 2  # 5 identical -> 1 call, plus the other place
    assert all(r.json() == {"n": 1} for r in same)
    assert other.status_code == 200
    assert oma._inflight == {}  # nothing left behind


def test_api_key_is_sent_but_not_part_of_the_sharing_key(upstream, monkeypatch):
    monkeypatch.setenv("OPEN_METEO_API_KEY", "secret-key")
    upstream["queue"] = [ok()]
    run(oma.fetch("forecast", {"latitude": 18.5}, timeout=5))
    req = upstream["requests"][0]
    assert req.url.host.startswith("customer-")
    assert req.url.params["apikey"] == "secret-key"
