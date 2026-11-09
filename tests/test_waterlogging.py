"""Experimental waterlogging estimate (docs/WATERLOGGING.md): formula, terrain, rain, reports, API."""

from __future__ import annotations

import io
import math
from datetime import datetime, timedelta, timezone

import h3
import httpx
import pytest
from fastapi.testclient import TestClient
from PIL import Image

import open_meteo_access
import thresholds as th
from api import reports as reports_api
from main import app
from maps import dem
from maps import waterlogging as W
from reports.models import LIFETIME, ReportRow
from reports.store import MemoryStore

client = TestClient(app)
T0 = datetime(2026, 11, 9, 10, 0, tzinfo=timezone.utc)
BOWL = (18.52, 73.86)  # the low point of the synthetic terrain
BOX = {"south": 18.45, "west": 73.78, "north": 18.60, "east": 73.95}


# ------------------------------------------------------------------ formula ---

def test_rain_factor_from_thresholds():
    assert W.rain_factor(0, 0) == 0
    assert W.rain_factor(th.WATERLOG_RAIN_TOTAL_MM, 0) == 1
    assert W.rain_factor(0, th.WATERLOG_RAIN_PEAK_MM_H / 2) == 0.5
    assert W.rain_factor(500, 500) == 1


def test_score_rain_times_lowness_plus_reports():
    # no rain, no reports: nothing, however low the ground
    assert W.score(0, 0, 30.0, []) == 0
    # heavy rain on high ground: 0.4 of the rain factor
    assert W.score(50, 0, -5.0, []) == 0.4
    # heavy rain in a dip 15 m below its surroundings: the full score
    assert W.score(50, 0, th.WATERLOG_LOW_METRES, []) == 1.0
    # half the rain, half as low: 0.5 * (0.4 + 0.3) = 0.35
    assert W.score(25, 0, th.WATERLOG_LOW_METRES / 2, []) == 0.35
    # reports add up to 0.3 (1.5 trust weight for the full share)
    assert W.score(0, 0, None, [1.0, 0.5]) == 0.3
    assert W.score(0, 0, None, [0.25]) == 0.05


def test_levels():
    assert th.waterlog_level(0.1) == "none"
    assert th.waterlog_level(0.15) == "low"
    assert th.waterlog_level(0.4) == "moderate"
    assert th.waterlog_level(0.6) == "high"


# ------------------------------------------------------------------ terrain ---

def test_terrarium_decoding_and_tile_maths():
    assert dem.decode((128, 0, 0)) == 0
    assert dem.decode((128, 100, 128)) == 100.5
    assert dem.tile_pixel(0.0, 0.0, 1) == ((1, 1, 1), 0.0, 0.0)


def test_lowness_against_the_rings_around():
    cell = h3.latlng_to_cell(*BOWL, W.RES)
    ground = {c: 40.0 for c in h3.grid_disk(cell, W.RING)}
    ground[cell] = 25.0
    assert W.lowness(cell, ground) == 15.0
    ground[cell] = 55.0
    assert W.lowness(cell, ground) == -15.0
    assert W.lowness(cell, {cell: 10.0}) is None  # no surroundings: unknown, not low


def _km(lat1, lon1, lat2, lon2):
    return 111.0 * math.hypot(lat2 - lat1, (lon2 - lon1) * math.cos(math.radians(lat1)))


def bowl_tile(key):
    """A terrarium PNG: 30 m at the bowl's centre rising to 60 m 3 km out."""
    z, tx, ty = key
    n = 2**z
    img = Image.new("RGB", (256, 256))
    px = []
    for py in range(256):
        lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (ty + (py + 0.5) / 256) / n))))
        for pxx in range(256):
            lon = (tx + (pxx + 0.5) / 256) / n * 360 - 180
            h = 30 + 30 * min(1.0, _km(*BOWL, lat, lon) / 3.0)
            v = h + 32768
            r, rest = divmod(v, 256)
            g = int(rest)
            b = int((rest - g) * 256)
            px.append((int(r), g, b))
    img.putdata(px)
    out = io.BytesIO()
    img.save(out, format="PNG")
    return out.getvalue()


@pytest.fixture()
def world(monkeypatch):
    W.clear_cache()
    dem.clear_cache()
    calls = {"dem": 0, "rain": 0}
    rain = {"peak": 20.0}

    async def fetch_tile(key):
        calls["dem"] += 1
        return bowl_tile(key)

    async def fetch(service, params, timeout):
        calls["rain"] += 1
        n = len(params["latitude"].split(","))
        base = int(T0.timestamp()) - 3 * 3600
        item = {"hourly": {"time": [base + 3600 * i for i in range(9)],
                           "precipitation": [0.0, 0.0, rain["peak"], 5.0, 0.0, 0.0, 0.0, 0.0, 0.0]}}
        return httpx.Response(200, json=[item] * n if n > 1 else item)

    monkeypatch.setattr(dem, "fetcher", fetch_tile)
    monkeypatch.setattr(open_meteo_access, "fetch", fetch)
    monkeypatch.setattr(reports_api, "store_override", None)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    yield {"calls": calls, "rain": rain}
    W.clear_cache()
    dem.clear_cache()


@pytest.mark.asyncio
async def test_rain_on_a_bowl_puts_the_highest_risk_at_the_bottom(world):
    res = await W.fetch_waterlogging(**BOX, now=T0)
    assert res.experimental and "not official IMD" in res.note and "Experimental" in res.note
    assert res.window_start == "2026-11-09T07:00:00Z" and res.window_end == "2026-11-09T16:00:00Z"
    assert res.reports_used is False
    by_cell = {c.cell: c for c in res.cells}
    bottom = by_cell[h3.latlng_to_cell(*BOWL, W.RES)]
    assert bottom.level == "high" and bottom.parts.low_m > 5
    assert bottom.parts.rain_mm == 25.0 and bottom.parts.peak_mm_h == 20.0
    # the rim (higher ground) scores lower than the bottom
    rim = [c for c in res.cells if c.parts.low_m is not None and c.parts.low_m < 0]
    assert rim and max(c.score for c in rim) < bottom.score
    assert world["calls"]["rain"] == 1  # one batched Open-Meteo request
    # cached: a second look asks nobody
    await W.fetch_waterlogging(**BOX, now=T0)
    assert world["calls"]["rain"] == 1


@pytest.mark.asyncio
async def test_dry_means_no_risk_and_no_terrain_download(world, monkeypatch):
    async def dry(service, params, timeout):
        n = len(params["latitude"].split(","))
        item = {"hourly": {"time": [int(T0.timestamp()) + 3600 * i for i in range(9)], "precipitation": [0.0] * 9}}
        return httpx.Response(200, json=[item] * n if n > 1 else item)

    monkeypatch.setattr(open_meteo_access, "fetch", dry)
    res = await W.fetch_waterlogging(**BOX, now=T0)
    assert res.cells == [] and res.cells_checked > 100
    assert world["calls"]["dem"] == 0


@pytest.mark.asyncio
async def test_community_reports_raise_the_estimate(world, monkeypatch):
    store = MemoryStore()
    spot = (18.57, 73.80)  # high ground, away from the bowl
    for i in range(2):
        await store.insert(ReportRow(id=f"r{i}", user_id=f"u{i}", kind="waterlogging", latitude=spot[0],
                                     longitude=spot[1], created_at=T0 - timedelta(minutes=30),
                                     expires_at=T0 - timedelta(minutes=30) + LIFETIME["waterlogging"],
                                     model_agreement=1.0, reporter_accuracy=0.5))
    before = {c.cell: c.score for c in (await W.fetch_waterlogging(**BOX, now=T0)).cells}
    monkeypatch.setattr(reports_api, "store_override", store)
    res = await W.fetch_waterlogging(**BOX, now=T0)
    assert res.reports_used is True
    cell = h3.latlng_to_cell(*spot, W.RES)
    after = {c.cell: c for c in res.cells}
    assert after[cell].parts.reports == 2
    assert after[cell].score > before.get(cell, 0)


def test_api_box_limits_and_outage(world, monkeypatch):
    r = client.get("/api/map/waterlogging", params={"south": 18, "west": 73, "north": 19, "east": 74})
    assert r.status_code == 422 and "Zoom in" in r.json()["detail"]
    r = client.get("/api/map/waterlogging", params=BOX)
    assert r.status_code == 200 and r.json()["experimental"] is True
    assert r.json()["levels"] == [{"level": n, "from_score": s} for n, s in th.WATERLOG_LEVELS]

    async def down(service, params, timeout):
        raise httpx.ConnectError("down")

    W.clear_cache()
    monkeypatch.setattr(open_meteo_access, "fetch", down)
    r = client.get("/api/map/waterlogging", params=BOX)
    assert r.status_code == 503


@pytest.mark.asyncio
async def test_terrain_outage_falls_back_to_rain_and_reports(world, monkeypatch):
    async def broken(key):
        raise RuntimeError("s3 down")

    monkeypatch.setattr(dem, "fetcher", broken)
    res = await W.fetch_waterlogging(**BOX, now=T0)
    assert res.cells and all(c.parts.low_m is None for c in res.cells)
    # without terrain every cell is treated as level ground: 0.4 x the rain factor
    assert {c.score for c in res.cells} == {round(0.4 * W.rain_factor(25.0, 20.0), 3)}
