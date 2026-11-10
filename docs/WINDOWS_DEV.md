# Windows development note: Smart App Control and the Docker workaround

This applies only to development on a Windows 11 PC with **Smart App Control** switched on. CI, Render, Linux, macOS and WSL are not affected, and nothing in the app changes.

## What happens

`h3` (hexagons for the hazard map and the waterlogging estimate) ships a native library that is not code-signed. Since 2026-11-09 Smart App Control on the development PC refuses to load it, so on Windows:

- `backend/.venv/Scripts/python -m pytest tests/ -q` fails while importing `h3`;
- the backend itself (`uvicorn backend.main:app`) fails the same way.

**Smart App Control stays on.** Windows cannot switch it back on without a reinstall, so it is not turned off for this project. The backend runs in Docker (Linux) on this PC instead.

## Backend tests

From Git Bash, in the repo root (Docker Desktop running):

```bash
bash scripts/pytest-docker.sh                      # the whole suite, as CI runs it
bash scripts/pytest-docker.sh tests/test_reports.py   # one file
```

It uses `python:3.11-slim-bookworm`, installs `backend/requirements.txt` into a named volume the first time (a few minutes; later runs start in seconds) and mounts the repo read-only. The tests are fully mocked and need no network once the packages are installed. This is the "Backend tests" check in `CLAUDE.md` on this PC.

## A live backend for the frontend

```bash
docker build -t weathergpt-api:local backend
docker run -d --name wgpt-live -p 8000:8000 weathergpt-api:local
curl localhost:8000/health
docker stop wgpt-live && docker rm wgpt-live       # when done: it holds memory
```

Started like this the container has no secrets, so Supabase features (trusted default location, test push, community reports) answer "not set up". To use them, pass your own env file with `--env-file` (the file stays on your PC; never commit it).

Stop `wgpt-live` before a full check run: with Docker, a build and Playwright together the PC runs out of memory, and then Playwright tests time out for no reason of their own. Run Playwright with `--workers=1` here.

## Frontend

Not affected: `npx eslint`, `npm run build`, `npm run build:e2e` and Playwright run on Windows as before.
