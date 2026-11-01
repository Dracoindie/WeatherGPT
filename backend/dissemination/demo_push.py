"""
Signed-in "Send test alert" for demos.

Sends one fixed test notification to the CALLER'S OWN push subscriptions, so a
demo can show a real notification on a calm day. It is deliberately separate
from the alert job:

- The caller is verified with Supabase Auth (``GET /auth/v1/user`` with their
  access token), which checks the JWT signature. The user id comes from that
  response, never from the request body.
- Subscriptions are read through PostgREST with the user's own JWT and the anon
  key, so RLS applies, and the query is also filtered by ``user_id=eq.<id>``.
  The service-role key is never used here.
- Nothing is written back: ``last_severity`` and ``last_notified_at`` are left
  alone, so the job's "becomes high" state is unaffected.
- At most one test per user per minute (in-memory, per backend process).
"""

from __future__ import annotations

import asyncio
import logging
import os
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Callable, Optional

import httpx

from dissemination.push import SendStatus
from dissemination.store import Subscription
from http_tls import SSL_CONTEXT

logger = logging.getLogger(__name__)

TEST_TITLE = "WeatherGPT test alert"
TEST_BODY = "TEST: WeatherGPT demo alert, not an official IMD warning"
RATE_LIMIT_SECONDS = 60.0
TIMEOUT = httpx.Timeout(10.0)


class AuthError(Exception):
    """Missing, malformed or rejected access token."""


class NotConfigured(Exception):
    """SUPABASE_URL / SUPABASE_ANON_KEY are not set on the backend."""


def demo_payload() -> dict:
    return {
        "title": TEST_TITLE,
        "body": TEST_BODY,
        "url": "/alerts",
        "tag": "wgpt-test",
        "severity": "test",
    }


class RateLimiter:
    """One event per key per ``window`` seconds."""

    def __init__(self, window: float = RATE_LIMIT_SECONDS, clock: Callable[[], float] = time.monotonic):
        self.window = window
        self.clock = clock
        self._last: dict[str, float] = {}
        self._lock = threading.Lock()

    def retry_after(self, key: str) -> float:
        """Seconds until ``key`` may act again (0 if it may act now)."""
        with self._lock:
            last = self._last.get(key)
            if last is None:
                return 0.0
            return max(0.0, self.window - (self.clock() - last))

    def hit(self, key: str) -> None:
        with self._lock:
            self._last[key] = self.clock()

    def clear(self) -> None:
        with self._lock:
            self._last.clear()


limiter = RateLimiter()


def _config() -> tuple[str, str]:
    url = (os.getenv("SUPABASE_URL") or "").rstrip("/")
    anon = os.getenv("SUPABASE_ANON_KEY") or ""
    if not url or not anon:
        raise NotConfigured("SUPABASE_URL and SUPABASE_ANON_KEY must be set on the backend.")
    return url, anon


def bearer(authorization: Optional[str]) -> str:
    if not authorization:
        raise AuthError("Sign in to send a test alert.")
    parts = authorization.strip().split(None, 1)
    if len(parts) != 2 or parts[0].lower() != "bearer" or not parts[1].strip():
        raise AuthError("Sign in to send a test alert.")
    return parts[1].strip()


async def verify_user(token: str) -> str:
    """User id for a valid Supabase access token; raises AuthError otherwise."""
    url, anon = _config()
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT, verify=SSL_CONTEXT) as client:
            resp = await client.get(
                f"{url}/auth/v1/user", headers={"apikey": anon, "Authorization": f"Bearer {token}"}
            )
    except httpx.RequestError as exc:
        logger.warning("Test push: auth check failed: %s", exc)
        raise RuntimeError("Sign-in could not be checked right now.") from exc
    if resp.status_code != 200:
        raise AuthError("Your session has expired. Sign in again.")
    try:
        return str(uuid.UUID(str(resp.json().get("id"))))
    except (ValueError, AttributeError, TypeError) as exc:
        raise AuthError("Your session could not be verified.") from exc


async def own_subscriptions(token: str, user_id: str) -> list[Subscription]:
    """The caller's rows only: their JWT (RLS) plus an explicit user_id filter."""
    url, anon = _config()
    params = {
        "select": "id,location_name,latitude,longitude,endpoint,p256dh,auth,language,last_severity,user_id",
        "user_id": f"eq.{user_id}",
    }
    async with httpx.AsyncClient(timeout=TIMEOUT, verify=SSL_CONTEXT) as client:
        resp = await client.get(
            f"{url}/rest/v1/alert_subscriptions",
            params=params,
            headers={"apikey": anon, "Authorization": f"Bearer {token}", "Accept": "application/json"},
        )
        resp.raise_for_status()
    subs = []
    for row in resp.json():
        # Defence in depth: never send to a row that is not the caller's.
        if str(row.pop("user_id", "")) != user_id:
            continue
        subs.append(Subscription(**row))
    return subs


@dataclass
class DemoPushResult:
    status: str  # sent | failed | no_subscription | disabled
    total: int = 0
    sent: int = 0
    failed: int = 0
    gone: int = 0
    disabled: int = 0
    message: str = ""
    details: list[dict] = field(default_factory=list)


async def send_test(subs: list[Subscription], send: Callable[[str, str, str, dict], SendStatus]) -> DemoPushResult:
    if not subs:
        return DemoPushResult(status="no_subscription", message="You have no push subscriptions. Tap Alert me first.")
    result = DemoPushResult(status="failed", total=len(subs))
    payload = demo_payload()
    for sub in subs:
        outcome = await asyncio.to_thread(send, sub.endpoint, sub.p256dh, sub.auth, payload)
        if outcome == "sent":
            result.sent += 1
        elif outcome == "gone":
            result.gone += 1
        elif outcome == "disabled":
            result.disabled += 1
        else:
            result.failed += 1
        result.details.append({"location": sub.location_name, "outcome": outcome})
    if result.sent:
        result.status = "sent"
        result.message = f"Test alert sent to {result.sent} of {result.total} subscription(s)."
    elif result.disabled == result.total:
        result.status = "disabled"
        result.message = "Push sending is not configured on the server."
    else:
        result.message = "The test alert could not be delivered. Try Alert me again on this device."
    return result
