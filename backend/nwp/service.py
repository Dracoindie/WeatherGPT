import httpx
import asyncio
import logging
import os
import tempfile
import threading
from datetime import datetime, timezone, timedelta
from typing import List
import xarray as xr
from .models import NwpMetadata, NwpForecast, NwpResponse
from http_tls import SSL_CONTEXT

logger = logging.getLogger(__name__)

# NOMADS GRIB filter – current operational GFS 0.25° endpoint
GRIB_FILTER_URL = "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl"


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

    surf_resp, wind_resp = await asyncio.gather(
        client.get(surface_url),
        client.get(wind_url),
    )
    surf_resp.raise_for_status()
    wind_resp.raise_for_status()

    result: dict = {}
    # cfgrib decoding is CPU-bound and blocking: run it in a worker thread so the
    # event loop (and every other request, e.g. /api/alerts) keeps moving.
    for content in (surf_resp.content, wind_resp.content):
        if content:
            result.update(await asyncio.to_thread(_decode_grib, content))
    return result




async def get_nwp_forecast(latitude: float, longitude: float, hours: int = 24) -> NwpResponse:
    """Fetch GFS NWP data via NOMADS GRIB filter for a point.

    Parameters
    ----------
    latitude, longitude: float – requested location.
    hours: int – number of forecast hours (max 48).

    Raises on upstream failure; the API layer converts this to HTTP 502.
    """
    if not (1 <= hours <= 48):
        raise ValueError("hours must be between 1 and 48")

    now = datetime.utcnow().replace(tzinfo=timezone.utc)
    hour = (now.hour // 6) * 6
    candidate_run = now.replace(hour=hour, minute=0, second=0, microsecond=0)
    
    run = None
    results = None

    async with httpx.AsyncClient(timeout=45.0, verify=SSL_CONTEXT) as client:
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
    return NwpResponse(metadata=metadata, forecasts=forecasts)

