"""Community reports (docs/REPORTS.md): API, rate limit, expiry, flags, trust, photos."""

from __future__ import annotations

import io
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient
from PIL import Image

import thresholds as th
from api import reports as api
from dissemination import demo_push
from main import app
from reports import photo as photos
from reports import trust as trust_mod
from reports.models import HIDE_AFTER_FLAGS, LABEL, ReportRow
from reports.store import MemoryStore, SupabaseStore

client = TestClient(app)
T0 = datetime(2026, 11, 9, 10, 37, 20, tzinfo=timezone.utc)
PUNE = {"latitude": "18.5204", "longitude": "73.8567"}
USERS = {"alice": "11111111-1111-1111-1111-111111111111", "bob": "22222222-2222-2222-2222-222222222222",
         "cara": "33333333-3333-3333-3333-333333333333", "dev": "44444444-4444-4444-4444-444444444444"}


def auth(name: str) -> dict:
    return {"Authorization": f"Bearer {name}"}


@pytest.fixture()
def env(monkeypatch):
    """A memory store, a pinned clock, fake sign-in and a fixed model agreement."""
    store = MemoryStore()
    now = {"t": T0}
    monkeypatch.setattr(api, "store_override", store)
    monkeypatch.setattr(api, "clock", lambda: now["t"])
    api.limiter.clear()
    monkeypatch.setattr(api.limiter, "clock", lambda: now["t"].timestamp())

    async def verify(token: str) -> str:
        if token not in USERS:
            raise demo_push.AuthError("Your session has expired. Sign in again.")
        return USERS[token]

    monkeypatch.setattr(demo_push, "verify_user", verify)
    agreement = {"value": 0.8, "known": True}

    async def model(kind, lat, lon, when=None):
        return agreement["value"], agreement["known"]

    monkeypatch.setattr(trust_mod, "model_agreement", model)
    yield {"store": store, "now": now, "agreement": agreement}
    api.limiter.clear()


def report(who="alice", kind="heavy_rain", files=None, **extra):
    data = {"kind": kind, **PUNE, **extra}
    return client.post("/api/reports", data=data, files=files, headers=auth(who) if who else {})


def box(who=None):
    params = {"south": 18, "west": 73, "north": 19, "east": 74.5}
    return client.get("/api/reports", params=params, headers=auth(who) if who else {})


def advance(env, **delta):
    env["now"]["t"] = env["now"]["t"] + timedelta(**delta)


# ------------------------------------------------------------------- basics ---

def test_needs_sign_in(env):
    r = report(who=None)
    assert r.status_code == 401 and r.json()["code"] == "sign_in"
    r = report(who="mallory")
    assert r.status_code == 401
    assert env["store"].rows == {}


def test_not_configured_without_supabase(monkeypatch):
    monkeypatch.setattr(api, "store_override", None)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    r = client.get("/api/reports", params={"south": 18, "west": 73, "north": 19, "east": 74})
    assert r.status_code == 503 and r.json()["code"] == "not_configured"


def test_create_and_list_without_identity(env):
    r = report(note="  Knee-deep water\x00 near the station  ")
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["kind"] == "heavy_rain" and body["mine"] is True
    assert body["note"] == "Knee-deep water near the station"
    assert body["reporter"] == "a resident"
    # the time is approximate: rounded down to 10 minutes
    assert body["reported_at"] == "2026-11-09T10:30:00Z"
    assert body["expires_at"] == "2026-11-09T16:37:20Z"  # 6 h
    listing = box("bob").json()
    assert listing["label"] == LABEL and "unverified" in listing["label"]
    (pub,) = listing["reports"]
    assert pub["mine"] is False
    # the reporter's identity is never in the API
    for value in USERS.values():
        assert value not in r.text and value not in str(listing)
    assert "user_id" not in r.text and "user_id" not in str(listing)


def test_bad_kind_and_box(env):
    assert report(kind="tsunami").json()["code"] == "bad_kind"
    r = client.get("/api/reports", params={"south": 0, "west": 60, "north": 30, "east": 90})
    assert r.status_code == 422 and r.json()["code"] == "box_too_large"


def test_note_is_capped(env):
    r = report(note="x" * 500)
    assert len(r.json()["note"]) == 280


# --------------------------------------------------------------- rate limit ---

def test_one_report_a_minute(env):
    assert report().status_code == 201
    r = report()
    assert r.status_code == 429 and r.json()["code"] == "rate_limited"
    assert 1 <= int(r.headers["Retry-After"]) <= 60
    advance(env, seconds=61)
    assert report().status_code == 201


def test_at_most_five_an_hour(env):
    for _ in range(api.MAX_PER_HOUR):
        assert report().status_code == 201
        advance(env, seconds=61)
    r = report()
    assert r.status_code == 429
    # other people are not limited by alice
    assert report("bob").status_code == 201
    advance(env, hours=1)
    assert report().status_code == 201


# ------------------------------------------------------------------- expiry ---

def test_reports_expire_after_6_h_and_24_h_for_landslide_and_road_blocked(env):
    report(kind="waterlogging")
    report("bob", kind="landslide")
    report("cara", kind="road_blocked")
    advance(env, hours=6, seconds=1)
    kinds = sorted(r["kind"] for r in box().json()["reports"])
    assert kinds == ["landslide", "road_blocked"]
    advance(env, hours=18)
    assert box().json()["reports"] == []


# -------------------------------------------------------------------- votes ---

def test_confirm_and_flag_one_vote_each_never_your_own(env):
    rid = report().json()["id"]
    own = client.post(f"/api/reports/{rid}/vote", json={"vote": "confirm"}, headers=auth("alice"))
    assert own.status_code == 403 and own.json()["code"] == "own_report"
    r = client.post(f"/api/reports/{rid}/vote", json={"vote": "confirm"}, headers=auth("bob"))
    assert r.status_code == 200 and r.json()["confirms"] == 1 and r.json()["my_vote"] == "confirm"
    again = client.post(f"/api/reports/{rid}/vote", json={"vote": "flag"}, headers=auth("bob"))
    assert again.status_code == 409 and again.json()["code"] == "already_voted"
    assert client.post(f"/api/reports/{rid}/vote", json={"vote": "confirm"}).status_code == 401
    # bob sees his vote in the list
    (pub,) = box("bob").json()["reports"]
    assert pub["my_vote"] == "confirm"


def test_hidden_after_n_flags(env):
    rid = report().json()["id"]
    flaggers = ["bob", "cara", "dev"]
    assert len(flaggers) == HIDE_AFTER_FLAGS
    for name in flaggers[:-1]:
        client.post(f"/api/reports/{rid}/vote", json={"vote": "flag"}, headers=auth(name))
    assert box().json()["reports"][0]["flags"] == HIDE_AFTER_FLAGS - 1
    client.post(f"/api/reports/{rid}/vote", json={"vote": "flag"}, headers=auth(flaggers[-1]))
    assert box().json()["reports"] == []
    assert client.get(f"/api/reports/{rid}/photo").status_code == 404


# -------------------------------------------------------------------- trust ---

def row(id="r", user="u1", kind="heavy_rain", lat=18.52, lon=73.85, at=T0, model=0.8, reporter=0.5, confirms=0, flags=0):
    from reports.models import LIFETIME

    return ReportRow(id=id, user_id=user, kind=kind, latitude=lat, longitude=lon, created_at=at,
                     expires_at=at + LIFETIME[kind], model_agreement=model, reporter_accuracy=reporter,
                     confirm_count=confirms, flag_count=flags)


def test_trust_formula_and_levels():
    r = row(model=1.0, reporter=0.5)
    t = trust_mod.trust(r, [r], T0)
    # 0.35*1 + 0.25*0 + 0.15*1 + 0.25*0.5 = 0.625: medium, just under high
    assert t.score == 0.625 and t.level == "medium"
    assert t.parts.model == 1.0 and t.parts.age == 1.0 and t.parts.nearby == 0.0
    confirmed = row(model=1.0, reporter=0.5, confirms=1)
    assert trust_mod.trust(confirmed, [confirmed], T0).level == "high"
    contradicted = row(model=0.1, reporter=0.5)
    assert trust_mod.trust(contradicted, [contradicted], T0).level == "low"
    # flags cost 0.1 each
    flagged = row(model=1.0, confirms=1, flags=2)
    assert trust_mod.trust(flagged, [flagged], T0).score == pytest.approx(0.7083 - 0.2, abs=1e-3)


def test_trust_falls_with_age():
    r = row()
    young = trust_mod.trust(r, [r], T0).score
    old = trust_mod.trust(r, [r], T0 + timedelta(hours=5)).score
    assert old < young
    assert trust_mod.trust(r, [r], T0 + timedelta(hours=3)).parts.age == 0.5


def test_nearby_reports_by_other_people_corroborate():
    a = row("a", "u1", "waterlogging")
    b = row("b", "u2", "heavy_rain", lat=18.53)  # ~1.1 km, same group (rain)
    c = row("c", "u1", "heavy_rain", lat=18.521)  # same person: does not count
    d = row("d", "u3", "strong_wind")  # other group
    e = row("e", "u4", "hail", lat=18.60)  # ~9 km: too far
    f = row("f", "u5", "heavy_rain", at=T0 - timedelta(hours=4))  # too long before
    assert trust_mod.nearby_support(a, [a, b, c, d, e, f]) == 1


def test_reporter_accuracy_has_a_prior():
    assert trust_mod.reporter_accuracy([]) == 0.5
    good = [row(model=1.0, confirms=3) for _ in range(4)]
    bad = [row(model=0.1, flags=3) for _ in range(4)]
    assert trust_mod.reporter_accuracy(good) > 0.8
    assert trust_mod.reporter_accuracy(bad) < 0.25


def test_new_report_uses_the_reporters_history(env):
    for _ in range(3):
        rid = report().json()["id"]
        for name in ("bob", "cara", "dev"):
            client.post(f"/api/reports/{rid}/vote", json={"vote": "flag"}, headers=auth(name))
        advance(env, seconds=61)
    rid = report().json()["id"]
    assert env["store"].rows[rid].reporter_accuracy < 0.5


# ---------------------------------------------------------- model agreement ---

def series(**hourly):
    n = 27
    return {k: (v + [None] * n)[:n] for k, v in hourly.items()}


def test_agreement_bands_from_thresholds():
    now = 24
    rain = lambda mm: series(precipitation=[0.0] * 24 + [mm, 0.0, 0.0])  # noqa: E731
    assert trust_mod.agreement_from_series("heavy_rain", rain(0.0), now) == 0.1
    assert trust_mod.agreement_from_series("heavy_rain", rain(1.0), now) == 0.4
    assert trust_mod.agreement_from_series("waterlogging", rain(5.0), now) == 0.7
    assert trust_mod.agreement_from_series("heavy_rain", rain(th.RAIN_RATE_HEAVY_MM_H), now) == 1.0
    gust = lambda kmh: series(wind_gusts_10m=[10.0] * 24 + [kmh, 10.0, 10.0])  # noqa: E731
    assert trust_mod.agreement_from_series("strong_wind", gust(10.0), now) == 0.2
    assert trust_mod.agreement_from_series("fallen_tree", gust(10.0), now) == th.REPORT_AGREEMENT_FALLEN_TREE_FLOOR
    assert trust_mod.agreement_from_series("strong_wind", gust(th.GALE.value), now) == 1.0
    hail = series(weather_code=[0] * 24 + [96, 0, 0], precipitation=[0.0] * 27)
    assert trust_mod.agreement_from_series("hail", hail, now) == 1.0
    wet = series(precipitation=[(th.EXTREME_RAIN.value + 1) / 24] * 24 + [0.0, 0.0, 0.0])
    assert trust_mod.agreement_from_series("landslide", wet, now) == 1.0
    dry = series(precipitation=[0.0] * 27)
    assert trust_mod.agreement_from_series("road_blocked", dry, now) == 0.3


@pytest.mark.asyncio
async def test_model_agreement_asks_open_meteo_once_and_survives_failure(monkeypatch):
    import open_meteo_access

    calls = []
    base_ts = int(T0.timestamp()) // 3600 * 3600 - 24 * 3600

    async def fetch(service, params, timeout):
        calls.append(params)
        hourly = {"time": [base_ts + 3600 * i for i in range(27)], "precipitation": [0.0] * 24 + [9.0, 0, 0],
                  "wind_gusts_10m": [0] * 27, "weather_code": [0] * 27}
        return httpx.Response(200, json={"hourly": hourly})

    monkeypatch.setattr(open_meteo_access, "fetch", fetch)
    assert await trust_mod.model_agreement("heavy_rain", 18.52, 73.86, T0) == (1.0, True)
    assert len(calls) == 1 and calls[0]["past_hours"] == 24

    async def down(service, params, timeout):
        raise httpx.ConnectError("down")

    monkeypatch.setattr(open_meteo_access, "fetch", down)
    assert await trust_mod.model_agreement("heavy_rain", 18.52, 73.86, T0) == (th.REPORT_AGREEMENT_UNKNOWN, False)


# ------------------------------------------------------------------- photos ---

def jpeg_with_gps(size=(2400, 1200), orientation=None) -> bytes:
    img = Image.new("RGB", size, (200, 30, 30))
    exif = Image.Exif()
    exif[0x010F] = "PhoneMaker"  # Make
    exif[0x0110] = "SecretPhone 9"  # Model
    exif[0x0131] = "CameraApp 1.0"  # Software
    gps = exif.get_ifd(0x8825)
    gps[1] = "N"
    gps[2] = (18.0, 31.0, 13.0)
    gps[3] = "E"
    gps[4] = (73.0, 51.0, 24.0)
    if orientation:
        exif[0x0112] = orientation
    out = io.BytesIO()
    img.save(out, format="JPEG", exif=exif.tobytes(), comment=b"taken at home")
    return out.getvalue()


def test_photo_metadata_is_gone_including_gps():
    raw = jpeg_with_gps()
    original = Image.open(io.BytesIO(raw))
    assert original.getexif().get_ifd(0x8825)  # the sample really has GPS
    clean = photos.clean_photo(raw)
    img = Image.open(io.BytesIO(clean))
    assert img.format == "JPEG"
    assert len(img.getexif()) == 0
    assert "exif" not in img.info and "comment" not in img.info and "icc_profile" not in img.info
    for needle in (b"SecretPhone", b"PhoneMaker", b"CameraApp", b"taken at home", b"Exif"):
        assert needle not in clean
    assert img.width == photos.MAX_WIDTH and img.height == 800


def test_photo_orientation_is_applied_before_stripping():
    raw = jpeg_with_gps(size=(400, 200), orientation=6)  # rotate 90 degrees on display
    img = Image.open(io.BytesIO(photos.clean_photo(raw)))
    assert img.size == (200, 400)


def test_png_with_alpha_becomes_jpeg():
    out = io.BytesIO()
    Image.new("RGBA", (50, 40), (0, 0, 255, 128)).save(out, format="PNG")
    img = Image.open(io.BytesIO(photos.clean_photo(out.getvalue())))
    assert img.format == "JPEG" and img.mode == "RGB" and img.size == (50, 40)


def test_photo_guards():
    with pytest.raises(photos.PhotoError) as e:
        photos.clean_photo(b"\x00\x00\x00\x18ftypheic" + b"\x00" * 100)  # HEIC: browsers convert first
    assert e.value.code == "format"
    with pytest.raises(photos.PhotoError) as e:
        photos.clean_photo(b"x" * (photos.MAX_BYTES + 1))
    assert e.value.code == "too_large"
    # a decompression bomb: a tiny PNG that claims a huge image
    bomb = io.BytesIO()
    Image.new("1", (9000, 9000)).save(bomb, format="PNG")
    assert len(bomb.getvalue()) < 200_000
    with pytest.raises(photos.PhotoError) as e:
        photos.clean_photo(bomb.getvalue())
    assert e.value.code == "too_many_pixels"


def test_upload_through_the_api_stores_only_the_clean_jpeg(env):
    raw = jpeg_with_gps()
    r = report(files={"photo": ("IMG_0001.jpg", raw, "image/jpeg")})
    assert r.status_code == 201 and r.json()["has_photo"] is True
    stored = next(iter(env["store"].photos.values()))
    assert b"SecretPhone" not in stored and b"Exif" not in stored
    served = client.get(f"/api/reports/{r.json()['id']}/photo")
    assert served.status_code == 200 and served.headers["content-type"] == "image/jpeg"
    assert served.content == stored


def test_unreadable_photo_is_refused_and_nothing_is_saved(env):
    r = report(files={"photo": ("x.heic", b"\x00\x00\x00\x18ftypheic" + b"\x00" * 64, "image/heic")})
    assert r.status_code == 422 and r.json()["code"] == "photo_format"
    assert env["store"].rows == {} and env["store"].photos == {}


# ------------------------------------------------------------ supabase store ---

@pytest.mark.asyncio
async def test_supabase_store_uses_the_service_role_and_maps_rows():
    seen = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        if req.url.path.endswith("/report_votes") and req.method == "POST":
            return httpx.Response(409, json={"code": "23505"})
        return httpx.Response(200, json=[{
            "id": "r1", "user_id": USERS["alice"], "kind": "hail", "latitude": 18.5, "longitude": 73.8,
            "note": None, "photo_path": None, "created_at": "2026-11-09T10:00:00+00:00",
            "expires_at": "2026-11-09T16:00:00+00:00", "model_agreement": 0.6, "model_known": True,
            "reporter_accuracy": 0.5, "confirm_count": 2, "flag_count": 0}])

    store = SupabaseStore("https://proj.supabase.co", "service-role-secret", transport=httpx.MockTransport(handler))
    (r,) = await store.list_box(18, 73, 19, 74, T0)
    assert r.kind == "hail" and r.confirm_count == 2
    q = seen[0].url.params
    assert q["flag_count"] == f"lt.{HIDE_AFTER_FLAGS}" and q["expires_at"].startswith("gt.2026-11-09")
    assert q["and"] == "(latitude.gte.18,latitude.lte.19,longitude.gte.73,longitude.lte.74)"
    assert seen[0].headers["Authorization"] == "Bearer service-role-secret"
    from reports.store import AlreadyVoted

    with pytest.raises(AlreadyVoted):
        await store.vote("r1", USERS["bob"], "confirm")


def test_migration_keeps_reports_private():
    sql = (Path(__file__).parent.parent / "supabase" / "migration_8_reports.sql").read_text(encoding="utf-8")
    assert "ENABLE ROW LEVEL SECURITY" in sql
    assert "CREATE POLICY" not in sql  # browsers have no direct access
    assert "REVOKE ALL ON public.community_reports FROM anon, authenticated" in sql
    assert "PRIMARY KEY (report_id, user_id)" in sql
    assert "'report-photos', 'report-photos', FALSE" in sql
    schema = (Path(__file__).parent.parent / "supabase" / "schema.sql").read_text(encoding="utf-8")
    assert sql.strip() in schema  # kept in sync


def test_reports_never_feed_forecasts_or_alerts():
    backend = Path(__file__).parent.parent / "backend"
    for folder in ("alerts", "roles", "routing", "dissemination", "climate", "nwp", "weather"):
        for f in (backend / folder).glob("*.py"):
            text = f.read_text(encoding="utf-8")
            assert "from reports" not in text and "import reports" not in text, f
    for f in ("thresholds.py", "query_service.py", "advisory.py", "maps/hazard.py", "maps/grid.py", "maps/point.py"):
        text = (backend / f).read_text(encoding="utf-8")
        assert "from reports" not in text and "import reports" not in text, f
