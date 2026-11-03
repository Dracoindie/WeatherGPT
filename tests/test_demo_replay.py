"""Demo replay (DEMO_REPLAY / DEMO_RECORD): keys, record, replay, offline fallback."""

from __future__ import annotations

import json
import re

import pytest
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient

import demo_replay
from demo_replay import FixtureStore, OFFLINE_CHAT, REPLAY_HEADER, install, request_key

LIVE_CALLS: list[str] = []


def _app(store: FixtureStore, *, replay: bool, record: bool) -> FastAPI:
    app = FastAPI()
    install(app, replay=replay, record=record, store=store)
    app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:3000"], allow_methods=["*"], allow_headers=["*"],
                       expose_headers=[REPLAY_HEADER])

    @app.post("/api/chat")
    async def chat(body: dict):
        LIVE_CALLS.append("chat")
        return {"message": f"live answer to {body['message']}", "source": "open-meteo"}

    @app.get("/api/alerts")
    async def alerts(latitude: float, longitude: float):
        LIVE_CALLS.append("alerts")
        return {"alerts": [], "latitude": latitude, "longitude": longitude}

    @app.post("/api/push/test")
    async def push_test():
        LIVE_CALLS.append("push")
        return {"sent": 1}

    return app


@pytest.fixture(autouse=True)
def _reset(monkeypatch):
    LIVE_CALLS.clear()
    demo_replay._probe_cache.clear()
    yield


def _offline(monkeypatch, online: bool):
    async def reachable() -> bool:
        return online

    monkeypatch.setattr(demo_replay, "internet_reachable", reachable)


# --- keys ---------------------------------------------------------------------


def test_key_folds_case_punctuation_and_rounds_coordinates():
    a = request_key("POST", "/api/chat", {}, {"message": "Will it rain in Pune tomorrow?", "role": "citizen"})
    b = request_key("POST", "/api/chat", {}, {"message": "  will it RAIN in pune tomorrow ", "role": "citizen"})
    assert a == b
    g1 = request_key("GET", "/api/alerts", {"latitude": "18.52036", "longitude": "73.85674"})
    g2 = request_key("GET", "/api/alerts", {"latitude": "18.5214", "longitude": "73.8551"})
    assert g1 == g2


def test_key_separates_role_follow_up_context_and_place():
    base = {"message": "aur parso?", "role": "citizen"}
    pune = {**base, "context": {"intent": "forecast", "location_name": "Pune", "date_reference": "tomorrow"}}
    mumbai = {**base, "context": {"intent": "forecast", "location_name": "Mumbai", "date_reference": "tomorrow"}}
    keys = {
        request_key("POST", "/api/chat", {}, base),
        request_key("POST", "/api/chat", {}, pune),
        request_key("POST", "/api/chat", {}, mumbai),
        request_key("POST", "/api/chat", {}, {**base, "role": "farmer"}),
    }
    assert len(keys) == 4
    assert request_key("GET", "/api/alerts", {"latitude": "18.52", "longitude": "73.86"}) != request_key(
        "GET", "/api/alerts", {"latitude": "19.08", "longitude": "72.88"}
    )


# --- record then replay -------------------------------------------------------


def test_record_saves_fixture_then_replay_serves_it_without_live_call(tmp_path, monkeypatch):
    store = FixtureStore(tmp_path)
    rec = TestClient(_app(store, replay=False, record=True))
    r = rec.post("/api/chat", json={"message": "Will it rain in Pune tomorrow?", "role": "citizen"})
    assert r.status_code == 200 and LIVE_CALLS == ["chat"]
    files = list(tmp_path.glob("*.json"))
    assert len(files) == 1
    saved = json.loads(files[0].read_text(encoding="utf-8"))
    assert saved["response"]["message"] == "live answer to Will it rain in Pune tomorrow?"
    assert re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", saved["recorded_at"])

    _offline(monkeypatch, online=False)
    LIVE_CALLS.clear()
    play = TestClient(_app(FixtureStore(tmp_path), replay=True, record=False))
    r = play.post("/api/chat", json={"message": "will it rain in pune tomorrow", "role": "citizen"},
                  headers={"Origin": "http://localhost:3000"})
    assert r.status_code == 200
    assert r.json()["message"] == "live answer to Will it rain in Pune tomorrow?"
    assert r.headers[REPLAY_HEADER] == saved["recorded_at"]
    # CORS still applies and the UI is allowed to read the replay header
    assert r.headers["access-control-allow-origin"] == "http://localhost:3000"
    assert REPLAY_HEADER.lower() in r.headers["access-control-expose-headers"].lower()
    assert LIVE_CALLS == []


def test_replay_get_matches_nearby_coordinates(tmp_path, monkeypatch):
    store = FixtureStore(tmp_path)
    TestClient(_app(store, replay=False, record=True)).get("/api/alerts", params={"latitude": 18.52036, "longitude": 73.85674})
    _offline(monkeypatch, online=False)
    LIVE_CALLS.clear()
    r = TestClient(_app(FixtureStore(tmp_path), replay=True, record=False)).get(
        "/api/alerts", params={"latitude": 18.5214, "longitude": 73.8551}
    )
    assert r.status_code == 200 and REPLAY_HEADER in r.headers and LIVE_CALLS == []


# --- unmatched requests -------------------------------------------------------


def test_unmatched_goes_live_when_online_and_is_not_marked_replay(tmp_path, monkeypatch):
    _offline(monkeypatch, online=True)
    r = TestClient(_app(FixtureStore(tmp_path), replay=True, record=False)).post(
        "/api/chat", json={"message": "Weather in Goa?", "role": "citizen"}
    )
    assert r.status_code == 200 and LIVE_CALLS == ["chat"]
    assert REPLAY_HEADER not in r.headers


@pytest.mark.parametrize("lang,msg", [
    ("en", "Weather in Goa tomorrow?"),
    ("hi", "गोवा में कल मौसम कैसा रहेगा?"),
    ("hinglish", "Goa mein kal baarish hogi kya?"),
    ("mr", "उद्या गोव्यात पाऊस पडेल का?"),
])
def test_unmatched_chat_offline_says_only_prepared_questions_in_user_language(tmp_path, monkeypatch, lang, msg):
    _offline(monkeypatch, online=False)
    r = TestClient(_app(FixtureStore(tmp_path), replay=True, record=False)).post(
        "/api/chat", json={"message": msg, "role": "citizen"}
    )
    assert r.status_code == 200
    body = r.json()
    assert body["message"] == OFFLINE_CHAT[lang]
    assert body["intent"]["language"] == lang
    assert body["source"] == "offline-demo"
    assert REPLAY_HEADER not in r.headers  # nothing recorded is being shown
    assert LIVE_CALLS == []


def test_offline_chat_text_has_no_numbers_so_it_is_grounded():
    # Ground rule 1: reply text may only carry numbers from facts; this one has none.
    for text in OFFLINE_CHAT.values():
        assert not re.search(r"\d", text)


def test_unmatched_get_offline_is_a_clear_503(tmp_path, monkeypatch):
    _offline(monkeypatch, online=False)
    r = TestClient(_app(FixtureStore(tmp_path), replay=True, record=False)).get(
        "/api/alerts", params={"latitude": 10, "longitude": 76}
    )
    assert r.status_code == 503
    assert "only prepared questions" in r.json()["detail"]
    assert LIVE_CALLS == []


def test_push_endpoints_are_never_recorded_or_replayed(tmp_path, monkeypatch):
    store = FixtureStore(tmp_path)
    TestClient(_app(store, replay=False, record=True)).post("/api/push/test")
    assert list(tmp_path.glob("*.json")) == []
    _offline(monkeypatch, online=False)
    r = TestClient(_app(store, replay=True, record=False)).post("/api/push/test")
    assert r.status_code == 200 and r.json() == {"sent": 1}


def test_install_is_a_no_op_when_both_flags_are_off(tmp_path):
    app = FastAPI()
    assert install(app, replay=False, record=False, store=FixtureStore(tmp_path)) is None
    assert app.user_middleware == []


def test_env_flags(monkeypatch):
    monkeypatch.setenv("DEMO_REPLAY", "1")
    assert demo_replay.env_on("DEMO_REPLAY")
    monkeypatch.setenv("DEMO_REPLAY", "0")
    assert not demo_replay.env_on("DEMO_REPLAY")


def test_committed_fixtures_are_valid():
    """Every committed fixture loads and its key matches its own request."""
    store = FixtureStore()
    for key, fx in store.fixtures.items():
        req = fx["request"]
        assert request_key(req["method"], req["path"], req["query"], req["body"]) == key
        assert fx["status"] == 200 and fx["recorded_at"].endswith("Z")
        assert not req["path"].startswith("/api/push")
