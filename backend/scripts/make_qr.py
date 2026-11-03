"""
QR code (PNG + SVG) for a URL, e.g. the deployed WeatherGPT link, into docs/qr/.

    backend\\.venv\\Scripts\\python backend\\scripts\\make_qr.py https://weathergpt.example.app
    backend\\.venv\\Scripts\\python backend\\scripts\\make_qr.py https://… --name judges --scale 12

Needs `segno` (pure Python, no dependencies), which is not pinned in
requirements.txt yet: `pip install segno` until it is approved and pinned.
Error correction "Q" (25%) so a printed code still scans if partly covered.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

OUT_DIR = Path(__file__).resolve().parents[2] / "docs" / "qr"


def main() -> int:
    ap = argparse.ArgumentParser(description="QR code PNG and SVG for a URL, into docs/qr/.")
    ap.add_argument("url", help="https://… link to encode")
    ap.add_argument("--name", help="file name without extension (default: from the host name)")
    ap.add_argument("--scale", type=int, default=10, help="pixels per module in the PNG (default 10)")
    args = ap.parse_args()

    parsed = urlparse(args.url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        print(f"Not a http(s) URL: {args.url!r}", file=sys.stderr)
        return 2

    try:
        import segno
    except ImportError:
        print("segno is not installed. Run: backend\\.venv\\Scripts\\pip install segno", file=sys.stderr)
        return 1

    name = args.name or re.sub(r"[^A-Za-z0-9-]+", "-", parsed.netloc).strip("-") or "weathergpt"
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    qr = segno.make(args.url, error="q", micro=False)
    png, svg = OUT_DIR / f"{name}.png", OUT_DIR / f"{name}.svg"
    qr.save(png, scale=args.scale, border=4)
    qr.save(svg, scale=args.scale, border=4, title=f"WeatherGPT: {args.url}")
    print(f"{png}\n{svg}\n(version {qr.version}, error correction {qr.error})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
