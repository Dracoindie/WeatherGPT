"""Deployment files stay safe: one worker, no secrets in the image, Blueprint or logs."""

from pathlib import Path

import yaml
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
SECRET_KEYS = {"SUPABASE_SERVICE_ROLE_KEY", "VAPID_PRIVATE_KEY", "ALERT_JOB_TOKEN", "SUPABASE_ANON_KEY"}


def test_health_reports_nwp_availability():
    from main import app, nwp_router

    body = TestClient(app).get("/health").json()
    assert body["status"] == "ok"
    assert body["nwp"] is (nwp_router is not None)


def test_dockerfile_runs_one_uvicorn_worker_on_port_env():
    text = (ROOT / "backend" / "Dockerfile").read_text(encoding="utf-8")
    cmd = next(line for line in text.splitlines() if line.startswith("CMD"))
    assert "--workers 1" in cmd  # in-memory push rate limit + Nominatim spacing
    assert "${PORT" in cmd
    assert "ARG WITH_NWP=1" in text
    assert "USER app" in text


def test_lite_image_drops_every_nwp_requirement():
    """WITH_NWP=0 must filter out each NWP pin in requirements.txt, or the lite image grows."""
    import re

    text = (ROOT / "backend" / "Dockerfile").read_text(encoding="utf-8")
    pattern = re.search(r"grep -vE '(\^\([^']+\)==)' /tmp/req.txt", text).group(1)
    reqs = (ROOT / "backend" / "requirements.txt").read_text(encoding="utf-8").splitlines()
    nwp = [line for line in reqs if line.split("==")[0] in {"xarray", "cfgrib", "eccodes", "eccodeslib"}]
    assert len(nwp) == 4
    assert all(re.match(pattern, line) for line in nwp)


def test_dockerignore_keeps_secrets_and_venv_out():
    lines = set((ROOT / "backend" / ".dockerignore").read_text(encoding="utf-8").split())
    assert {".env", ".env.*", ".venv/", "data/"} <= lines


def test_render_blueprint_has_no_secret_values():
    spec = yaml.safe_load((ROOT / "render.yaml").read_text(encoding="utf-8"))
    (svc,) = spec["services"]
    assert svc["healthCheckPath"] == "/health"
    assert svc["rootDir"] == "backend"
    for var in svc["envVars"]:
        if var["key"] in SECRET_KEYS:
            assert "value" not in var, var["key"]
            assert var.get("sync") is False or var.get("generateValue") is True


def test_alert_workflow_uses_secret_and_hides_subscription_ids():
    wf = (ROOT / ".github" / "workflows" / "alert-job.yml").read_text(encoding="utf-8")
    spec = yaml.safe_load(wf)
    assert spec[True]["schedule"][0]["cron"] == "*/15 * * * *"  # YAML 1.1 reads `on:` as True
    assert "${{ secrets.ALERT_JOB_TOKEN }}" in wf
    assert "X-Job-Token: $ALERT_JOB_TOKEN" in wf
    assert "del(.details)" in wf
    assert "cat report.json" not in wf


def test_ci_workflow_runs_all_checks():
    wf = (ROOT / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")
    for step in ("python -m pytest tests/", "npx eslint", "npm run build", "npx playwright test"):
        assert step in wf
    for secret in SECRET_KEYS - {"SUPABASE_ANON_KEY"}:
        assert secret not in wf
