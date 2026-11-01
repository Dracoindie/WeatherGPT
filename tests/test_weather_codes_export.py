"""The frontend WMO table is generated from the backend tables and must match them."""

from llm import export_weather_codes as gen
from llm.weather_codes import WMO_DESCRIPTIONS_I18N
from query_service import WMO_DESCRIPTIONS


def test_generated_frontend_table_is_up_to_date():
    on_disk = gen.OUTPUT.read_text(encoding="utf-8").replace("\r\n", "\n")
    assert on_disk == gen.render(), (
        "weathergpt-web/lib/i18n/weatherCodes.generated.ts is stale; run "
        "backend/.venv/Scripts/python backend/llm/export_weather_codes.py"
    )


def test_every_language_covers_every_english_code():
    for lang in ("hi", "hinglish", "mr"):
        assert set(WMO_DESCRIPTIONS_I18N[lang]) == set(WMO_DESCRIPTIONS), lang
    assert set(gen.tables()) == {"en", "hi", "hinglish", "mr"}
