"""
Generate the frontend's WMO weather-description table from the backend's.

The backend tables (``query_service.WMO_DESCRIPTIONS`` for English and
``llm.weather_codes.WMO_DESCRIPTIONS_I18N`` for hi / hinglish / mr) are the
ONLY source. This writes ``weathergpt-web/lib/i18n/weatherCodes.generated.ts``
so the UI shows the same words as chat replies. ``tests/test_weather_codes_export.py``
fails if the generated file is out of date, so the two cannot drift apart.

Regenerate after editing either table (from the repo root):

    backend/.venv/Scripts/python backend/llm/export_weather_codes.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from llm.weather_codes import WMO_DESCRIPTIONS_I18N  # noqa: E402
from query_service import WMO_DESCRIPTIONS  # noqa: E402

OUTPUT = BACKEND.parent / "weathergpt-web" / "lib" / "i18n" / "weatherCodes.generated.ts"
LANGUAGES = ("en", "hi", "hinglish", "mr")


def tables() -> dict[str, dict[str, str]]:
    out = {"en": {str(k): v for k, v in sorted(WMO_DESCRIPTIONS.items())}}
    for lang in LANGUAGES[1:]:
        out[lang] = {str(k): v for k, v in sorted(WMO_DESCRIPTIONS_I18N[lang].items())}
    return out


def render() -> str:
    body = json.dumps(tables(), ensure_ascii=False, indent=2)
    return (
        "// GENERATED FILE: do not edit by hand.\n"
        "// Source: backend/query_service.py (WMO_DESCRIPTIONS, English) and\n"
        "// backend/llm/weather_codes.py (WMO_DESCRIPTIONS_I18N: hi, hinglish, mr).\n"
        "// Regenerate: backend/.venv/Scripts/python backend/llm/export_weather_codes.py\n"
        "// tests/test_weather_codes_export.py fails if this file is out of date.\n"
        "\n"
        "export type WeatherCodeLanguage = 'en' | 'hi' | 'hinglish' | 'mr'\n"
        "\n"
        f"export const WMO_DESCRIPTIONS: Record<WeatherCodeLanguage, Record<string, string>> = {body}\n"
    )


def main() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(render(), encoding="utf-8", newline="\n")
    print(f"wrote {OUTPUT.relative_to(BACKEND.parent)}")


if __name__ == "__main__":
    main()
