"""
Early-warning dissemination endpoints.

GET  /api/alerts/cap    – current alerts for a point as CAP 1.2 XML
GET  /api/push/config   – whether Web Push is configured, and the VAPID public key
POST /api/alerts/check  – run the subscription job (needs X-Job-Token = ALERT_JOB_TOKEN)
"""

from __future__ import annotations

import hmac
import logging
import os
from dataclasses import asdict
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Query
from fastapi.responses import Response

from alerts.engine import evaluate_alerts
from dissemination.cap import build_cap
from dissemination.push import VapidConfig, pywebpush_installed
from query_service import fetch_validated_weather

logger = logging.getLogger(__name__)

router = APIRouter(tags=["early warning"])


@router.get(
    "/api/alerts/cap",
    response_class=Response,
    responses={200: {"content": {"application/cap+xml": {}}}, 503: {"description": "Weather service down"}},
)
async def alerts_cap(
    latitude: float = Query(..., ge=-90.0, le=90.0),
    longitude: float = Query(..., ge=-180.0, le=180.0),
    name: Optional[str] = Query(None, max_length=120, description="Area name for <areaDesc>"),
) -> Response:
    try:
        weather = await fetch_validated_weather(latitude, longitude)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail="Alerts are temporarily unavailable.") from exc
    area = name or f"{latitude:.4f}, {longitude:.4f}"
    xml = build_cap(evaluate_alerts(weather), latitude, longitude, area)
    return Response(
        content=xml,
        media_type="application/cap+xml",
        headers={"Content-Disposition": 'attachment; filename="weathergpt-alerts.cap.xml"'},
    )


@router.get("/api/push/config")
async def push_config() -> dict:
    vapid = VapidConfig.from_env()
    installed = pywebpush_installed()
    reason = None
    if vapid is None:
        reason = "VAPID keys are not configured on the server."
    elif not installed:
        reason = "The server's Web Push sender (pywebpush) is not installed yet."
    return {
        "available": vapid is not None and installed,
        # The public key is safe to share; subscriptions need it even before sending works.
        "vapid_public_key": vapid.public_key if vapid else None,
        "reason": reason,
    }


@router.post("/api/alerts/check")
async def run_alert_check(x_job_token: Optional[str] = Header(default=None)) -> dict:
    expected = os.getenv("ALERT_JOB_TOKEN", "")
    if not expected:
        raise HTTPException(status_code=503, detail="Alert job is not configured (ALERT_JOB_TOKEN).")
    if not x_job_token or not hmac.compare_digest(x_job_token, expected):
        raise HTTPException(status_code=401, detail="Invalid job token.")
    from dissemination.job import run_from_env

    try:
        report = await run_from_env()
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return asdict(report)
