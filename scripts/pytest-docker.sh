#!/usr/bin/env bash
# Backend pytest in a Linux container. For Windows PCs where Smart App Control
# blocks h3's unsigned native library (docs/WINDOWS_DEV.md); run it from Git Bash.
# Mirrors the CI backend job: python 3.11, pip install -r backend/requirements.txt,
# pytest tests/ -q. The repo is mounted read-only; the virtualenv and pip cache
# live in named volumes, so reruns start in seconds. Extra arguments go to pytest.
ROOT="$(cd "$(dirname "$0")/.." && { pwd -W 2>/dev/null || pwd; })"
MSYS_NO_PATHCONV=1 docker run --rm \
  -v "$ROOT:/src:ro" -v wgpt-pip-cache:/root/.cache/pip -v wgpt-venv:/venv \
  -e PYTHONDONTWRITEBYTECODE=1 -e PYTHONIOENCODING=utf-8 -w /src python:3.11-slim-bookworm \
  sh -c '[ -x /venv/bin/python ] || python -m venv /venv; cmp -s /src/backend/requirements.txt /venv/req.txt || { /venv/bin/pip install -q -r /src/backend/requirements.txt && cp /src/backend/requirements.txt /venv/req.txt; }; /venv/bin/python -m pytest "${@:-tests/}" -q -rf -p no:cacheprovider' sh "$@"
