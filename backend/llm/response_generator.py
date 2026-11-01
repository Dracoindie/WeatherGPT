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

from advisory import localized_advisory, should_mention_advisory
from models.chat import WEEKDAYS, ChatIntent, ResponseLanguage, WeatherFacts, AdvisoryResult

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
- Reply in the requested language (en, hi, hinglish, or mr = Marathi in Devanagari).
- Be concise (1–3 sentences).
- You are not a meteorological data source; Open-Meteo is.
"""


_HINDI_WEEKDAYS = ("सोमवार", "मंगलवार", "बुधवार", "गुरुवार", "शुक्रवार", "शनिवार", "रविवार")


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
        facts.wind_direction_10m,
        facts.relative_humidity_2m,
        facts.wind_gusts_10m,
        facts.visibility,
        facts.cloud_cover,
        facts.uv_index,
        facts.pm2_5,
        facts.pm10,
        facts.aqi,
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
    # Date/time parts of the window, e.g. "2026-11-02T15:00" allows 2026, 11, 2, 15...
    for part in re.findall(r"\d+", facts.requested_time):
        tokens.add(part)
        tokens.add(str(int(part)))
    tokens.discard("")
    return tokens


def is_grounded(
    text: str, facts: WeatherFacts, advisory: Optional[AdvisoryResult] = None
) -> bool:
    """Reject replies that introduce numbers not present in WeatherFacts or the advisory."""
    if not facts.period_available:
        return True
    allowed = allowed_numbers(facts)
    if advisory is not None:
        # Reasons quote verified period values (e.g. rain on a temperature question).
        for reason in advisory.reasons:
            allowed.update(re.findall(r"\d+(?:\.\d+)?", reason))
    return numbers_grounded(text, allowed)


def numbers_grounded(text: str, allowed: set[str]) -> bool:
    """True when every number in ``text`` is an allowed token (or a clock/date fragment of one)."""
    if not allowed:
        return not re.search(r"\d", text)
    for match in re.finditer(r"\d+(?:\.\d+)?", text):
        token = match.group(0)
        if token in allowed:
            continue
        # "PM2.5" / "PM10" name a pollutant; the digits are not a value
        if text[max(0, match.start() - 2) : match.start()].upper() == "PM":
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


WHEN: dict[str, dict[str, str]] = {
    "now": {"en": "right now", "hi": "अभी", "hinglish": "abhi"},
    "today": {"en": "today", "hi": "आज", "hinglish": "aaj"},
    "tomorrow": {"en": "tomorrow", "hi": "कल", "hinglish": "kal"},
    "day_after_tomorrow": {
        "en": "the day after tomorrow",
        "hi": "परसों",
        "hinglish": "parso",
    },
    "tonight": {"en": "tonight", "hi": "आज रात", "hinglish": "aaj raat"},
    "this_afternoon": {
        "en": "this afternoon",
        "hi": "आज दोपहर",
        "hinglish": "aaj dopahar",
    },
    **{
        day: {"en": f"on {day.capitalize()}", "hi": f"{hi} को", "hinglish": f"{day.capitalize()} ko"}
        for day, hi in zip(WEEKDAYS, _HINDI_WEEKDAYS)
    },
}


_MARATHI_WEEKDAYS = ("सोमवारी", "मंगळवारी", "बुधवारी", "गुरुवारी", "शुक्रवारी", "शनिवारी", "रविवारी")
_MARATHI_WHEN = {
    "now": "आत्ता",
    "today": "आज",
    "tomorrow": "उद्या",
    "day_after_tomorrow": "परवा",
    "tonight": "आज रात्री",
    "this_afternoon": "आज दुपारी",
    **dict(zip(WEEKDAYS, _MARATHI_WEEKDAYS)),
}
for _key, _phrase in _MARATHI_WHEN.items():
    WHEN[_key]["mr"] = _phrase


def when_phrase_for(date_reference: str, language: ResponseLanguage) -> str:
    return WHEN[date_reference][language]


AQI_LABELS: dict[str, dict[str, str]] = {
    "good": {"en": "Good", "hi": "अच्छा", "hinglish": "good", "mr": "चांगली"},
    "satisfactory": {"en": "Satisfactory", "hi": "संतोषजनक", "hinglish": "satisfactory", "mr": "समाधानकारक"},
    "moderate": {"en": "Moderately polluted", "hi": "मध्यम प्रदूषित", "hinglish": "moderate", "mr": "मध्यम प्रदूषित"},
    "poor": {"en": "Poor", "hi": "खराब", "hinglish": "poor", "mr": "वाईट"},
    "very_poor": {"en": "Very poor", "hi": "बहुत खराब", "hinglish": "very poor", "mr": "अतिशय वाईट"},
    "severe": {"en": "Severe", "hi": "गंभीर", "hinglish": "severe", "mr": "गंभीर"},
}
UV_LABELS: dict[str, dict[str, str]] = {
    "low": {"en": "Low", "hi": "कम", "hinglish": "low", "mr": "कमी"},
    "moderate": {"en": "Moderate", "hi": "मध्यम", "hinglish": "moderate", "mr": "मध्यम"},
    "high": {"en": "High", "hi": "उच्च", "hinglish": "high", "mr": "जास्त"},
    "very_high": {"en": "Very high", "hi": "बहुत उच्च", "hinglish": "very high", "mr": "खूप जास्त"},
    "extreme": {"en": "Extreme", "hi": "अत्यधिक", "hinglish": "extreme", "mr": "अतिजास्त"},
}


def air_quality_sentence(loc: str, when: str, facts: WeatherFacts, lang: ResponseLanguage) -> str:
    if facts.aqi is None or facts.aqi_category is None:
        return {
            "en": f"Air quality data for {loc} is not available right now.",
            "hi": f"{loc} के लिए वायु गुणवत्ता डेटा अभी उपलब्ध नहीं है।",
            "hinglish": f"{loc} ke liye air quality data abhi available nahi hai.",
            "mr": f"{loc} साठी हवेच्या गुणवत्तेची माहिती सध्या उपलब्ध नाही.",
        }[lang]
    cat = AQI_LABELS[facts.aqi_category][lang]
    pm = ", ".join(
        part
        for part in (
            f"PM2.5 {_fmt(facts.pm2_5)} µg/m³" if facts.pm2_5 is not None else None,
            f"PM10 {_fmt(facts.pm10)} µg/m³" if facts.pm10 is not None else None,
        )
        if part
    )
    return {
        "en": f"Air quality in {loc} {when}: AQI {facts.aqi} ({cat}, India CPCB scale), {pm} — computed from Open-Meteo (CAMS) model data, not a CPCB station.",
        "hi": f"{loc} में {when} वायु गुणवत्ता: AQI {facts.aqi} ({cat}), {pm} — Open-Meteo (CAMS) मॉडल डेटा से गणना, CPCB स्टेशन रीडिंग नहीं।",
        "hinglish": f"{loc} mein {when} air quality: AQI {facts.aqi} ({cat}), {pm} — Open-Meteo (CAMS) model data se calculate, CPCB station reading nahi.",
        "mr": f"{loc} मध्ये {when} हवेची गुणवत्ता: AQI {facts.aqi} ({cat}), {pm} — Open-Meteo (CAMS) मॉडेल माहितीवरून गणना, CPCB स्टेशन वाचन नाही.",
    }[lang]


def uv_sentence(loc: str, when: str, facts: WeatherFacts, lang: ResponseLanguage) -> str:
    from air.aqi import uv_category

    if facts.uv_index is None:
        return {
            "en": f"UV index data for {loc} is not available right now.",
            "hi": f"{loc} के लिए UV इंडेक्स डेटा अभी उपलब्ध नहीं है।",
            "hinglish": f"{loc} ke liye UV index data abhi available nahi hai.",
            "mr": f"{loc} साठी UV निर्देशांकाची माहिती सध्या उपलब्ध नाही.",
        }[lang]
    uv = _fmt(facts.uv_index)
    category = uv_category(facts.uv_index) or "low"
    cat = UV_LABELS[category][lang]
    protect = category in {"high", "very_high", "extreme"}
    return {
        "en": f"The UV index in {loc} {when} is {uv} ({cat}) (Open-Meteo)." + (" Use sun protection around midday." if protect else ""),
        "hi": f"{loc} में {when} UV इंडेक्स {uv} ({cat}) है (Open-Meteo)।" + (" दोपहर में धूप से बचाव करें।" if protect else ""),
        "hinglish": f"{loc} mein {when} UV index {uv} ({cat}) hai (Open-Meteo)." + (" Dopahar mein dhoop se bachav karo." if protect else ""),
        "mr": f"{loc} मध्ये {when} UV निर्देशांक {uv} ({cat}) आहे (Open-Meteo)." + (" दुपारी उन्हापासून संरक्षण घ्या." if protect else ""),
    }[lang]


def _template_mr(param, loc, when, temp, tmin, tmax, precip, prob, wind, humidity, desc) -> str:
    """Marathi weather reply; same facts and branches as the other languages."""
    if param == "precipitation":
        if precip is not None and prob is not None:
            return f"{loc} मध्ये {when} एकूण पाऊस {precip} मिमी आणि पावसाची कमाल शक्यता {prob}% आहे (Open-Meteo)."
        if precip is not None:
            return f"{loc} मध्ये {when} पाऊस {precip} मिमी आहे (Open-Meteo)."
    if param == "heavy_rain" and precip is not None:
        chance = f", कमाल शक्यता {prob}%" if prob is not None else ""
        return f"{loc} मध्ये {when} मुसळधार पावसाची तपासणी: एकूण पाऊस {precip} मिमी{chance} (Open-Meteo)."
    if param == "rain_likelihood" and prob is not None:
        amount = f", अंदाजे पाऊस {precip} मिमी" if precip is not None else ""
        return f"{loc} मध्ये {when} पावसाची शक्यता कमाल {prob}% आहे{amount} (Open-Meteo)."
    if param in ("heavy_rain", "rain_likelihood") and precip is not None:
        return f"{loc} मध्ये {when} पाऊस {precip} मिमी आहे (Open-Meteo)."
    if param == "storm" and (wind or precip is not None or desc):
        parts = []
        if desc:
            parts.append(desc)
        if wind:
            parts.append(f"वारा {wind} किमी/तास पर्यंत")
        if precip is not None:
            parts.append(f"पाऊस {precip} मिमी")
        return f"{loc} मध्ये {when} वादळाची तपासणी: {', '.join(parts)} (Open-Meteo)."
    if param == "high_temperature" and tmax:
        return f"{loc} मध्ये {when} कमाल तापमान {tmax}°C असेल (Open-Meteo)."
    if param == "high_temperature" and temp:
        return f"{loc} मध्ये {when} तापमान {temp}°C आहे (Open-Meteo)."
    if param == "temperature" and tmin and tmax:
        return f"{loc} मध्ये {when} तापमान सुमारे {tmin}°C ते {tmax}°C असेल (Open-Meteo)."
    if param == "temperature" and temp:
        return f"{loc} मध्ये {when} तापमान {temp}°C आहे (Open-Meteo)."
    if param == "wind" and wind:
        return f"{loc} मध्ये {when} वाऱ्याचा वेग {wind} किमी/तास आहे (Open-Meteo)."
    if param == "strong_wind" and wind:
        return f"{loc} मध्ये {when} वाऱ्याचा वेग {wind} किमी/तास पर्यंत आहे (Open-Meteo)."
    if param == "humidity" and humidity:
        return f"{loc} मध्ये {when} आर्द्रता {humidity}% आहे (Open-Meteo)."
    parts = []
    if temp:
        parts.append(f"तापमान {temp}°C")
    if desc:
        parts.append(desc)
    if precip:
        parts.append(f"पाऊस {precip} मिमी")
    if not parts:
        return f"{loc} साठी Open-Meteo कडून हवामान माहिती मिळाली, पण निवडलेली मूल्ये उपलब्ध नाहीत."
    return f"{loc} मध्ये {when} {', '.join(parts)} (Open-Meteo)."


def template_response(intent: ChatIntent, facts: WeatherFacts) -> str:
    language: ResponseLanguage = intent.language
    loc = facts.location
    when_phrase = when_phrase_for(intent.date_reference, language)

    if not facts.period_available:
        if language == "mr":
            return (
                f"{loc} साठी {when_phrase} चा अंदाज या स्रोतात उपलब्ध नाही. "
                "आज, उद्या किंवा सध्याचे हवामान विचारा."
            )
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

    if param == "air_quality":
        return air_quality_sentence(loc, when_phrase, facts, language)
    if param == "uv":
        return uv_sentence(loc, when_phrase, facts, language)
    if language == "mr":
        return _template_mr(param, loc, when_phrase, temp, tmin, tmax, precip, prob, wind, humidity, desc)

    if language == "hi":
        if param == "precipitation":
            if precip is not None and prob is not None:
                return (
                    f"{loc} में {when_phrase} कुल वर्षा {precip} मिमी और अधिकतम वर्षा संभावना "
                    f"{prob}% है (Open-Meteo)।"
                )
            if precip is not None:
                return f"{loc} में {when_phrase} वर्षा {precip} मिमी दर्ज/अनुमानित है (Open-Meteo)।"
        if param == "heavy_rain" and precip is not None:
            chance = f", अधिकतम संभावना {prob}%" if prob is not None else ""
            return (
                f"{loc} में {when_phrase} भारी बारिश की जाँच: कुल वर्षा {precip} मिमी{chance} "
                "(Open-Meteo)।"
            )
        if param == "rain_likelihood" and prob is not None:
            amount = f", अनुमानित वर्षा {precip} मिमी" if precip is not None else ""
            return f"{loc} में {when_phrase} बारिश की संभावना अधिकतम {prob}% है{amount} (Open-Meteo)।"
        if param in ("heavy_rain", "rain_likelihood") and precip is not None:
            return f"{loc} में {when_phrase} वर्षा {precip} मिमी दर्ज/अनुमानित है (Open-Meteo)।"
        if param == "storm" and (wind or precip is not None or desc):
            parts = []
            if desc:
                parts.append(desc)
            if wind:
                parts.append(f"हवा {wind} किमी/घंटा तक")
            if precip is not None:
                parts.append(f"वर्षा {precip} मिमी")
            return f"{loc} में {when_phrase} तूफान की जाँच: {', '.join(parts)} (Open-Meteo)।"
        if param == "high_temperature" and tmax:
            return f"{loc} में {when_phrase} अधिकतम तापमान {tmax}°C रहेगा (Open-Meteo)।"
        if param == "high_temperature" and temp:
            return f"{loc} में {when_phrase} तापमान {temp}°C है (Open-Meteo)।"
        if param == "temperature" and tmin and tmax:
            return (
                f"{loc} में {when_phrase} तापमान लगभग {tmin}°C से {tmax}°C रहेगा (Open-Meteo)।"
            )
        if param == "temperature" and temp:
            return f"{loc} में {when_phrase} तापमान {temp}°C है (Open-Meteo)।"
        if param == "wind" and wind:
            return f"{loc} में {when_phrase} हवा की गति {wind} किमी/घंटा है (Open-Meteo)।"
        if param == "strong_wind" and wind:
            return f"{loc} में {when_phrase} हवा की गति {wind} किमी/घंटा तक है (Open-Meteo)।"
        if param == "humidity" and humidity:
            return f"{loc} में {when_phrase} आर्द्रता {humidity}% है (Open-Meteo)।"
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
        if param == "heavy_rain" and precip is not None:
            chance = f", peak chance {prob}%" if prob is not None else ""
            return (
                f"{loc} mein {when_phrase} heavy rain check: total rain {precip} mm{chance} "
                "(Open-Meteo)."
            )
        if param == "rain_likelihood" and prob is not None:
            amount = f", expected rain {precip} mm" if precip is not None else ""
            return f"{loc} mein {when_phrase} baarish ka chance {prob}% tak hai{amount} (Open-Meteo)."
        if param in ("heavy_rain", "rain_likelihood") and precip is not None:
            return f"{loc} mein {when_phrase} precipitation {precip} mm hai (Open-Meteo)."
        if param == "storm" and (wind or precip is not None or desc):
            bits = []
            if desc:
                bits.append(desc.lower())
            if wind:
                bits.append(f"wind {wind} km/h tak")
            if precip is not None:
                bits.append(f"rain {precip} mm")
            return f"{loc} mein {when_phrase} storm check: {', '.join(bits)} (Open-Meteo)."
        if param == "high_temperature" and tmax:
            return f"{loc} mein {when_phrase} maximum temperature {tmax}°C rahega (Open-Meteo)."
        if param == "high_temperature" and temp:
            return f"{loc} mein {when_phrase} temperature {temp}°C hai (Open-Meteo)."
        if param == "temperature" and tmin and tmax:
            return (
                f"{loc} mein {when_phrase} temperature {tmin}°C se {tmax}°C rahega (Open-Meteo)."
            )
        if param == "temperature" and temp:
            return f"{loc} mein {when_phrase} temperature {temp}°C hai (Open-Meteo)."
        if param == "wind" and wind:
            return f"{loc} mein {when_phrase} wind {wind} km/h hai (Open-Meteo)."
        if param == "strong_wind" and wind:
            return f"{loc} mein {when_phrase} hawa {wind} km/h tak hai (Open-Meteo)."
        if param == "humidity" and humidity:
            return f"{loc} mein {when_phrase} humidity {humidity}% hai (Open-Meteo)."
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
    if param == "heavy_rain" and precip is not None:
        chance = f", peak probability {prob}%" if prob is not None else ""
        return (
            f"Heavy rain check for {loc} {when_phrase}: total precipitation {precip} mm{chance} "
            "(Open-Meteo)."
        )
    if param == "rain_likelihood" and prob is not None:
        amount = f", with {precip} mm expected" if precip is not None else ""
        return f"The chance of rain in {loc} {when_phrase} peaks at {prob}%{amount} (Open-Meteo)."
    if param in ("heavy_rain", "rain_likelihood") and precip is not None:
        return f"In {loc} {when_phrase}, precipitation is {precip} mm (Open-Meteo)."
    if param == "storm" and (wind or precip is not None or desc):
        pieces = []
        if desc:
            pieces.append(desc.lower())
        if wind:
            pieces.append(f"wind up to {wind} km/h")
        if precip is not None:
            pieces.append(f"{precip} mm precipitation")
        return f"Storm check for {loc} {when_phrase}: {', '.join(pieces)} (Open-Meteo)."
    if param == "high_temperature" and tmax:
        return f"In {loc} {when_phrase}, the maximum temperature is {tmax}°C (Open-Meteo)."
    if param == "high_temperature" and temp:
        return f"The temperature in {loc} {when_phrase} is {temp}°C (Open-Meteo)."
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
    if param == "strong_wind" and wind:
        return f"Wind speed in {loc} {when_phrase} reaches up to {wind} km/h (Open-Meteo)."
    if param == "humidity" and humidity:
        return f"Relative humidity in {loc} {when_phrase} is {humidity}% (Open-Meteo)."
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
    if intent.language == "mr":
        return "कृपया शहर किंवा ठिकाण सांगा. ठिकाणाशिवाय हवामान सांगता येत नाही."
    if intent.language == "hi":
        return "कृपया शहर या स्थान बताएँ। बिना स्थान के मौसम नहीं बताया जा सकता।"
    if intent.language == "hinglish":
        return "Please city ya location batao — bina location ke weather nahi bata sakte."
    return "Please specify a city or location. Weather cannot be answered without one."


def unknown_location(intent: ChatIntent, place: str) -> str:
    if intent.language == "mr":
        return f"'{place}' हे ठिकाण सापडले नाही. दुसरे शहर वापरून पाहा."
    if intent.language == "hi":
        return f"स्थान '{place}' नहीं मिला। कोई और शहर आज़माएँ।"
    if intent.language == "hinglish":
        return f"Location '{place}' nahi mila. Koi aur city try karo."
    return f"Could not find a location named '{place}'. Try a different city name."


async def generate_response(intent: ChatIntent, facts: WeatherFacts, advisory: Optional[AdvisoryResult] = None) -> str:
    templated = template_response(intent, facts)
    if advisory and should_mention_advisory(advisory, intent.weather_parameter):
        label = {"hi": "सलाह", "mr": "सूचना"}.get(intent.language, "Advisory")
        templated += f" {label}: {localized_advisory(advisory, intent.language)}"

    try:
        from llm import provider as llm_provider
    except ImportError:
        return templated

    if not llm_provider.is_configured():
        return templated

    mention = advisory is not None and should_mention_advisory(advisory, intent.weather_parameter)
    advisory_json = advisory.model_dump_json() if mention else "{}"

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

    if not text or not is_grounded(text, facts, advisory if mention else None):
        logger.info("LLM reply failed grounding check; using template")
        return templated
    return text
