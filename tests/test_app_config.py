"""App wiring: optional NWP router, configurable CORS origins, dotenv loading.

Each check imports ``main`` in a fresh interpreter so module state (and the
patches other tests apply to ``main``/``api.nwp``) is never disturbed.
"""

import json
import os
import subprocess
import sys
import textwrap

import pytest

BACKEND = os.path.join(os.path.dirname(__file__), "..", "backend")

_BLOCKER = """
import sys

class _Block:
    def find_spec(self, name, path=None, target=None):
        if name == BLOCKED or name.startswith(BLOCKED + "."):
            raise ERROR("blocked for test: " + name)
        return None

if BLOCKED:
    sys.meta_path.insert(0, _Block())
"""


def _run(body: str, blocked: str = "", error: str = "ImportError", env: dict | None = None) -> dict:
    script = (
        f"BLOCKED = {blocked!r}\nERROR = {error}\n"
        + _BLOCKER
        + f"sys.path.insert(0, {os.path.abspath(BACKEND)!r})\n"
        + textwrap.dedent(body)
    )
    full_env = {**os.environ, **(env or {})}
    out = subprocess.run(
        [sys.executable, "-c", script], capture_output=True, text=True, env=full_env, timeout=120
    )
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout.strip().splitlines()[-1])


PATHS = """
import json
import main
print(json.dumps({"paths": sorted(main.app.openapi()["paths"]), "nwp": main.nwp_router is not None}))
"""


def test_nwp_router_registered_when_available():
    result = _run(PATHS)
    assert result["nwp"] is True
    assert "/api/nwp" in result["paths"]


@pytest.mark.parametrize(
    "blocked, error",
    [("xarray", "ImportError"), ("cfgrib", "ImportError"), ("cfgrib", "RuntimeError")],
)
def test_api_starts_without_nwp_dependencies(blocked, error):
    # RuntimeError is what cfgrib raises when the eccodes library is missing.
    result = _run(PATHS, blocked=blocked, error=error)
    assert result["nwp"] is False
    assert {"/api/chat", "/api/weather", "/health"} <= set(result["paths"])


def test_nwp_returns_clean_503_when_unavailable():
    result = _run(
        """
        import json
        from fastapi.testclient import TestClient
        import main
        resp = TestClient(main.app).get("/api/nwp?latitude=18.5&longitude=73.8&hours=24")
        print(json.dumps({"status": resp.status_code, "body": resp.json()}))
        """,
        blocked="cfgrib",
        error="RuntimeError",
    )
    assert result == {"status": 503, "body": {"detail": "NWP unavailable", "available": False}}


def test_default_cors_origins(monkeypatch):
    monkeypatch.delenv("ALLOWED_ORIGINS", raising=False)
    import main

    assert main.allowed_origins() == ["http://localhost:3000", "http://127.0.0.1:3000"]


def test_cors_origins_from_env(monkeypatch):
    monkeypatch.setenv("ALLOWED_ORIGINS", " https://a.example.com/, https://b.example.com ,,")
    import main

    assert main.allowed_origins() == ["https://a.example.com", "https://b.example.com"]


def test_cors_header_uses_configured_origin():
    result = _run(
        """
        import json
        from fastapi.testclient import TestClient
        import main
        client = TestClient(main.app)
        ok = client.get("/health", headers={"Origin": "https://demo.example.com"})
        other = client.get("/health", headers={"Origin": "http://localhost:3000"})
        print(json.dumps({
            "ok": ok.headers.get("access-control-allow-origin"),
            "other": other.headers.get("access-control-allow-origin"),
        }))
        """,
        env={"ALLOWED_ORIGINS": "https://demo.example.com"},
    )
    assert result == {"ok": "https://demo.example.com", "other": None}


def test_backend_env_file_is_loaded():
    result = _run(
        """
        import json
        from unittest.mock import patch
        with patch("dotenv.load_dotenv") as load:
            import main
        path = load.call_args.args[0]
        print(json.dumps({"name": path.name, "parent": path.parent.name}))
        """
    )
    assert result == {"name": ".env", "parent": "backend"}
