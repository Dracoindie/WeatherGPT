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

import os
from typing import Any, Literal

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
