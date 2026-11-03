# WeatherGPT backend (FastAPI) for Render, Railway or any Docker host.
#
#   docker build -t weathergpt-api backend                     # with GFS (NWP)
#   docker build -t weathergpt-api --build-arg WITH_NWP=0 backend   # lighter, /api/nwp -> 503
#   docker run -p 8000:8000 --env-file backend/.env weathergpt-api
#
# Secrets are never baked in: pass them as host environment variables.

FROM python:3.11-slim-bookworm

# 1 = install xarray + cfgrib so /api/nwp and /api/compare work. On Linux, pip
#     brings the ecCodes C library as the `eccodeslib` wheel, so no apt package.
# 0 = skip them; the API still starts and /api/nwp answers a clean 503.
ARG WITH_NWP=1

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PORT=8000

WORKDIR /app

COPY requirements.txt .
# Production install: drop the test tools, and the NWP stack when WITH_NWP=0.
RUN grep -vE '^(pytest|pytest-asyncio|segno)==' requirements.txt > /tmp/req.txt \
    && if [ "$WITH_NWP" != "1" ]; then grep -vE '^(xarray|cfgrib|eccodes|eccodeslib)==' /tmp/req.txt > /tmp/req2.txt && mv /tmp/req2.txt /tmp/req.txt; fi \
    && pip install -r /tmp/req.txt \
    && rm /tmp/req.txt

COPY . .

# Non-root user; data/ holds the geocode cache (ephemeral on free hosts, rebuilt on demand).
RUN useradd --create-home --uid 10001 app \
    && mkdir -p /app/data \
    && chown -R app:app /app
USER app

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import os, urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\", \"8000\")}/health', timeout=4)" || exit 1

# One worker on purpose: the push-test rate limit and the Nominatim 1 request/s
# spacing live in process memory (docs/EARLY_WARNING.md). Render/Railway set $PORT.
# --proxy-headers: the host's load balancer terminates HTTPS.
CMD ["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1 --proxy-headers --forwarded-allow-ips='*'"]
