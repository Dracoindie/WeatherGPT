"""
The hazard card's "Ask about this area" questions (weathergpt-web I18nContext,
keys ask.area.* and ask.day.*) must be understood by the chat parser in every
language: a forecast for the right day, the right parameter, and no place name
(the hex coordinates come with the link and are used as the location).
The strings are read from the UI dictionary, so the test follows any edit.
"""

from __future__ import annotations

import asyncio
import re
from pathlib import Path

import pytest

from llm.query_parser import parse_query

I18N = Path(__file__).resolve().parents[1] / "weathergpt-web" / "context" / "I18nContext.tsx"
LANGS = ("en", "hi", "mr", "hinglish")  # the order of the dictionaries in the file

DAY_REF = {"today": "today", "tomorrow": "tomorrow", "dayAfter": "day_after_tomorrow"}
PARAMS = {
    "rain": {"heavy_rain", "precipitation"},
    "heat": {"high_temperature"},
    "wind": {"strong_wind", "wind"},
    "storm": {"storm"},
    "cold": {"temperature"},
    "none": {"general"},
}


def _values(key: str) -> list[str]:
    text = I18N.read_text(encoding="utf-8")
    vals = re.findall(rf"^\s*'{re.escape(key)}': '((?:[^'\\]|\\.)*)',$", text, flags=re.M)
    assert len(vals) == 4, (key, len(vals))
    return [v.replace("\\'", "'") for v in vals]


CASES = [(i, lang, focus, day) for i, lang in enumerate(LANGS) for focus in PARAMS for day in DAY_REF]


@pytest.mark.parametrize("i,lang,focus,day", CASES)
def test_area_questions_parse(i, lang, focus, day):
    question = _values(f"ask.area.{focus}")[i].replace("{day}", _values(f"ask.day.{day}")[i])
    question = question[0].upper() + question[1:]
    intent = asyncio.run(parse_query(question))
    assert intent.intent == "forecast", question
    assert intent.date_reference == DAY_REF[day], question
    assert intent.weather_parameter in PARAMS[focus], (question, intent.weather_parameter)
    assert intent.location_name is None, (question, intent.location_name)
    assert intent.language == lang, (question, intent.language)
