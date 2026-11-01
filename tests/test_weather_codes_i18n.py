"""WMO weather descriptions in Hindi, Hinglish and Marathi replies."""

from __future__ import annotations

import os
import re
import sys
from unittest.mock import AsyncMock, patch

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from llm.response_generator import generate_response, is_grounded, template_response
from llm.weather_codes import WMO_DESCRIPTIONS_I18N, localized_description
from models.chat import ChatIntent, WeatherFacts
from query_service import WMO_DESCRIPTIONS, weather_code_description
from test_chat import chat_patches, post_chat, sample_weather

LANGS = ("hi", "hinglish", "mr")
LATIN = re.compile(r"[A-Za-z]")


def _facts(code: int, **kw) -> WeatherFacts:
    base = dict(
        source="open-meteo",
        location="Pune",
        requested_time="now",
        timezone="Asia/Kolkata",
        temperature_2m=27.0,
        wind_speed_10m=14.0,
        precipitation=1.2,
        weather_code=code,
        weather_description=weather_code_description(code),
        period_available=True,
    )
    base.update(kw)
    return WeatherFacts(**base)


def _intent(language: str, parameter: str = "general") -> ChatIntent:
    return ChatIntent(intent="forecast", location_name="Pune", date_reference="now", weather_parameter=parameter, language=language)


def _strip_allowed_latin(text: str) -> str:
    """Remove what may stay in Latin script in a Devanagari reply: place, source, units."""
    for allowed in ("Pune", "Open-Meteo", "°C"):
        text = text.replace(allowed, "")
    return text


@pytest.mark.parametrize("language", LANGS)
def test_every_wmo_code_is_translated(language):
    table = WMO_DESCRIPTIONS_I18N[language]
    assert set(table) == set(WMO_DESCRIPTIONS)
    for code, text in table.items():
        assert text and text != WMO_DESCRIPTIONS[code]
        if language == "hinglish":
            assert text == text.lower() and text.isascii(), (code, text)
        else:
            assert not LATIN.search(text), (code, text)


@pytest.mark.parametrize("language", LANGS)
def test_translations_are_distinct_per_code(language):
    texts = list(WMO_DESCRIPTIONS_I18N[language].values())
    assert len(texts) == len(set(texts))


@pytest.mark.parametrize("code", sorted(WMO_DESCRIPTIONS))
@pytest.mark.parametrize("parameter", ["general", "storm"])
def test_devanagari_replies_have_no_english_description(code, parameter):
    for language in ("hi", "mr"):
        facts = _facts(code)
        reply = template_response(_intent(language, parameter), facts)
        assert WMO_DESCRIPTIONS_I18N[language][code] in reply
        assert not LATIN.search(_strip_allowed_latin(reply)), reply
        assert is_grounded(reply, facts)


@pytest.mark.parametrize("code", sorted(WMO_DESCRIPTIONS))
def test_hinglish_reply_uses_romanised_hindi(code):
    facts = _facts(code, precipitation=None)  # the template's own "rain 1.2 mm" is not a description
    reply = template_response(_intent("hinglish"), facts)
    assert WMO_DESCRIPTIONS_I18N["hinglish"][code] in reply
    assert WMO_DESCRIPTIONS[code].lower() not in reply
    assert is_grounded(reply, facts)


def test_english_reply_unchanged():
    reply = template_response(_intent("en"), _facts(55))
    assert "dense drizzle" in reply


def test_examples():
    assert localized_description(55, "Dense drizzle", "hi") == "तेज़ बूँदाबाँदी"
    assert localized_description(55, "Dense drizzle", "hinglish") == "tez boondabaandi"
    assert localized_description(55, "Dense drizzle", "mr") == "जोरदार रिमझिम"
    assert localized_description(55, "Dense drizzle", "en") == "Dense drizzle"


def test_falls_back_to_english_lookup_without_code():
    assert localized_description(None, "Thunderstorm", "mr") == "गडगडाटी वादळ"


def test_unknown_code_keeps_the_english_text():
    assert localized_description(42, "Weather code 42", "hi") == "Weather code 42"
    assert localized_description(None, None, "hi") is None


@pytest.mark.asyncio
async def test_llm_is_given_the_localised_wording():
    complete = AsyncMock(return_value="पुणे में तेज़ बूँदाबाँदी है।")
    with patch("llm.provider.is_configured", return_value=True), patch("llm.provider.complete_text", complete):
        reply = await generate_response(_intent("hi"), _facts(55))
    assert reply == "पुणे में तेज़ बूँदाबाँदी है।"
    payload = complete.call_args.args[1]
    assert "Use this wording for weather_description: तेज़ बूँदाबाँदी" in payload


@pytest.mark.parametrize(
    "message,expected",
    [
        ("पुणे में मौसम कैसा है?", "तेज़ बूँदाबाँदी"),
        ("Pune ka weather kaisa hai?", "tez boondabaandi"),
        ("पुण्यात आज हवामान कसे आहे?", "जोरदार रिमझिम"),
    ],
)
def test_chat_reply_end_to_end(message, expected):
    weather = sample_weather(hourly_code=55)
    weather.current.weather_code = 55
    patches = chat_patches(weather=weather)
    with patches[0], patches[1], patches[2], patches[3]:
        body = post_chat(message).json()
    assert expected in body["message"]
    assert "drizzle" not in body["message"].lower()
    assert body["weather"]["weather_description"] == "Dense drizzle"  # the API field stays English
