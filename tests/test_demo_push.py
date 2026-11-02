"""
POST /api/push/test: signed-in demo notification.

Covers auth, the 1-per-minute rate limit, sending only to the caller's own
subscriptions, and that nothing is written back (last_severity unchanged).
All Supabase and push traffic is mocked.
"""

from __future__ import annotations

from unittest.mock import patch

import httpx
import pytest
from fastapi.testclient import TestClient

from dissemination import demo_push
from dissemination.job import run_job
from dissemination.store import Subscription
from main import app
from test_dissemination import FakeSender as JobSender
from test_dissemination import FakeStore, alert
from test_roles import make_weather

client = TestClient(app)

USER_A = "8f14e45f-ceea-4e7a-9b1c-2f6d3c1a0b9e"
USER_B = "11111111-2222-4333-8444-555555555555"
TOKENS = {"token-a": USER_A, "token-b": USER_B}


def row(sub_id, user, endpoint, severity="none"):
    return {
        "id": sub_id,
        "user_id": user,
        "location_name": f"Place {sub_id}",
        "latitude": 18.5,
        "longitude": 73.8,
        "endpoint": endpoint,
        "p256dh": "p",
        "auth": "a",
        "language": "en",
        "last_severity": severity,
    }


class FakeSupabase:
    """Auth + PostgREST. ``leak`` simulates a broken RLS policy returning every row."""

    def __init__(self, rows, leak=False):
        self.rows, self.leak = rows, leak
        self.requests: list[httpx.Request] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        token = request.headers.get("authorization", "").removeprefix("Bearer ")
        if request.url.path == "/auth/v1/user":
            if token in TOKENS:
                return httpx.Response(200, json={"id": TOKENS[token], "aud": "authenticated"})
            return httpx.Response(401, json={"msg": "invalid JWT"})
        if request.url.path == "/rest/v1/alert_subscriptions":
            assert request.method == "GET", "the test push must never write subscriptions"
            uid = TOKENS.get(token)
            if self.leak:
                return httpx.Response(200, json=self.rows)
            return httpx.Response(200, json=[r for r in self.rows if r["user_id"] == uid])
        return httpx.Response(404)


class FakeSender:
    def __init__(self, status="sent"):
        self.status, self.calls = status, []

    def send(self, endpoint, p256dh, auth, payload):
        self.calls.append((endpoint, payload))
        return self.status


@pytest.fixture
def env(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://proj.supabase.co")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon-key")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role-secret")
    demo_push.limiter.clear()
    yield
    demo_push.limiter.clear()


@pytest.fixture
def wire(monkeypatch, env):
    def install(rows, leak=False, status="sent"):
        supa, sender = FakeSupabase(rows, leak), FakeSender(status)
        real = httpx.AsyncClient

        def factory(*args, **kwargs):
            kwargs.pop("verify", None)
            return real(*args, transport=httpx.MockTransport(supa.handler), **kwargs)

        monkeypatch.setattr(demo_push.httpx, "AsyncClient", factory)
        monkeypatch.setattr("api.dissemination.WebPushSender", lambda cfg: sender)
        return supa, sender

    return install


def post(token=None):
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    return client.post("/api/push/test", headers=headers)


# --- auth -----------------------------------------------------------------


def test_requires_a_token(wire):
    supa, sender = wire([row("s1", USER_A, "https://push/a")])
    assert post().status_code == 401
    assert client.post("/api/push/test", headers={"Authorization": "Basic abc"}).status_code == 401
    assert sender.calls == [] and supa.requests == []


def test_rejected_token_is_401_and_sends_nothing(wire):
    _, sender = wire([row("s1", USER_A, "https://push/a")])
    assert post("forged-token").status_code == 401
    assert sender.calls == []


def test_503_when_supabase_not_configured(monkeypatch):
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    assert post("token-a").status_code == 503


def test_uses_user_jwt_and_anon_key_never_the_service_role(wire):
    supa, _ = wire([row("s1", USER_A, "https://push/a")])
    assert post("token-a").status_code == 200
    for req in supa.requests:
        assert req.headers["authorization"] == "Bearer token-a"
        assert req.headers["apikey"] == "anon-key"
        assert "service-role-secret" not in str(req.headers)


# --- own subscriptions only ------------------------------------------------


def test_sends_test_text_only_to_own_subscriptions(wire):
    rows = [
        row("s1", USER_A, "https://push/a1"),
        row("s2", USER_A, "https://push/a2"),
        row("s3", USER_B, "https://push/b"),
    ]
    supa, sender = wire(rows)
    body = post("token-a").json()
    assert body["status"] == "sent" and body["sent"] == 2 and body["total"] == 2
    assert sorted(e for e, _ in sender.calls) == ["https://push/a1", "https://push/a2"]
    payload = sender.calls[0][1]
    assert payload["body"] == "TEST: WeatherGPT demo alert, not an official IMD warning"
    assert payload["severity"] == "test"
    list_req = [r for r in supa.requests if r.url.path.startswith("/rest/")][0]
    assert list_req.url.params["user_id"] == f"eq.{USER_A}"


def test_other_users_rows_are_dropped_even_if_rls_leaks(wire):
    rows = [row("s1", USER_A, "https://push/a"), row("s3", USER_B, "https://push/b")]
    _, sender = wire(rows, leak=True)
    assert post("token-a").json()["sent"] == 1
    assert [e for e, _ in sender.calls] == ["https://push/a"]


def test_no_subscription(wire):
    _, sender = wire([row("s3", USER_B, "https://push/b")])
    body = post("token-a").json()
    assert body["status"] == "no_subscription" and sender.calls == []
    # an empty attempt does not use up the minute
    assert post("token-a").status_code == 200


def test_failed_delivery_is_reported(wire):
    wire([row("s1", USER_A, "https://push/a")], status="failed")
    body = post("token-a").json()
    assert body["status"] == "failed" and body["failed"] == 1


def test_disabled_sender_is_reported(wire):
    wire([row("s1", USER_A, "https://push/a")], status="disabled")
    assert post("token-a").json()["status"] == "disabled"


# --- rate limit ------------------------------------------------------------


def test_one_test_per_minute_per_user(wire):
    rows = [row("s1", USER_A, "https://push/a"), row("s3", USER_B, "https://push/b")]
    _, sender = wire(rows)
    assert post("token-a").status_code == 200
    second = post("token-a")
    assert second.status_code == 429
    assert second.json()["status"] == "rate_limited"
    assert 1 <= int(second.headers["Retry-After"]) <= 60
    # another user is not blocked
    assert post("token-b").status_code == 200
    assert len(sender.calls) == 2


def test_retry_after_never_exceeds_the_window(wire, monkeypatch):
    """Two requests in the same clock tick (Windows: ~15 ms) wait exactly 60 s, not 61."""
    _, _ = wire([row("s1", USER_A, "https://push/a")])
    monkeypatch.setattr(demo_push.limiter, "clock", lambda: 5000.0)
    assert post("token-a").status_code == 200
    second = post("token-a")
    assert second.status_code == 429
    assert second.headers["Retry-After"] == "60"
    assert second.json()["retry_after"] == 60


def test_rate_limiter_window():
    now = [1000.0]
    lim = demo_push.RateLimiter(window=60, clock=lambda: now[0])
    assert lim.retry_after("u") == 0
    lim.hit("u")
    now[0] += 59
    assert lim.retry_after("u") == pytest.approx(1)
    now[0] += 1
    assert lim.retry_after("u") == 0


# --- does not touch the real job's state ----------------------------------


def test_stored_level_is_unchanged(wire):
    rows = [row("s1", USER_A, "https://push/a", severity="watch")]
    supa, _ = wire(rows)
    assert post("token-a").json()["status"] == "sent"
    assert all(r.method == "GET" for r in supa.requests)
    assert rows[0]["last_severity"] == "watch"


async def _weather(w):
    return w


@pytest.mark.asyncio
async def test_job_still_notifies_after_a_test_push(wire):
    """A test push must not make the job think the user was already warned."""
    rows = [row("s1", USER_A, "https://push/a")]
    wire(rows)
    assert post("token-a").json()["status"] == "sent"

    fields = {k: v for k, v in rows[0].items() if k != "user_id"}
    store, sender = FakeStore([Subscription(**fields)]), JobSender()
    with patch("dissemination.job.evaluate_alerts", return_value=[alert("warning")]):
        report = await run_job(store, sender, lambda lat, lon: _weather(make_weather()))
    assert report.became_high == 1 and report.sent == 1
