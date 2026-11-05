import httpx
import asyncio
import logging
import os
import tempfile
import threading
import time
from datetime import datetime, timezone, timedelta
from typing import List
import xarray as xr
from .models import NwpMetadata, NwpForecast, NwpResponse
from http_tls import SSL_CONTEXT

logger = logging.getLogger(__name__)

# NOMADS GRIB filter – current operational GFS 0.25° endpoint
GRIB_FILTER_URL = "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl"

# A GFS cycle runs every 6 h: one fetch per point and hour count per hour is
# plenty. After that the result is kept as "last good" for STALE_MAX_S and
# served, marked stale, when NOMADS fails.
FRESH_S = 60 * 60
STALE_MAX_S = 24 * 60 * 60
CACHE_MAX = 200
# NOMADS throttles bursts: at most this many GRIB filter requests at once
# (24 forecast hours = 48 requests, so they queue instead of firing together).
MAX_CONCURRENT = 6
# The whole fetch, including falling back to older runs.
TOTAL_TIMEOUT_S = 90.0


class NwpUnavailable(RuntimeError):
    """GFS could not be fetched and there is no last good result. ``reason`` says why."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


_cache: dict[tuple, tuple[float, "NwpResponse"]] = {}


def clear_cache() -> None:
    _cache.clear()


def _latest_run_timestamp() -> datetime:
    """Return the most recent GFS run timestamp (00, 06, 12, 18 UTC)."""
    now = datetime.utcnow().replace(tzinfo=timezone.utc)
    hour = (now.hour // 6) * 6
    run = now.replace(hour=hour, minute=0, second=0, microsecond=0)
    if run > now:
        run -= timedelta(hours=6)
    return run


def _build_surface_url(run: datetime, forecast_hour: int, latitude: float, longitude: float) -> str:
    """GRIB filter URL for TMP (2m) and APCP (surface precipitation)."""
    date_str = run.strftime("%Y%m%d")
    run_hour = run.strftime("%H")
    file_name = f"gfs.t{run_hour}z.pgrb2.0p25.f{forecast_hour:03d}"
    directory = f"/gfs.{date_str}/{run_hour}/atmos"
    left_lon = round(longitude - 0.25, 3)
    right_lon = round(longitude + 0.25, 3)
    top_lat = round(latitude + 0.25, 3)
    bottom_lat = round(latitude - 0.25, 3)
    params = (
        f"file={file_name}"
        f"&var_TMP=on&lev_2_m_above_ground=on"
        f"&var_APCP=on&lev_surface=on"
        f"&subregion=&leftlon={left_lon}&rightlon={right_lon}"
        f"&toplat={top_lat}&bottomlat={bottom_lat}"
        f"&dir={directory}"
    )
    return f"{GRIB_FILTER_URL}?{params}"


def _build_wind_url(run: datetime, forecast_hour: int, latitude: float, longitude: float) -> str:
    """GRIB filter URL for UGRD + VGRD at 10m."""
    date_str = run.strftime("%Y%m%d")
    run_hour = run.strftime("%H")
    file_name = f"gfs.t{run_hour}z.pgrb2.0p25.f{forecast_hour:03d}"
    directory = f"/gfs.{date_str}/{run_hour}/atmos"
    left_lon = round(longitude - 0.25, 3)
    right_lon = round(longitude + 0.25, 3)
    top_lat = round(latitude + 0.25, 3)
    bottom_lat = round(latitude - 0.25, 3)
    params = (
        f"file={file_name}"
        f"&var_UGRD=on&var_VGRD=on&lev_10_m_above_ground=on"
        f"&subregion=&leftlon={left_lon}&rightlon={right_lon}"
        f"&toplat={top_lat}&bottomlat={bottom_lat}"
        f"&dir={directory}"
    )
    return f"{GRIB_FILTER_URL}?{params}"



# eccodes is not documented as thread-safe; decode one file at a time.
_DECODE_LOCK = threading.Lock()


def _decode_grib(content: bytes) -> dict:
    """Mean of each variable in a GRIB2 subset. Blocking; call via asyncio.to_thread."""
    result: dict = {}
    tmp_fd, tmp_path = tempfile.mkstemp(suffix=".grib2")
    try:
        with os.fdopen(tmp_fd, "wb") as f:
            f.write(content)
        with _DECODE_LOCK:
            ds = xr.open_dataset(tmp_path, engine="cfgrib", backend_kwargs={"indexpath": ""})
            try:
                for var_name in ds.data_vars:
                    result[var_name] = float(ds[var_name].values.mean())
            finally:
                ds.close()
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
    return result


async def _fetch_hour_grib(
    client: httpx.AsyncClient,
    run: datetime,
    hour_offset: int,
    latitude: float,
    longitude: float,
) -> dict:
    """Fetch GFS data for one forecast hour.

    Makes two GRIB filter requests (surface/2m and 10m wind) so each GRIB2
    file contains a single level — avoiding cfgrib's heightAboveGround conflict.
    """
    surface_url = _build_surface_url(run, hour_offset, latitude, longitude)
    wind_url = _build_wind_url(run, hour_offset, latitude, longitude)

    gate = getattr(client, "_wgpt_gate", None)
    if gate is None:
        surf_resp, wind_resp = await asyncio.gather(client.get(surface_url), client.get(wind_url))
    else:
        async def get(url: str) -> httpx.Response:
            async with gate:
                return await client.get(url)

        surf_resp, wind_resp = await asyncio.gather(get(surface_url), get(wind_url))
    surf_resp.raise_for_status()
    wind_resp.raise_for_status()

    result: dict = {}
    # cfgrib decoding is CPU-bound and blocking: run it in a worker thread so the
    # event loop (and every other request, e.g. /api/alerts) keeps moving.
    for content in (surf_resp.content, wind_resp.content):
        if content:
            result.update(await asyncio.to_thread(_decode_grib, content))
    return result




def _reason(exc: BaseException) -> str:
    """A short, safe reason for the UI and logs (never a URL or a stack)."""
    if isinstance(exc, (httpx.TimeoutException, asyncio.TimeoutError, TimeoutError)):
        return "NOMADS did not answer in time"
    if isinstance(exc, httpx.HTTPStatusError):
        return f"NOMADS returned HTTP {exc.response.status_code}"
    if isinstance(exc, httpx.RequestError):
        return "NOMADS could not be reached"
    if isinstance(exc, RuntimeError) and "GFS runs" in str(exc):
        return "no recent GFS run is fully published yet"
    return "GFS data could not be decoded"


async def get_nwp_forecast(latitude: float, longitude: float, hours: int = 24) -> NwpResponse:
    """GFS for a point: cached for FRESH_S; on a NOMADS failure the last good
    result (up to STALE_MAX_S old) marked ``stale``; otherwise NwpUnavailable."""
    if not (1 <= hours <= 48):
        raise ValueError("hours must be between 1 and 48")
    key = (round(latitude, 2), round(longitude, 2), hours)
    now = time.monotonic()
    hit = _cache.get(key)
    if hit and now - hit[0] < FRESH_S:
        return hit[1]
    try:
        fresh = await asyncio.wait_for(_fetch_nwp_forecast(latitude, longitude, hours), TOTAL_TIMEOUT_S)
    except Exception as exc:  # any upstream or decoding failure
        reason = _reason(exc)
        logger.warning("GFS fetch failed for %s: %s (%s)", key, reason, type(exc).__name__)
        if hit and now - hit[0] < STALE_MAX_S:
            return hit[1].model_copy(update={"stale": True, "staleReason": reason})
        raise NwpUnavailable(reason) from exc
    if len(_cache) >= CACHE_MAX and key not in _cache:
        _cache.pop(next(iter(_cache)))
    _cache[key] = (now, fresh)
    return fresh


async def _fetch_nwp_forecast(latitude: float, longitude: float, hours: int) -> NwpResponse:
    """Fetch GFS NWP data via NOMADS GRIB filter for a point (no cache). Raises on failure."""

    now = datetime.utcnow().replace(tzinfo=timezone.utc)
    hour = (now.hour // 6) * 6
    candidate_run = now.replace(hour=hour, minute=0, second=0, microsecond=0)
    
    run = None
    results = None

    async with httpx.AsyncClient(timeout=45.0, verify=SSL_CONTEXT) as client:
        client._wgpt_gate = asyncio.Semaphore(MAX_CONCURRENT)  # type: ignore[attr-defined]
        # Try up to 4 recent cycles (last 24 hours)
        for _ in range(4):
            if candidate_run > now:
                candidate_run -= timedelta(hours=6)
                continue
                
            try:
                # Probe availability by fetching the furthest requested hour first.
                # This ensures the run is fully published before fetching the rest.
                last_hour_data = await _fetch_hour_grib(client, candidate_run, hours - 1, latitude, longitude)
                
                # If successful, fetch the remaining hours concurrently
                if hours > 1:
                    tasks = [
                        _fetch_hour_grib(client, candidate_run, h, latitude, longitude)
                        for h in range(hours - 1)
                    ]
                    results = await asyncio.gather(*tasks)
                    # convert list to regular list and append the last hour
                    results = list(results)
                    results.append(last_hour_data)
                else:
                    results = [last_hour_data]
                    
                run = candidate_run
                break
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code == 404:
                    logger.warning("GFS run %s not fully published (404). Falling back.", candidate_run)
                    candidate_run -= timedelta(hours=6)
                else:
                    raise
        else:
            raise RuntimeError("All recent GFS runs are unavailable or incomplete.")

    forecasts: List[NwpForecast] = []
    for i, data in enumerate(results):
        # TMP is 2m temperature in K; APCP is accumulated precipitation in kg/m2
        temp_k = data.get("TMP", data.get("t2m", float("nan")))
        precip = data.get("APCP", data.get("tp", 0.0)) or 0.0
        u10 = data.get("UGRD", data.get("u10", 0.0)) or 0.0
        v10 = data.get("VGRD", data.get("v10", 0.0)) or 0.0

        temp_c = temp_k - 273.15
        wind_ms = (u10 ** 2 + v10 ** 2) ** 0.5

        forecasts.append(NwpForecast(
            hour=i,
            temperatureC=temp_c,
            precipitationMm=float(precip),
            windMs=wind_ms,
        ))

    metadata = NwpMetadata(
        model="GFS",
        generationTime=run.isoformat(),
        latitude=latitude,
        longitude=longitude,
    )
    return NwpResponse(metadata=metadata, forecasts=forecasts, retrievedAt=datetime.now(timezone.utc))

