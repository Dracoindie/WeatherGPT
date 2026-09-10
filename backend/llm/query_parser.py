"""
Query understanding for weather chat.

If an LLM provider is configured, structured JSON extraction is attempted.
Otherwise (and on any LLM failure) a deterministic fallback parser handles
common English / Hindi / Hinglish prototype phrases.

The parser never emits coordinates. Location names are geocoded later.
"""

from __future__ import annotations

import logging
import re
from typing import Optional

from models.chat import (
    ChatIntent,
    DateReference,
    IntentType,
    ResponseLanguage,
    WeatherParameter,
)

logger = logging.getLogger(__name__)

# Names used only for entity detection — coordinates come from Nominatim.
_CITY_NAMES = (
    "new delhi",
    "delhi",
    "mumbai",
    "bombay",
    "pune",
    "nagpur",
    "nashik",
    "nasik",
    "bengaluru",
    "bangalore",
    "hyderabad",
    "chennai",
    "kolkata",
    "calcutta",
    "jaipur",
    "ahmedabad",
    "lucknow",
    "indore",
    "bhopal",
    "patna",
    "surat",
    "kanpur",
    "goa",
    "kochi",
    "cochin",
    "thiruvananthapuram",
    "chandigarh",
    "guwahati",
    "visakhapatnam",
    "vadodara",
    "ludhiana",
    "agra",
    "varanasi",
    "ranchi",
    "raipur",
    "coimbatore",
    "madurai",
    "mysore",
    "mysuru",
    "amritsar",
    "jodhpur",
    "udaipur",
    "shimla",
    "manali",
    "srinagar",
    "jammu",
    "noida",
    "gurgaon",
    "gurugram",
    "faridabad",
    "ghaziabad",
    "thane",
    "navi mumbai",
    "aurangabad",
    "kolhapur",
    "solapur",
    "wardha",
    "amravati",
    "akola",
    "satara",
    "sangli",
    "jalgaon",
    "ahmednagar",
    "lonavala",
    "mahabaleshwar",
    "पुणे",
    "नागपुर",
    "नाशिक",
    "मुंबई",
    "दिल्ली",
    "बेंगलुरु",
    "हैदराबाद",
    "चेन्नई",
    "कोलकाता",
)

_CITY_DEVANAGARI = {
    "पुणे": "Pune",
    "नागपुर": "Nagpur",
    "नाशिक": "Nashik",
    "मुंबई": "Mumbai",
    "दिल्ली": "Delhi",
    "बेंगलुरु": "Bengaluru",
    "हैदराबाद": "Hyderabad",
    "चेन्नई": "Chennai",
    "कोलकाता": "Kolkata",
}

_PARSE_SYSTEM = """You extract weather-query slots. Reply with JSON only:
{
  "intent": "current_weather" | "forecast" | "unknown",
  "location_name": string or null,
  "date_reference": "now" | "today" | "tomorrow" | "tonight" | "this_afternoon",
  "weather_parameter": "temperature" | "high_temperature" | "precipitation" | "heavy_rain" | "rain_likelihood" | "wind" | "strong_wind" | "storm" | "humidity" | "advisory" | "general",
  "language": "en" | "hi" | "hinglish"
}
Rules:
- location_name is a place the user named. If none, null. Never invent a city.
- Never output coordinates.
- "kal" / "tomorrow" → tomorrow. "aaj" / "today" → today. "raat" / "tonight" → tonight.
- "baarish" / "rain" → precipitation. temperature words → temperature.
- Hindi in Devanagari → language "hi". Mixed Hindi roman + English → "hinglish".
"""


def detect_language(message: str) -> ResponseLanguage:
    if re.search(r"[\u0900-\u097F]", message):
        return "hi"
    hinglish_tokens = (
        "baarish",
        "barish",
        "hogi",
        "hoga",
        "kaisa",
        "kesi",
        "kya",
        "mein",
        "hai",
        "aaj",
        "kal",
        "garmi",
        "thand",
        "mausam",
        "hawa",
        "tapman",
        "tapmaan",
    )
    lower = _normalize(message)
    if any(tok in lower for tok in hinglish_tokens):
        return "hinglish"
    return "en"


def _normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip().lower())


def _title_place(name: str) -> str:
    mapped = _CITY_DEVANAGARI.get(name)
    if mapped:
        return mapped
    return " ".join(part.capitalize() for part in name.split())


def _extract_location(message: str) -> Optional[str]:
    lower = _normalize(message)
    for city in sorted(_CITY_NAMES, key=len, reverse=True):
        if city in lower:
            return _title_place(city)

    patterns = [
        r"\bin\s+([A-Za-z][A-Za-z ]{1,40}?)\s+(?:tomorrow|today|tonight|afternoon)\b",
        r"\bin\s+([A-Za-z][A-Za-z ]{1,40})\??$",
        r"\b([A-Za-z][A-Za-z]{2,40})\s+(?:mein|me|ka|ki|ke)\b",
        r"\b([A-Za-z][A-Za-z]{2,40})\s+weather\b",
    ]
    stop = {
        "will",
        "what",
        "whats",
        "when",
        "where",
        "please",
        "tell",
        "today",
        "tomorrow",
        "tonight",
        "weather",
        "temperature",
        "rain",
        "wind",
        "humidity",
        "there",
        "here",
        "this",
        "that",
        "your",
        "my",
        "the",
        "aaj",
        "kal",
        "baarish",
        "barish",
        "mausam",
        "kaisa",
        "kya",
    }
    for pattern in patterns:
        match = re.search(pattern, message, flags=re.IGNORECASE)
        if not match:
            continue
        candidate = match.group(1).strip(" ?.,!")
        if _normalize(candidate) in stop or len(candidate) < 3:
            continue
        return _title_place(candidate)
    return None


def _extract_date(message: str) -> DateReference:
    lower = _normalize(message)
    if re.search(r"[\u0900-\u097F]*कल\b", message) or re.search(
        r"\b(kal|tomorrow)\b", lower
    ):
        return "tomorrow"
    if re.search(r"\b(tonight|raat|raat ko)\b", lower) or "रात" in message:
        return "tonight"
    if re.search(r"\b(this afternoon|afternoon|dopahar|dopahar ko)\b", lower) or "दोपहर" in message:
        return "this_afternoon"
    if re.search(r"\b(aaj|today)\b", lower) or "आज" in message:
        return "today"
    return "now"


def _extract_parameter(message: str) -> WeatherParameter:
    lower = _normalize(message)
    if re.search(r"\b(storm|toofan|cyclone|hurricane)\b", lower) or "तूफान" in message:
        return "storm"
    if re.search(r"\b(strong wind|tej hawa|high wind|gale)\b", lower) or "तेज हवा" in message:
        return "strong_wind"
    if re.search(r"\b(heavy rain|bhari barish|heavy precipitation|downpour|flood)\b", lower) or "भारी बारिश" in message or "बाढ़" in message:
        return "heavy_rain"
    if re.search(r"\b(chance of rain|likelihood of rain|rain chance|probability)\b", lower):
        return "rain_likelihood"
    if (
        re.search(
            r"\b(rain|raining|baarish|barish|precipitation|drizzle|shower)\b",
            lower,
        )
        or "बारिश" in message
        or "वर्षा" in message
    ):
        return "precipitation"
    if re.search(r"\b(heat|heatwave|high temp|hot)\b", lower) or "गर्मी" in message:
        return "high_temperature"
    if re.search(r"\b(temp|temperature|thand|tapman|tapmaan)\b", lower) or "तापमान" in message:
        return "temperature"
    if re.search(r"\b(wind|hawa|breeze)\b", lower) or "हवा" in message:
        return "wind"
    if re.search(r"\b(humidity|nami|moist)\b", lower) or "नमी" in message:
        return "humidity"
    if re.search(r"\b(advisory|travel|safe|danger|warning|alert|advisories)\b", lower) or "चेतावनी" in message or "यात्रा" in message:
        return "advisory"
    return "general"


def _extract_intent(message: str, date_ref: DateReference, param: WeatherParameter) -> IntentType:
    lower = _normalize(message)
    if date_ref in {"tomorrow", "tonight", "this_afternoon"}:
        return "forecast"
    if date_ref == "today" and param == "precipitation":
        return "forecast"
    if re.search(r"\b(will|hogi|hoga|forecast|kal)\b", lower):
        return "forecast"
    if "होगी" in message or "होगा" in message:
        return "forecast"
    if re.search(r"\b(now|current|right now)\b", lower):
        return "current_weather"
    if date_ref == "now":
        return "current_weather"
    return "forecast"


def parse_query_fallback(message: str) -> ChatIntent:
    """Deterministic parser for prototype phrases. Never invents a location."""
    language = detect_language(message)
    date_reference = _extract_date(message)
    weather_parameter = _extract_parameter(message)
    location_name = _extract_location(message)
    intent = _extract_intent(message, date_reference, weather_parameter)
    if weather_parameter == "precipitation" and date_reference == "now":
        if re.search(r"\b(will|hogi|hoga|kal|tomorrow)\b", _normalize(message)):
            intent = "forecast"
    return ChatIntent(
        intent=intent,
        location_name=location_name,
        date_reference=date_reference,
        weather_parameter=weather_parameter,
        language=language,
    )


def _intent_from_llm_dict(data: dict, fallback: ChatIntent) -> ChatIntent:
    allowed_intent: set[str] = {"current_weather", "forecast", "unknown"}
    allowed_date: set[str] = {
        "now",
        "today",
        "tomorrow",
        "tonight",
        "this_afternoon",
    }
    allowed_param: set[str] = {
        "temperature",
        "high_temperature",
        "precipitation",
        "heavy_rain",
        "rain_likelihood",
        "wind",
        "strong_wind",
        "storm",
        "humidity",
        "advisory",
        "general",
    }
    allowed_lang: set[str] = {"en", "hi", "hinglish"}

    intent = data.get("intent") if data.get("intent") in allowed_intent else fallback.intent
    date_reference = (
        data.get("date_reference")
        if data.get("date_reference") in allowed_date
        else fallback.date_reference
    )
    weather_parameter = (
        data.get("weather_parameter")
        if data.get("weather_parameter") in allowed_param
        else fallback.weather_parameter
    )
    language = data.get("language") if data.get("language") in allowed_lang else fallback.language
    raw_loc = data.get("location_name")
    if raw_loc is None or str(raw_loc).strip().lower() in {"", "null", "none", "unknown"}:
        location_name = fallback.location_name
    else:
        location_name = str(raw_loc).strip()
    return ChatIntent(
        intent=intent,  # type: ignore[arg-type]
        location_name=location_name,
        date_reference=date_reference,  # type: ignore[arg-type]
        weather_parameter=weather_parameter,  # type: ignore[arg-type]
        language=language,  # type: ignore[arg-type]
    )


async def parse_query(message: str) -> ChatIntent:
    fallback = parse_query_fallback(message)
    try:
        from llm import provider as llm_provider
    except ImportError:
        return fallback

    if not llm_provider.is_configured():
        return fallback

    try:
        data = await llm_provider.complete_json(_PARSE_SYSTEM, message)
        parsed = _intent_from_llm_dict(data, fallback)
        # Never keep an LLM location that is clearly fabricated coordinates.
        if parsed.location_name and re.search(r"-?\d+\.\d+", parsed.location_name):
            parsed.location_name = fallback.location_name
        return parsed
    except Exception as exc:
        logger.info("LLM query parse failed; using fallback parser (%s)", type(exc).__name__)
        return fallback
