"""
Alert subscriptions in Supabase (table public.alert_subscriptions, see
supabase/schema.sql migration 7).

Browsers write their own rows through RLS. This server-side job reads all
rows with the service-role key (SUPABASE_SERVICE_ROLE_KEY), which bypasses
RLS, so that key must only ever live on the backend.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional

import httpx

from http_tls import SSL_CONTEXT

TIMEOUT = httpx.Timeout(10.0)


@dataclass
class Subscription:
    id: str
    location_name: str
    latitude: float
    longitude: float
    endpoint: str
    p256dh: str
    auth: str
    language: str = "en"
    last_severity: str = "none"


class SupabaseSubscriptionStore:
    def __init__(self, url: str, service_key: str):
        self.base = url.rstrip("/") + "/rest/v1/alert_subscriptions"
        self.headers = {"apikey": service_key, "Authorization": f"Bearer {service_key}"}

    @classmethod
    def from_env(cls) -> Optional["SupabaseSubscriptionStore"]:
        url, key = os.getenv("SUPABASE_URL", ""), os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
        return cls(url, key) if url and key else None

    async def list(self) -> list[Subscription]:
        fields = "id,location_name,latitude,longitude,endpoint,p256dh,auth,language,last_severity"
        async with httpx.AsyncClient(timeout=TIMEOUT, verify=SSL_CONTEXT) as client:
            resp = await client.get(self.base, params={"select": fields}, headers=self.headers)
            resp.raise_for_status()
        return [Subscription(**row) for row in resp.json()]

    async def update(self, sub_id: str, fields: dict) -> None:
        async with httpx.AsyncClient(timeout=TIMEOUT, verify=SSL_CONTEXT) as client:
            resp = await client.patch(
                self.base, params={"id": f"eq.{sub_id}"}, json=fields, headers=self.headers
            )
            resp.raise_for_status()

    async def delete(self, sub_id: str) -> None:
        async with httpx.AsyncClient(timeout=TIMEOUT, verify=SSL_CONTEXT) as client:
            resp = await client.delete(self.base, params={"id": f"eq.{sub_id}"}, headers=self.headers)
            resp.raise_for_status()
