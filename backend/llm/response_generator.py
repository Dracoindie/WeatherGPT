"""
Grounded natural-language replies.

The model (when configured) receives only verified WeatherFacts.
If no LLM is configured, a deterministic template is used.
If the model emits numbers that are not in the facts, the template wins.
"""

from __future__ import annotations

import logging
import re
from typing import Optional

from models.chat import ChatIntent, ResponseLanguage, WeatherFacts, AdvisoryResult

logger = logging.getLogger(__name__)

_SYSTEM = """You are WeatherGPT, a language interface over verified weather data and deterministic intelligence.

Rules:
- Never invent weather facts.
- Never change retrieved numerical values.
- Never make up a location.
- You must use the provided Intelligence Advisory to explain risks, conditions, or recommendations.
- Never claim an alert exists unless it is in the Intelligence Advisory JSON.
- If period_available is false, say the requested time window is not in the forecast.
- Use only the numbers and place name in the facts JSON.
- Reply in the requested language (en, hi, or hinglish).
- Be concise (1–3 sentences).
- You are not a meteorological data source; Open-Meteo is.
"""


def _fmt(value: Optional[float], digits: int = 1) -> Optional[str]:
    if value is None:
        return None
    if float(value).is_integer():
        return str(int(value))
    return f"{value:.{digits}f}"


def allowed_numbers(facts: WeatherFacts) -> set[str]:
    """Numeric tokens that may appear in a grounded reply."""
    values: list[Optional[float]] = [
        facts.temperature_2m,
        facts.temperature_min,
        facts.temperature_max,
        facts.precipitation,
        facts.wind_speed_10m,
        facts.relative_humidity_2m,
    ]
    tokens: set[str] = set()
    for value in values:
        if value is None:
            continue
        tokens.add(_fmt(value) or "")
        tokens.add(str(int(round(value))))
        tokens.add(f"{value:.1f}")
        tokens.add(f"{value:.2f}")
    if facts.precipitation_probability is not None:
        tokens.add(str(int(facts.precipitation_probability)))
    if facts.weather_code is not None:
        tokens.add(str(int(facts.weather_code)))
    tokens.discard("")
    return tokens


def is_grounded(text: str, facts: WeatherFacts) -> bool:
    """Reject replies that introduce numbers not present in WeatherFacts."""
    if not facts.period_available:
        return True
    allowed = allowed_numbers(facts)
    if not allowed:
        return not re.search(r"\d", text)
    for match in re.finditer(r"\d+(?:\.\d+)?", text):
        token = match.group(0)
        if token in allowed:
            continue
        # Allow trailing .0 variants
        try:
            as_float = float(token)
        except ValueError:
            return False
        if _fmt(as_float) in allowed or str(int(round(as_float))) in allowed:
            continue
        # Ignore 24-hour clock fragments already in requested_time (e.g. 15:00)
        span_start = match.start()
        if span_start > 0 and text[span_start - 1] in {":", "-", "T"}:
            continue
        after = text[match.end() : match.end() + 1]
        if after == ":":
            continue
        return False
    return True


def template_response(intent: ChatIntent, facts: WeatherFacts) -> str:
    language: ResponseLanguage = intent.language
    loc = facts.location
    when = {
        "now": {"en": "right now", "hi": "अभी", "hinglish": "abhi"},
        "today": {"en": "today", "hi": "आज", "hinglish": "aaj"},
        "tomorrow": {"en": "tomorrow", "hi": "कल", "hinglish": "kal"},
        "tonight": {"en": "tonight", "hi": "आज रात", "hinglish": "aaj raat"},
        "this_afternoon": {
            "en": "this afternoon",
            "hi": "आज दोपहर",
            "hinglish": "aaj dopahar",
        },
    }
    # requested_time begins with the date_reference label
    key = intent.date_reference
    when_phrase = when[key][language]

    if not facts.period_available:
        if language == "hi":
            return (
                f"{loc} के लिए {when_phrase} का पूर्वानुमान इस स्रोत में उपलब्ध नहीं है। "
                "कृपया आज, कल, या वर्तमान समय पूछें।"
            )
        if language == "hinglish":
            return (
                f"{loc} ke liye {when_phrase} ka forecast is data mein available nahi hai. "
                "Aaj, kal, ya current weather pooch sakte ho."
            )
        return (
            f"Forecast data for {when_phrase} in {loc} is not available from Open-Meteo "
            "for this request. Try current conditions, today, or tomorrow."
        )

    param = intent.weather_parameter
    temp = _fmt(facts.temperature_2m)
    tmin = _fmt(facts.temperature_min)
    tmax = _fmt(facts.temperature_max)
    precip = _fmt(facts.precipitation)
    prob = (
        str(facts.precipitation_probability)
        if facts.precipitation_probability is not None
        else None
    )
    wind = _fmt(facts.wind_speed_10m)
    humidity = _fmt(facts.relative_humidity_2m)
    desc = facts.weather_description

    if language == "hi":
        if param == "precipitation":
            if precip is not None and prob is not None:
                return (
                    f"{loc} में {when_phrase} कुल वर्षा {precip} मिमी और अधिकतम वर्षा संभावना "
                    f"{prob}% है (Open-Meteo)।"
                )
            if precip is not None:
                return f"{loc} में {when_phrase} वर्षा {precip} मिमी दर्ज/अनुमानित है (Open-Meteo)।"
        if param == "temperature" and tmin and tmax:
            return (
                f"{loc} में {when_phrase} तापमान लगभग {tmin}°C से {tmax}°C रहेगा (Open-Meteo)।"
            )
        if param == "temperature" and temp:
            return f"{loc} में {when_phrase} तापमान {temp}°C है (Open-Meteo)।"
        if param == "wind" and wind:
            return f"{loc} में {when_phrase} हवा की गति {wind} किमी/घंटा है (Open-Meteo)।"
        if param == "humidity" and humidity:
            return f"{loc} में वर्तमान आर्द्रता {humidity}% है (Open-Meteo)।"
        parts = []
        if temp:
            parts.append(f"तापमान {temp}°C")
        if desc:
            parts.append(desc)
        if precip:
            parts.append(f"वर्षा {precip} मिमी")
        if not parts:
            return f"{loc} के लिए Open-Meteo से मौसम डेटा प्राप्त हुआ, लेकिन चयनित मान उपलब्ध नहीं हैं।"
        return f"{loc} में {when_phrase} {', '.join(parts)} है (Open-Meteo)।"

    if language == "hinglish":
        if param == "precipitation":
            if precip is not None and prob is not None:
                return (
                    f"{loc} mein {when_phrase} total rain {precip} mm hai, peak chance {prob}% "
                    f"(Open-Meteo)."
                )
            if precip is not None:
                return f"{loc} mein {when_phrase} precipitation {precip} mm hai (Open-Meteo)."
        if param == "temperature" and tmin and tmax:
            return (
                f"{loc} mein {when_phrase} temperature {tmin}°C se {tmax}°C rahega (Open-Meteo)."
            )
        if param == "temperature" and temp:
            return f"{loc} mein {when_phrase} temperature {temp}°C hai (Open-Meteo)."
        if param == "wind" and wind:
            return f"{loc} mein {when_phrase} wind {wind} km/h hai (Open-Meteo)."
        if param == "humidity" and humidity:
            return f"{loc} mein humidity {humidity}% hai (Open-Meteo)."
        bits = []
        if temp:
            bits.append(f"temperature {temp}°C")
        if desc:
            bits.append(desc.lower())
        if precip:
            bits.append(f"rain {precip} mm")
        if not bits:
            return f"{loc} ke liye selected weather values available nahi hain."
        return f"{loc} mein {when_phrase} {', '.join(bits)} (Open-Meteo)."

    # English
    if param == "precipitation":
        if precip is not None and prob is not None:
            return (
                f"In {loc} {when_phrase}, total precipitation is {precip} mm with a peak "
                f"probability of {prob}% (Open-Meteo)."
            )
        if precip is not None:
            return f"In {loc} {when_phrase}, precipitation is {precip} mm (Open-Meteo)."
    if param == "temperature" and tmin and tmax:
        extra = f", around {temp}°C mid-period" if temp else ""
        return (
            f"In {loc} {when_phrase}, temperature ranges from {tmin}°C to {tmax}°C{extra} "
            f"(Open-Meteo)."
        )
    if param == "temperature" and temp:
        return f"The temperature in {loc} {when_phrase} is {temp}°C (Open-Meteo)."
    if param == "wind" and wind:
        return f"Wind speed in {loc} {when_phrase} is {wind} km/h (Open-Meteo)."
    if param == "humidity" and humidity:
        return f"Relative humidity in {loc} is {humidity}% (Open-Meteo)."
    chunks = []
    if temp:
        chunks.append(f"{temp}°C")
    if desc:
        chunks.append(desc.lower())
    if precip is not None:
        chunks.append(f"{precip} mm precipitation")
    if not chunks:
        return f"Weather data for {loc} was retrieved, but the requested values are unavailable."
    return f"In {loc} {when_phrase}: {', '.join(chunks)} (Open-Meteo)."


def ask_for_location(intent: ChatIntent) -> str:
    if intent.language == "hi":
        return "कृपया शहर या स्थान बताएँ। बिना स्थान के मौसम नहीं बताया जा सकता।"
    if intent.language == "hinglish":
        return "Please city ya location batao — bina location ke weather nahi bata sakte."
    return "Please specify a city or location. Weather cannot be answered without one."


def unknown_location(intent: ChatIntent, place: str) -> str:
    if intent.language == "hi":
        return f"स्थान '{place}' नहीं मिला। कोई और शहर आज़माएँ।"
    if intent.language == "hinglish":
        return f"Location '{place}' nahi mila. Koi aur city try karo."
    return f"Could not find a location named '{place}'. Try a different city name."


async def generate_response(intent: ChatIntent, facts: WeatherFacts, advisory: Optional[AdvisoryResult] = None) -> str:
    templated = template_response(intent, facts)
    if advisory:
        if intent.language == "hi":
            templated += f" सलाह: {advisory.advisory}"
        elif intent.language == "hinglish":
            templated += f" Advisory: {advisory.advisory}"
        else:
            templated += f" Advisory: {advisory.advisory}"

    try:
        from llm import provider as llm_provider
    except ImportError:
        return templated

    if not llm_provider.is_configured():
        return templated

    advisory_json = advisory.model_dump_json() if advisory else "{}"

    user_payload = (
        f"Language: {intent.language}\n"
        f"Intent: {intent.intent}\n"
        f"Parameter: {intent.weather_parameter}\n"
        f"Date reference: {intent.date_reference}\n"
        f"Verified facts JSON:\n{facts.model_dump_json()}\n"
        f"Intelligence Advisory JSON:\n{advisory_json}\n"
        "Write the user-facing answer using ONLY these facts and the advisory. Do not invent warnings or reasons."
    )
    try:
        text = (await llm_provider.complete_text(_SYSTEM, user_payload, json_mode=False)).strip()
    except Exception as exc:
        logger.info("LLM response generation failed; using template (%s)", type(exc).__name__)
        return templated

    if not text or not is_grounded(text, facts):
        logger.info("LLM reply failed grounding check; using template")
        return templated
    return text
