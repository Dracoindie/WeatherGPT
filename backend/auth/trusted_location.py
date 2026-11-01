"""
Trusted default location from a verified Supabase session.

SECURITY
--------
- Client-supplied ``user_id`` is never consulted.
- Client-supplied ``default_latitude`` / ``default_longitude`` are never used.
- Lookup happens only when the caller sends ``Authorization: Bearer <access_token>``
  and ``SUPABASE_URL`` + ``SUPABASE_ANON_KEY`` are configured.
- The request is made to PostgREST with the user's own JWT so RLS still applies.
  Another user's profile cannot be read this way.
- Defense in depth: the query is also filtered by ``id=eq.<sub>``, with ``sub``
  read from the JWT payload. The signature is not checked here (Supabase
  checks it and RLS enforces access); ``sub`` only narrows the filter.

If those env vars are missing, authenticated-default support is disabled
(anonymous queries with an explicit location still work).
"""

from __future__ import annotations

import base64
import binascii
import json
import logging
import os
import uuid
from typing import Optional

import httpx
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

TIMEOUT = httpx.Timeout(connect=5.0, read=10.0, write=5.0, pool=5.0)


class TrustedDefaultLocation(BaseModel):
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    name: Optional[str] = None


def _bearer_token(authorization: Optional[str]) -> Optional[str]:
    if not authorization:
        return None
    parts = authorization.strip().split(None, 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    token = parts[1].strip()
    return token or None


def _jwt_subject(token: str) -> Optional[str]:
    """``sub`` claim from an unverified JWT payload, if it is a UUID."""
    parts = token.split(".")
    if len(parts) != 3:
        return None
    payload = parts[1] + "=" * (-len(parts[1]) % 4)
    try:
        claims = json.loads(base64.urlsafe_b64decode(payload))
    except (binascii.Error, ValueError):
        return None
    sub = claims.get("sub") if isinstance(claims, dict) else None
    if not isinstance(sub, str):
        return None
    # Supabase user ids are UUIDs; anything else must not reach the filter.
    try:
        return str(uuid.UUID(sub))
    except ValueError:
        return None


async def get_trusted_default_location(
    authorization: Optional[str],
) -> Optional[TrustedDefaultLocation]:
    """
    Return the caller's profile default location, or None.

    Isolated on purpose: this is the only path that may use a saved default.
    """
    token = _bearer_token(authorization)
    if token is None:
        return None

    subject = _jwt_subject(token)
    if subject is None:
        logger.info("Trusted default location skipped: token has no usable sub claim")
        return None

    supabase_url = (os.getenv("SUPABASE_URL") or "").rstrip("/")
    anon_key = os.getenv("SUPABASE_ANON_KEY") or ""
    if not supabase_url or not anon_key:
        logger.info(
            "Trusted default location disabled: SUPABASE_URL / SUPABASE_ANON_KEY not set"
        )
        return None

    url = f"{supabase_url}/rest/v1/profiles"
    params = {
        "select": "default_latitude,default_longitude,default_location_name",
        "id": f"eq.{subject}",
        "limit": "1",
    }
    headers = {
        "Authorization": f"Bearer {token}",
        "apikey": anon_key,
        "Accept": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            response = await client.get(url, params=params, headers=headers)
    except httpx.RequestError as exc:
        logger.error("Trusted location lookup failed: %s", exc)
        return None

    if response.status_code != 200:
        logger.info("Trusted location lookup HTTP %s", response.status_code)
        return None

    try:
        rows = response.json()
    except Exception:
        logger.error("Trusted location lookup returned non-JSON")
        return None

    if not isinstance(rows, list) or not rows:
        return None

    row = rows[0]
    lat = row.get("default_latitude")
    lon = row.get("default_longitude")
    if lat is None or lon is None:
        return None

    try:
        return TrustedDefaultLocation(
            latitude=float(lat),
            longitude=float(lon),
            name=row.get("default_location_name"),
        )
    except (TypeError, ValueError):
        return None
