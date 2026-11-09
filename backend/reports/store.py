"""
Where reports live.

Supabase (supabase/migration_8_reports.sql): tables ``community_reports`` and
``report_votes`` and the private Storage bucket ``report-photos``. RLS is on
with NO policies for browsers: only this backend reads and writes them, with
the service-role key (SUPABASE_SERVICE_ROLE_KEY, backend only). So:

- the reporter's user id never leaves the server (the API drops it);
- trust inputs (model agreement, reporter accuracy) cannot be forged by
  writing to the table directly;
- the rate limit and "one vote per person" are enforced here and by the
  table's primary key.

The vote counters are kept by a database trigger (and by ``MemoryStore`` the
same way, for tests).
"""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
from typing import Optional, Protocol

import httpx

from http_tls import SSL_CONTEXT
from reports.models import HIDE_AFTER_FLAGS, ReportRow

TIMEOUT = httpx.Timeout(10.0)
BUCKET = "report-photos"
LIST_LIMIT = 500
HISTORY_LIMIT = 50


class StoreError(RuntimeError):
    """The store did not answer as expected."""


class AlreadyVoted(Exception):
    pass


class ReportStore(Protocol):
    async def count_since(self, user_id: str, since: datetime) -> int: ...
    async def history(self, user_id: str) -> list[ReportRow]: ...
    async def insert(self, row: ReportRow) -> ReportRow: ...
    async def list_box(self, south: float, west: float, north: float, east: float, now: datetime) -> list[ReportRow]: ...
    async def get(self, report_id: str) -> Optional[ReportRow]: ...
    async def vote(self, report_id: str, user_id: str, vote: str) -> None: ...
    async def my_votes(self, user_id: str, report_ids: list[str]) -> dict[str, str]: ...
    async def put_photo(self, path: str, jpeg: bytes) -> None: ...
    async def get_photo(self, path: str) -> Optional[bytes]: ...
    async def delete_photo(self, path: str) -> None: ...


def new_id() -> str:
    return str(uuid.uuid4())


# ------------------------------------------------------------------ memory ---

class MemoryStore:
    """In-process store with the same behaviour (tests)."""

    def __init__(self) -> None:
        self.rows: dict[str, ReportRow] = {}
        self.photos: dict[str, bytes] = {}

    async def count_since(self, user_id: str, since: datetime) -> int:
        return sum(1 for r in self.rows.values() if r.user_id == user_id and r.created_at >= since)

    async def history(self, user_id: str) -> list[ReportRow]:
        own = [r for r in self.rows.values() if r.user_id == user_id]
        return sorted(own, key=lambda r: r.created_at, reverse=True)[:HISTORY_LIMIT]

    async def insert(self, row: ReportRow) -> ReportRow:
        self.rows[row.id] = row
        return row

    async def list_box(self, south: float, west: float, north: float, east: float, now: datetime) -> list[ReportRow]:
        out = [
            r
            for r in self.rows.values()
            if south <= r.latitude <= north and west <= r.longitude <= east and r.live(now)
        ]
        return sorted(out, key=lambda r: r.created_at, reverse=True)[:LIST_LIMIT]

    async def get(self, report_id: str) -> Optional[ReportRow]:
        return self.rows.get(report_id)

    async def vote(self, report_id: str, user_id: str, vote: str) -> None:
        r = self.rows[report_id]
        if user_id in r.votes:
            raise AlreadyVoted()
        r.votes[user_id] = vote
        if vote == "confirm":
            r.confirm_count += 1
        else:
            r.flag_count += 1

    async def my_votes(self, user_id: str, report_ids: list[str]) -> dict[str, str]:
        return {rid: self.rows[rid].votes[user_id] for rid in report_ids if rid in self.rows and user_id in self.rows[rid].votes}

    async def put_photo(self, path: str, jpeg: bytes) -> None:
        self.photos[path] = jpeg

    async def get_photo(self, path: str) -> Optional[bytes]:
        return self.photos.get(path)

    async def delete_photo(self, path: str) -> None:
        self.photos.pop(path, None)


# ---------------------------------------------------------------- supabase ---

def _ts(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)


def _row(d: dict) -> ReportRow:
    return ReportRow(
        id=str(d["id"]),
        user_id=str(d["user_id"]),
        kind=d["kind"],
        latitude=float(d["latitude"]),
        longitude=float(d["longitude"]),
        created_at=_ts(d["created_at"]),
        expires_at=_ts(d["expires_at"]),
        model_agreement=float(d["model_agreement"]),
        reporter_accuracy=float(d["reporter_accuracy"]),
        note=d.get("note"),
        photo_path=d.get("photo_path"),
        confirm_count=int(d.get("confirm_count") or 0),
        flag_count=int(d.get("flag_count") or 0),
        model_known=bool(d.get("model_known", True)),
    )


def _iso(ts: datetime) -> str:
    return ts.astimezone(timezone.utc).isoformat()


COLUMNS = (
    "id,user_id,kind,latitude,longitude,note,photo_path,created_at,expires_at,"
    "model_agreement,model_known,reporter_accuracy,confirm_count,flag_count"
)


class SupabaseStore:
    def __init__(self, url: str, service_key: str, transport: Optional[httpx.AsyncBaseTransport] = None):
        self.url = url.rstrip("/")
        self.headers = {"apikey": service_key, "Authorization": f"Bearer {service_key}"}
        self.transport = transport

    @classmethod
    def from_env(cls) -> Optional["SupabaseStore"]:
        url, key = os.getenv("SUPABASE_URL", ""), os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
        return cls(url, key) if url and key else None

    def _client(self) -> httpx.AsyncClient:
        if self.transport is not None:
            return httpx.AsyncClient(timeout=TIMEOUT, transport=self.transport)
        return httpx.AsyncClient(timeout=TIMEOUT, verify=SSL_CONTEXT)

    async def _get(self, table: str, params: dict) -> list[dict]:
        try:
            async with self._client() as c:
                resp = await c.get(f"{self.url}/rest/v1/{table}", params=params, headers=self.headers)
        except httpx.RequestError as exc:
            raise StoreError("Reports could not be read right now.") from exc
        if resp.status_code != 200:
            raise StoreError(f"Reports could not be read right now (HTTP {resp.status_code}).")
        return resp.json()

    async def count_since(self, user_id: str, since: datetime) -> int:
        rows = await self._get(
            "community_reports", {"select": "id", "user_id": f"eq.{user_id}", "created_at": f"gte.{_iso(since)}"}
        )
        return len(rows)

    async def history(self, user_id: str) -> list[ReportRow]:
        rows = await self._get(
            "community_reports",
            {"select": COLUMNS, "user_id": f"eq.{user_id}", "order": "created_at.desc", "limit": str(HISTORY_LIMIT)},
        )
        return [_row(d) for d in rows]

    async def insert(self, row: ReportRow) -> ReportRow:
        body = {
            "id": row.id,
            "user_id": row.user_id,
            "kind": row.kind,
            "latitude": row.latitude,
            "longitude": row.longitude,
            "note": row.note,
            "photo_path": row.photo_path,
            "created_at": _iso(row.created_at),
            "expires_at": _iso(row.expires_at),
            "model_agreement": row.model_agreement,
            "model_known": row.model_known,
            "reporter_accuracy": row.reporter_accuracy,
        }
        try:
            async with self._client() as c:
                resp = await c.post(
                    f"{self.url}/rest/v1/community_reports",
                    json=body,
                    headers={**self.headers, "Prefer": "return=representation"},
                )
        except httpx.RequestError as exc:
            raise StoreError("The report could not be saved right now.") from exc
        if resp.status_code not in (200, 201):
            raise StoreError(f"The report could not be saved right now (HTTP {resp.status_code}).")
        return _row(resp.json()[0])

    async def list_box(self, south: float, west: float, north: float, east: float, now: datetime) -> list[ReportRow]:
        box = f"(latitude.gte.{south},latitude.lte.{north},longitude.gte.{west},longitude.lte.{east})"
        rows = await self._get(
            "community_reports",
            {
                "select": COLUMNS,
                "and": box,
                "expires_at": f"gt.{_iso(now)}",
                "flag_count": f"lt.{HIDE_AFTER_FLAGS}",
                "order": "created_at.desc",
                "limit": str(LIST_LIMIT),
            },
        )
        return [_row(d) for d in rows]

    async def get(self, report_id: str) -> Optional[ReportRow]:
        rows = await self._get("community_reports", {"select": COLUMNS, "id": f"eq.{report_id}", "limit": "1"})
        return _row(rows[0]) if rows else None

    async def vote(self, report_id: str, user_id: str, vote: str) -> None:
        try:
            async with self._client() as c:
                resp = await c.post(
                    f"{self.url}/rest/v1/report_votes",
                    json={"report_id": report_id, "user_id": user_id, "vote": vote},
                    headers=self.headers,
                )
        except httpx.RequestError as exc:
            raise StoreError("Your vote could not be saved right now.") from exc
        if resp.status_code == 409:
            raise AlreadyVoted()
        if resp.status_code not in (200, 201, 204):
            raise StoreError(f"Your vote could not be saved right now (HTTP {resp.status_code}).")

    async def my_votes(self, user_id: str, report_ids: list[str]) -> dict[str, str]:
        if not report_ids:
            return {}
        rows = await self._get(
            "report_votes",
            {"select": "report_id,vote", "user_id": f"eq.{user_id}", "report_id": f"in.({','.join(report_ids)})"},
        )
        return {str(d["report_id"]): d["vote"] for d in rows}

    async def put_photo(self, path: str, jpeg: bytes) -> None:
        try:
            async with self._client() as c:
                resp = await c.post(
                    f"{self.url}/storage/v1/object/{BUCKET}/{path}",
                    content=jpeg,
                    headers={**self.headers, "Content-Type": "image/jpeg", "x-upsert": "false"},
                )
        except httpx.RequestError as exc:
            raise StoreError("The photo could not be saved right now.") from exc
        if resp.status_code not in (200, 201):
            raise StoreError(f"The photo could not be saved right now (HTTP {resp.status_code}).")

    async def get_photo(self, path: str) -> Optional[bytes]:
        try:
            async with self._client() as c:
                resp = await c.get(f"{self.url}/storage/v1/object/{BUCKET}/{path}", headers=self.headers)
        except httpx.RequestError as exc:
            raise StoreError("The photo could not be read right now.") from exc
        if resp.status_code in (400, 404):
            return None
        if resp.status_code != 200:
            raise StoreError(f"The photo could not be read right now (HTTP {resp.status_code}).")
        return resp.content

    async def delete_photo(self, path: str) -> None:
        try:
            async with self._client() as c:
                await c.delete(f"{self.url}/storage/v1/object/{BUCKET}/{path}", headers=self.headers)
        except httpx.RequestError:
            pass
