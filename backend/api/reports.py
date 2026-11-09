"""
Community reports (docs/REPORTS.md).

GET  /api/reports?south&west&north&east  live reports in a box, with trust
POST /api/reports                        a signed-in report (multipart: kind,
                                         latitude, longitude, note?, photo?)
POST /api/reports/{id}/vote              {"vote": "confirm" | "flag"}, signed in
GET  /api/reports/{id}/photo             the report's photo (JPEG, no metadata)

Every report is "community report, unverified". Reports never change a
forecast number or an alert level. The reporter's identity is never returned.
Errors carry a ``code`` the UI words in the user's language.
"""

from __future__ import annotations

import logging
import math
import re
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, File, Form, Header, Query, UploadFile
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from dissemination import demo_push
from reports import photo as photos
from reports import trust as trust_mod
from reports.models import (
    KINDS,
    LIFETIME,
    NOTE_MAX,
    PublicReport,
    ReportList,
    ReportRow,
    Vote,
    approx,
    iso,
)
from reports.store import AlreadyVoted, ReportStore, StoreError, SupabaseStore, new_id

logger = logging.getLogger(__name__)

router = APIRouter(tags=["community reports"])

MIN_INTERVAL_S = 60.0  # one report a minute per person
MAX_PER_HOUR = 5
MAX_BOX_DEG = 15.0

# Tests install a MemoryStore here; production reads Supabase from the environment.
store_override: Optional[ReportStore] = None
limiter = demo_push.RateLimiter(window=MIN_INTERVAL_S)
# Tests pin the clock.
clock = lambda: datetime.now(timezone.utc)  # noqa: E731


def _store() -> Optional[ReportStore]:
    return store_override if store_override is not None else SupabaseStore.from_env()


def _error(status: int, code: str, message: str, headers: Optional[dict] = None) -> JSONResponse:
    return JSONResponse(status_code=status, content={"code": code, "detail": message}, headers=headers)


NOT_CONFIGURED = (503, "not_configured", "Community reports are not set up on this server.")


async def _user(authorization: Optional[str]) -> str:
    """The verified Supabase user id; raises demo_push.AuthError / NotConfigured / RuntimeError."""
    if not authorization:
        raise demo_push.AuthError("Sign in to report.")
    parts = authorization.strip().split(None, 1)
    if len(parts) != 2 or parts[0].lower() != "bearer" or not parts[1].strip():
        raise demo_push.AuthError("Sign in to report.")
    return await demo_push.verify_user(parts[1].strip())


async def _optional_user(authorization: Optional[str]) -> Optional[str]:
    if not authorization:
        return None
    try:
        return await _user(authorization)
    except Exception:  # a bad or expired token only loses "my vote"
        return None


def _public(row: ReportRow, others: list[ReportRow], now: datetime, me: Optional[str], my_vote: Optional[str]) -> PublicReport:
    return PublicReport(
        id=row.id,
        kind=row.kind,  # type: ignore[arg-type]
        latitude=round(row.latitude, 5),
        longitude=round(row.longitude, 5),
        note=row.note,
        has_photo=bool(row.photo_path),
        reported_at=iso(approx(row.created_at)),
        expires_at=iso(row.expires_at),
        confirms=row.confirm_count,
        flags=row.flag_count,
        trust=trust_mod.trust(row, others, now),
        my_vote=my_vote,  # type: ignore[arg-type]
        mine=me is not None and row.user_id == me,
    )


_CONTROL = re.compile(r"[\x00-\x1f\x7f]+")


def clean_note(note: Optional[str]) -> Optional[str]:
    if note is None:
        return None
    text = _CONTROL.sub(" ", note).strip()
    text = re.sub(r"\s+", " ", text)
    return text[:NOTE_MAX] or None


@router.get("/api/reports", response_model=ReportList)
async def list_reports(
    south: float = Query(..., ge=-90, le=90),
    west: float = Query(..., ge=-180, le=180),
    north: float = Query(..., ge=-90, le=90),
    east: float = Query(..., ge=-180, le=180),
    authorization: Optional[str] = Header(default=None),
):
    if north <= south or east <= west:
        return _error(422, "bad_box", "The box is empty.")
    if north - south > MAX_BOX_DEG or east - west > MAX_BOX_DEG:
        return _error(422, "box_too_large", "Zoom in to see community reports.")
    store = _store()
    if store is None:
        return _error(*NOT_CONFIGURED)
    now = clock()
    try:
        rows = await store.list_box(south, west, north, east, now)
        me = await _optional_user(authorization)
        votes = await store.my_votes(me, [r.id for r in rows]) if me else {}
    except StoreError as exc:
        return _error(503, "unavailable", str(exc))
    rows = [r for r in rows if r.live(now)]
    return ReportList(reports=[_public(r, rows, now, me, votes.get(r.id)) for r in rows])


@router.post("/api/reports", response_model=PublicReport, status_code=201)
async def create_report(
    kind: str = Form(...),
    latitude: float = Form(..., ge=-90, le=90),
    longitude: float = Form(..., ge=-180, le=180),
    note: Optional[str] = Form(default=None),
    photo: Optional[UploadFile] = File(default=None),
    authorization: Optional[str] = Header(default=None),
):
    if kind not in KINDS:
        return _error(422, "bad_kind", "Unknown report type.")
    store = _store()
    if store is None:
        return _error(*NOT_CONFIGURED)
    try:
        user = await _user(authorization)
    except demo_push.AuthError as exc:
        return _error(401, "sign_in", str(exc))
    except (demo_push.NotConfigured, RuntimeError):
        return _error(*NOT_CONFIGURED)

    now = clock()
    # one a minute (this process), at most MAX_PER_HOUR an hour (the table)
    wait = limiter.retry_after(user)
    try:
        if wait <= 0 and await store.count_since(user, now - timedelta(hours=1)) >= MAX_PER_HOUR:
            wait = 15 * 60.0
    except StoreError as exc:
        return _error(503, "unavailable", str(exc))
    if wait > 0:
        seconds = max(1, math.ceil(wait))
        return _error(429, "rate_limited", f"Too many reports. Try again in {seconds} s.", {"Retry-After": str(seconds)})

    jpeg: Optional[bytes] = None
    if photo is not None and (photo.filename or photo.size):
        data = await photo.read(photos.MAX_BYTES + 1)
        try:
            jpeg = photos.clean_photo(data)
        except photos.PhotoError as exc:
            return _error(413 if exc.code == "too_large" else 422, f"photo_{exc.code}", str(exc))

    agreement, known = await trust_mod.model_agreement(kind, latitude, longitude, now)
    report_id = new_id()
    try:
        history = await store.history(user)
        row = ReportRow(
            id=report_id,
            user_id=user,
            kind=kind,
            latitude=latitude,
            longitude=longitude,
            created_at=now,
            expires_at=now + LIFETIME[kind],
            model_agreement=agreement,
            model_known=known,
            reporter_accuracy=trust_mod.reporter_accuracy(history),
            note=clean_note(note),
            photo_path=f"{report_id}.jpg" if jpeg else None,
        )
        if jpeg:
            await store.put_photo(row.photo_path, jpeg)  # type: ignore[arg-type]
        try:
            saved = await store.insert(row)
        except StoreError:
            if jpeg:
                await store.delete_photo(row.photo_path)  # type: ignore[arg-type]
            raise
    except StoreError as exc:
        return _error(503, "unavailable", str(exc))
    limiter.hit(user)
    return _public(saved, [saved], now, user, None)


class VoteBody(BaseModel):
    vote: Vote


@router.post("/api/reports/{report_id}/vote", response_model=PublicReport)
async def vote_report(report_id: str, body: VoteBody, authorization: Optional[str] = Header(default=None)):
    store = _store()
    if store is None:
        return _error(*NOT_CONFIGURED)
    try:
        user = await _user(authorization)
    except demo_push.AuthError as exc:
        return _error(401, "sign_in", str(exc))
    except (demo_push.NotConfigured, RuntimeError):
        return _error(*NOT_CONFIGURED)
    now = clock()
    try:
        row = await store.get(report_id)
        if row is None or not row.live(now):
            return _error(404, "gone", "This report has expired or was hidden.")
        if row.user_id == user:
            return _error(403, "own_report", "You cannot confirm or flag your own report.")
        try:
            await store.vote(report_id, user, body.vote)
        except AlreadyVoted:
            return _error(409, "already_voted", "You have already confirmed or flagged this report.")
        row = await store.get(report_id)
    except StoreError as exc:
        return _error(503, "unavailable", str(exc))
    if row is None:
        return _error(404, "gone", "This report has expired or was hidden.")
    return _public(row, [row], now, user, body.vote)


@router.get("/api/reports/{report_id}/photo")
async def report_photo(report_id: str):
    store = _store()
    if store is None:
        return _error(*NOT_CONFIGURED)
    try:
        row = await store.get(report_id)
        if row is None or not row.live(clock()) or not row.photo_path:
            return _error(404, "gone", "No photo.")
        jpeg = await store.get_photo(row.photo_path)
    except StoreError as exc:
        return _error(503, "unavailable", str(exc))
    if jpeg is None:
        return _error(404, "gone", "No photo.")
    return Response(content=jpeg, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=600"})
