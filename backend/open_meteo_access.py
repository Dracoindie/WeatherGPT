"""
Which Open-Meteo endpoint to call: free or commercial.

Without OPEN_METEO_API_KEY every client uses the free public endpoints. These
are for **non-commercial use only** and limited to 10,000 calls a day, 5,000
an hour and 600 a minute; a request for N locations counts as N calls (and
more for long time ranges or many variables). See docs/OPEN_METEO.md.

With OPEN_METEO_API_KEY set, requests go to the ``customer-`` hosts with
``apikey=…``. The key is a secret: it lives only in backend/.env (git-ignored)
or the host's environment, never in logs or the frontend.
"""

from __future__ import annotations

import asyncio
import email.utils
import logging
import os
import random
import time
from typing import Any, Literal

import httpx

from http_tls import SSL_CONTEXT

Service = Literal["forecast", "air-quality", "archive"]

_FREE = {
    "forecast": "https://api.open-meteo.com/v1/forecast",
    "air-quality": "https://air-quality-api.open-meteo.com/v1/air-quality",
    "archive": "https://archive-api.open-meteo.com/v1/archive",
}
_CUSTOMER = {
    "forecast": "https://customer-api.open-meteo.com/v1/forecast",
    "air-quality": "https://customer-air-quality-api.open-meteo.com/v1/air-quality",
    "archive": "https://customer-archive-api.open-meteo.com/v1/archive",
}


def api_key() -> str | None:
    key = os.getenv("OPEN_METEO_API_KEY", "").strip()
    return key or None


def url(service: Service) -> str:
    return (_CUSTOMER if api_key() else _FREE)[service]


def params(base: dict[str, Any]) -> dict[str, Any]:
    """The request parameters, plus apikey when a key is configured."""
    key = api_key()
    return {**base, "apikey": key} if key else dict(base)


def plan() -> str:
    """For logs and /health: which plan is in use (never the key itself)."""
    return "commercial" if api_key() else "free (non-commercial)"


# ---------------------------------------------------------------------------
# One way to call Open-Meteo: retry with backoff, and one call per identical
# request in flight. The free tier allows 600 calls a minute (a request for N
# points counts N), so a busy map can hit HTTP 429; docs/OPEN_METEO.md.
# ---------------------------------------------------------------------------

logger = logging.getLogger(__name__)

# Worth retrying: rate limited, or the service is briefly unavailable. A 500
# usually means a bad request and is not retried.
RETRY_STATUSES = frozenset({429, 502, 503, 504})
MAX_RETRIES = 2
BACKOFF_S = 0.5  # then 1.5 s, with +-25 % jitter
# Honour Retry-After up to this; a longer wait ("try again in one minute")
# fails fast so the caller can serve its cache or a stale result instead of
# holding the user's request open.
MAX_RETRY_AFTER_S = 5.0

_inflight: dict[tuple, "asyncio.Future[httpx.Response]"] = {}


def retry_after_s(resp: httpx.Response) -> float | None:
    """Seconds from a Retry-After header (seconds or an HTTP date), if any."""
    headers = getattr(resp, "headers", None)
    raw = headers.get("retry-after") if headers is not None else None
    if not isinstance(raw, str) or not raw.strip():
        return None
    raw = raw.strip()
    try:
        return max(0.0, float(raw))
    except ValueError:
        pass
    try:
        when = email.utils.parsedate_to_datetime(raw)
    except (TypeError, ValueError):
        return None
    return max(0.0, when.timestamp() - time.time()) if when else None


async def _sleep(seconds: float) -> None:
    """The wait between retries (tests replace it)."""
    await asyncio.sleep(seconds)


def _backoff(attempt: int) -> float:
    return BACKOFF_S * (3**attempt) * random.uniform(0.75, 1.25)


async def _get_with_retry(target: str, query: dict[str, Any], timeout: Any) -> httpx.Response:
    async with httpx.AsyncClient(timeout=timeout, verify=SSL_CONTEXT) as client:
        for attempt in range(MAX_RETRIES + 1):
            try:
                resp = await client.get(target, params=query)
            except (httpx.ConnectError, httpx.RemoteProtocolError):
                # a dropped connection is worth one more try; a timeout already
                # cost the whole timeout and is not retried
                if attempt >= 1:
                    raise
                await _sleep(_backoff(attempt))
                continue
            if resp.status_code not in RETRY_STATUSES or attempt == MAX_RETRIES:
                return resp
            wait = retry_after_s(resp)
            if wait is not None and wait > MAX_RETRY_AFTER_S:
                logger.warning("Open-Meteo HTTP %d, Retry-After %.0f s: not waiting", resp.status_code, wait)
                return resp
            delay = wait if wait is not None else _backoff(attempt)
            logger.warning("Open-Meteo HTTP %d, retry %d in %.1f s", resp.status_code, attempt + 1, delay)
            await _sleep(delay)
    raise AssertionError("unreachable")  # pragma: no cover


async def fetch(service: Service, base: dict[str, Any], *, timeout: Any) -> httpx.Response:
    """GET an Open-Meteo service with retry, sharing one call among identical
    requests already in flight. Raises httpx errors like client.get."""
    target = url(service)
    key = (target, tuple(sorted((k, str(v)) for k, v in base.items())))
    running = _inflight.get(key)
    if running is not None:
        return await asyncio.shield(running)
    fut: asyncio.Future[httpx.Response] = asyncio.get_running_loop().create_future()
    # an error nobody else awaited must not be reported as "never retrieved"
    fut.add_done_callback(lambda f: f.cancelled() or f.exception())
    _inflight[key] = fut
    try:
        resp = await _get_with_retry(target, params(base), timeout)
    except BaseException as exc:
        if isinstance(exc, asyncio.CancelledError):
            fut.cancel()
        else:
            fut.set_exception(exc)
        raise
    else:
        fut.set_result(resp)
        return resp
    finally:
        _inflight.pop(key, None)
