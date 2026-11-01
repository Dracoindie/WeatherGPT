"""
Early-warning dissemination: CAP 1.2 export, the subscription job's
"became high" rule, job endpoint auth, push config.
"""

from __future__ import annotations

import os
import sys
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from dissemination.cap import CAP_NS, DISCLAIMER, build_cap
from dissemination.job import level, payload_for, run_job
from dissemination.store import Subscription
from main import app
from models.alerts import WeatherAlert
from test_roles import make_weather

client = TestClient(app)
NS = {"cap": CAP_NS}
NOW = datetime(2026, 11, 1, 10, 0, tzinfo=timezone.utc)


def alert(severity="warning", condition="Extreme Rain / Flood Risk", headline="Warning: 72.4 mm <rain> & floods"):
    return WeatherAlert(
        id="a1",
        alert_type="rain",
        severity=severity,
        condition=condition,
        headline=headline,
        description="Heavy rain.",
        recommended_action="Avoid low-lying areas.",
        relevant_parameter="precipitation",
        relevant_value=72.4,
        threshold_value=64.5,
        unit="mm",
        time_window="Next 24 hours",
        created_at=NOW,
    )


# ---------------------------------------------------------------------------
# CAP
# ---------------------------------------------------------------------------


def test_cap_document_has_required_elements_and_disclaimer():
    xml = build_cap([alert(), alert("watch", "Strong wind")], 16.99, 73.31, "Ratnagiri", now=NOW)
    root = ET.fromstring(xml)
    assert root.tag == f"{{{CAP_NS}}}alert"
    for tag in ("identifier", "sender", "sent", "status", "msgType", "scope"):
        assert root.find(f"cap:{tag}", NS) is not None, tag
    assert root.findtext("cap:sent", namespaces=NS) == "2026-11-01T10:00:00+00:00"
    assert DISCLAIMER in root.findtext("cap:note", namespaces=NS)
    infos = root.findall("cap:info", NS)
    assert [i.findtext("cap:severity", namespaces=NS) for i in infos] == ["Severe", "Moderate"]
    first = infos[0]
    assert first.findtext("cap:category", namespaces=NS) == "Met"
    assert first.findtext("cap:certainty", namespaces=NS) == "Likely"
    assert "not IMD" in first.findtext("cap:senderName", namespaces=NS)
    assert DISCLAIMER in first.findtext("cap:description", namespaces=NS)
    assert first.findtext("cap:expires", namespaces=NS) == "2026-11-01T22:00:00+00:00"
    assert first.findtext("cap:area/cap:circle", namespaces=NS) == "16.9900,73.3100 10"
    assert first.findtext("cap:area/cap:areaDesc", namespaces=NS) == "Ratnagiri"


def test_cap_escapes_text():
    xml = build_cap([alert()], 16.99, 73.31, "Ratnagiri <Konkan> & coast", now=NOW)
    assert "&lt;rain&gt; &amp; floods" in xml
    root = ET.fromstring(xml)
    assert root.find("cap:info/cap:headline", NS).text == "Warning: 72.4 mm <rain> & floods"


def test_cap_without_alerts_is_valid_and_says_so():
    root = ET.fromstring(build_cap([], 18.5, 73.8, "Pune", now=NOW))
    assert root.findall("cap:info", NS) == []
    assert "No active alerts" in root.findtext("cap:note", namespaces=NS)


def test_cap_endpoint():
    wet = make_weather(rain=lambda i, t: 6.0 if i < 12 else 0.0)
    with patch("api.dissemination.fetch_validated_weather", AsyncMock(return_value=wet)):
        resp = client.get("/api/alerts/cap?latitude=16.99&longitude=73.31&name=Ratnagiri")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("application/cap+xml")
    root = ET.fromstring(resp.text)
    assert root.findall("cap:info", NS)


def test_cap_endpoint_503_when_weather_down():
    with patch("api.dissemination.fetch_validated_weather", AsyncMock(side_effect=RuntimeError("x"))):
        assert client.get("/api/alerts/cap?latitude=1&longitude=1").status_code == 503


def test_alerts_response_carries_the_disclaimer():
    with patch("api.alerts.fetch_validated_weather", AsyncMock(return_value=make_weather())):
        body = client.get("/api/alerts?latitude=19&longitude=73").json()
    assert "not official IMD warnings" in body["note"]


# ---------------------------------------------------------------------------
# Job: notify when severity BECOMES high
# ---------------------------------------------------------------------------


class FakeStore:
    def __init__(self, subs):
        self.subs = {s.id: s for s in subs}
        self.updates: list[tuple[str, dict]] = []
        self.deleted: list[str] = []

    async def list(self):
        return list(self.subs.values())

    async def update(self, sub_id, fields):
        self.updates.append((sub_id, fields))
        for k, v in fields.items():
            if hasattr(self.subs[sub_id], k):
                setattr(self.subs[sub_id], k, v)

    async def delete(self, sub_id):
        self.deleted.append(sub_id)
        self.subs.pop(sub_id)


class FakeSender:
    def __init__(self, status="sent", available=True):
        self.status, self._available, self.sent = status, available, []

    @property
    def available(self):
        return self._available

    def send(self, endpoint, p256dh, auth, payload):
        self.sent.append((endpoint, payload))
        return self.status


def sub(i="s1", lat=16.99, last="none"):
    return Subscription(id=i, location_name="Ratnagiri", latitude=lat, longitude=73.31,
                        endpoint=f"https://push.example/{i}", p256dh="k", auth="a", last_severity=last)


EXTREME = make_weather(rain=lambda i, t: 7.0 if i < 12 else 0.0)  # 84 mm in 24 h -> warning
CALM = make_weather()


def test_level_picks_highest():
    assert level([]) == "none"
    assert level([alert("advisory"), alert("warning"), alert("watch")]) == "warning"


@pytest.mark.asyncio
async def test_push_sent_once_when_severity_becomes_high():
    store, sender = FakeStore([sub()]), FakeSender()
    fetch = AsyncMock(return_value=EXTREME)
    r1 = await run_job(store, sender, fetch)
    assert (r1.became_high, r1.sent) == (1, 1)
    payload = sender.sent[0][1]
    assert "Ratnagiri" in payload["title"] and "not an official IMD warning" in payload["body"]
    assert store.subs["s1"].last_severity == "warning"
    assert "last_notified_at" in store.updates[-1][1]

    r2 = await run_job(store, sender, fetch)  # still high: no repeat
    assert (r2.became_high, r2.sent) == (0, 0) and len(sender.sent) == 1

    await run_job(store, sender, AsyncMock(return_value=CALM))  # drops: re-arm
    assert store.subs["s1"].last_severity == "none"
    r4 = await run_job(store, sender, fetch)
    assert r4.sent == 1 and len(sender.sent) == 2


@pytest.mark.asyncio
async def test_no_push_for_lower_severities():
    store, sender = FakeStore([sub()]), FakeSender()
    watch_only = make_weather(rain=lambda i, t: 3.0 if i < 12 else 0.0)  # 36 mm
    report = await run_job(store, sender, AsyncMock(return_value=watch_only))
    assert report.sent == 0 and sender.sent == []
    assert store.subs["s1"].last_severity in {"watch", "advisory"}


@pytest.mark.asyncio
async def test_gone_subscription_is_deleted():
    store = FakeStore([sub()])
    report = await run_job(store, FakeSender("gone"), AsyncMock(return_value=EXTREME))
    assert report.gone == 1 and store.deleted == ["s1"]


@pytest.mark.asyncio
async def test_failed_or_disabled_send_retries_next_run():
    for status, available in (("failed", True), ("disabled", False)):
        store = FakeStore([sub()])
        report = await run_job(store, FakeSender(status, available), AsyncMock(return_value=EXTREME))
        assert store.subs["s1"].last_severity == "none", status  # not marked as notified
        assert report.push_available is available


@pytest.mark.asyncio
async def test_one_fetch_per_cell_and_errors_are_isolated():
    store = FakeStore([sub("a", 16.99), sub("b", 16.991), sub("c", 21.15)])

    async def fetch(lat, lon):
        if lat > 20:
            raise RuntimeError("timeout")
        return EXTREME

    spy = AsyncMock(side_effect=fetch)
    report = await run_job(store, FakeSender(), spy)
    assert spy.await_count == 2  # a and b share a cell
    assert report.sent == 2 and report.weather_errors == 1


def test_payload_names_the_top_alert():
    p = payload_for(sub(), [alert("watch", "Strong wind"), alert("warning", "Extreme Rain / Flood Risk")])
    assert p["title"].startswith("Extreme Rain / Flood Risk") and p["severity"] == "warning"


# ---------------------------------------------------------------------------
# Endpoints: job auth and push config
# ---------------------------------------------------------------------------


def test_job_endpoint_requires_configured_token(monkeypatch):
    monkeypatch.delenv("ALERT_JOB_TOKEN", raising=False)
    assert client.post("/api/alerts/check").status_code == 503
    monkeypatch.setenv("ALERT_JOB_TOKEN", "s3cret")
    assert client.post("/api/alerts/check").status_code == 401
    assert client.post("/api/alerts/check", headers={"X-Job-Token": "nope"}).status_code == 401


def test_job_endpoint_runs_with_token(monkeypatch):
    from dissemination.job import JobReport

    monkeypatch.setenv("ALERT_JOB_TOKEN", "s3cret")
    with patch("dissemination.job.run_from_env", AsyncMock(return_value=JobReport(checked=3))):
        resp = client.post("/api/alerts/check", headers={"X-Job-Token": "s3cret"})
    assert resp.status_code == 200 and resp.json()["checked"] == 3


def test_push_config(monkeypatch):
    for k in ("VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"):
        monkeypatch.delenv(k, raising=False)
    body = client.get("/api/push/config").json()
    assert body["available"] is False and body["vapid_public_key"] is None
    monkeypatch.setenv("VAPID_PUBLIC_KEY", "BPub")
    monkeypatch.setenv("VAPID_PRIVATE_KEY", "priv")
    monkeypatch.setenv("VAPID_SUBJECT", "mailto:ops@example.org")
    with patch("api.dissemination.pywebpush_installed", return_value=False):
        body = client.get("/api/push/config").json()
    assert body["vapid_public_key"] == "BPub"
    assert body["available"] is False and "pywebpush" in body["reason"]
    assert "priv" not in str(body)
