"""
Grounded replies for the climate (Open-Meteo archive) and GFS (NWP) intents.

Same contract as response_generator: a deterministic template always exists,
an optional LLM rewrite is accepted only if every number in it comes from the
facts object, otherwise the template is returned.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime
from typing import Optional

from pydantic import BaseModel

from llm.response_generator import _fmt, numbers_grounded, when_phrase_for
from models.chat import ChatIntent, ClimateFacts, NwpFacts

logger = logging.getLogger(__name__)

_SYSTEM = """You are WeatherGPT, a language interface over verified data.

Rules:
- Use only the numbers, dates and place name in the facts JSON; never invent or change a value.
- Climate facts compare a recent period with the same dates in earlier years (Open-Meteo archive).
- NWP facts are raw GFS model output, not an official forecast; say so.
- Reply in the requested language (en, hi, hinglish, or mr = Marathi in Devanagari), 1–3 sentences.
"""


def allowed_numbers_in(facts: BaseModel) -> set[str]:
    """Every numeric token a reply about ``facts`` may contain."""
    tokens: set[str] = set()
    for value in facts.model_dump().values():
        if isinstance(value, bool) or value is None:
            continue
        if isinstance(value, (int, float)):
            v = float(value)
            for candidate in (_fmt(abs(v)), str(int(round(abs(v)))), f"{abs(v):.1f}"):
                if candidate:
                    tokens.add(candidate)
        elif isinstance(value, str):
            for part in re.findall(r"\d+", value):
                tokens.update({part, str(int(part))})
    return tokens


# ---------------------------------------------------------------------------
# Climate
# ---------------------------------------------------------------------------

_PERIOD = {
    "this_year": {"en": "so far this year", "hi": "इस साल अब तक", "hinglish": "is saal ab tak", "mr": "या वर्षी आतापर्यंत"},
    "this_month": {"en": "this month so far", "hi": "इस महीने अब तक", "hinglish": "is mahine ab tak", "mr": "या महिन्यात आतापर्यंत"},
    "last_30_days": {"en": "over the last 30 days", "hi": "पिछले 30 दिनों में", "hinglish": "pichhle 30 din mein", "mr": "गेल्या 30 दिवसांत"},
}
# Within this many °C the period counts as "about usual".
NEAR_NORMAL_C = 0.5
# Within this many percent rain counts as "about usual".
NEAR_NORMAL_RAIN_PCT = 15


def _temp_sentence(f: ClimateFacts, lang: str) -> Optional[str]:
    if f.mean_temperature_max is None or f.baseline_mean_temperature_max is None or f.temperature_max_anomaly is None:
        return None
    t, b, a = _fmt(f.mean_temperature_max), _fmt(f.baseline_mean_temperature_max), f.temperature_max_anomaly
    years = f"{f.baseline_start_year}–{f.baseline_end_year}"
    diff = _fmt(abs(a))
    if lang == "hi":
        verdict = "लगभग सामान्य" if abs(a) < NEAR_NORMAL_C else f"सामान्य से {diff}°C {'अधिक गर्म' if a > 0 else 'ठंडा'}"
        return f"औसत अधिकतम तापमान {t}°C रहा, जबकि {years} का औसत {b}°C है — {verdict}।"
    if lang == "mr":
        verdict = "जवळपास सामान्य" if abs(a) < NEAR_NORMAL_C else f"सामान्यपेक्षा {diff}°C {'जास्त उष्ण' if a > 0 else 'थंड'}"
        return f"सरासरी कमाल तापमान {t}°C होते, तर {years} ची सरासरी {b}°C आहे — {verdict}."
    if lang == "hinglish":
        verdict = "lagbhag normal" if abs(a) < NEAR_NORMAL_C else f"usual se {diff}°C {'zyada garam' if a > 0 else 'thanda'}"
        return f"average max temperature {t}°C raha, jabki {years} ka average {b}°C hai — {verdict}."
    verdict = "about usual" if abs(a) < NEAR_NORMAL_C else f"{diff}°C {'warmer' if a > 0 else 'cooler'} than usual"
    return f"the average daily high was {t}°C against a {years} average of {b}°C — {verdict}."


def _rain_sentence(f: ClimateFacts, lang: str) -> Optional[str]:
    if f.total_precipitation is None or f.baseline_total_precipitation is None:
        return None
    r, b, pct = _fmt(f.total_precipitation), _fmt(f.baseline_total_precipitation), f.precipitation_anomaly_percent
    if pct is None:
        tail = ""
    elif abs(pct) < NEAR_NORMAL_RAIN_PCT:
        tail = {"hi": " (लगभग सामान्य)", "hinglish": " (lagbhag normal)", "en": " (about usual)", "mr": " (जवळपास सामान्य)"}[lang]
    else:
        more = pct > 0
        tail = {
            "hi": f" ({abs(pct)}% {'अधिक' if more else 'कम'})",
            "hinglish": f" ({abs(pct)}% {'zyada' if more else 'kam'})",
            "mr": f" ({abs(pct)}% {'जास्त' if more else 'कमी'})",
            "en": f" ({abs(pct)}% {'more' if more else 'less'} than usual)",
        }[lang]
    if lang == "hi":
        return f"बारिश {r} मिमी हुई, सामान्य {b} मिमी{tail}।"
    if lang == "mr":
        return f"पाऊस {r} मिमी झाला, सामान्य {b} मिमी{tail}."
    if lang == "hinglish":
        return f"Baarish {r} mm hui, normal {b} mm{tail}."
    return f"Rainfall was {r} mm against a usual {b} mm{tail}."


def climate_template(intent: ChatIntent, f: ClimateFacts) -> str:
    lang = intent.language
    loc = f.location
    if not f.available:
        return {
            "hi": f"{loc} के लिए पिछले वर्षों से तुलना करने लायक पर्याप्त आर्काइव डेटा नहीं मिला।",
            "hinglish": f"{loc} ke liye pichhle saalon se compare karne layak archive data nahi mila.",
            "mr": f"{loc} साठी मागील वर्षांशी तुलना करण्याइतकी संग्रहित माहिती मिळाली नाही.",
            "en": f"Not enough archive data for {loc} to compare with past years.",
        }[lang]
    period = _PERIOD[f.period][lang]
    span = f"{f.period_start} – {f.period_end}"
    param = intent.weather_parameter
    want_rain = param in {"precipitation", "heavy_rain", "rain_likelihood"}
    want_temp = not want_rain or param == "general"
    parts = []
    if want_temp:
        s = _temp_sentence(f, lang)
        if s:
            parts.append(s)
    if want_rain or param == "general":
        s = _rain_sentence(f, lang)
        if s:
            parts.append(s)
    if not parts:
        return climate_template(intent, f.model_copy(update={"available": False}))
    if lang == "hi":
        return f"{loc} में {period} ({span}): " + " ".join(parts) + " (Open-Meteo आर्काइव)"
    if lang == "mr":
        return f"{loc} मध्ये {period} ({span}): " + " ".join(parts) + " (Open-Meteo संग्रह)"
    if lang == "hinglish":
        return f"{loc} mein {period} ({span}): " + " ".join(parts) + " (Open-Meteo archive)"
    head = f"In {loc} {period} ({span}), "
    return head + " ".join(parts) + " (Open-Meteo archive)"


# ---------------------------------------------------------------------------
# GFS
# ---------------------------------------------------------------------------


def nwp_unavailable(intent: ChatIntent) -> str:
    return {
        "hi": "GFS मॉडल डेटा अभी इस सर्वर पर उपलब्ध नहीं है।",
        "hinglish": "GFS model data abhi is server par available nahi hai.",
        "mr": "GFS मॉडेलची माहिती सध्या या सर्व्हरवर उपलब्ध नाही.",
        "en": "GFS model data is not available on this server right now.",
    }[intent.language]


def nwp_template(intent: ChatIntent, f: NwpFacts) -> str:
    lang = intent.language
    when = when_phrase_for(intent.date_reference, lang)
    loc = f.location
    if not f.period_available:
        return {
            "hi": f"GFS मॉडल केवल अगले 48 घंटे देता है, इसलिए {loc} के लिए {when} का मॉडल डेटा नहीं है।",
            "hinglish": f"GFS model sirf agle 48 ghante deta hai, isliye {loc} ke liye {when} ka model data nahi hai.",
            "mr": f"GFS मॉडेल फक्त पुढील 48 तासांची माहिती देते, त्यामुळे {loc} साठी {when} ची मॉडेल माहिती नाही.",
            "en": f"The GFS model here covers only the next 48 hours, so there is no model output for {loc} {when}.",
        }[lang]
    run = datetime.fromisoformat(f.run)
    run_label = f"{run.strftime('%Y-%m-%d %H')}:00 UTC"
    tmin, tmax = _fmt(f.temperature_min), _fmt(f.temperature_max)
    temp = tmin if tmin == tmax else f"{tmin}–{tmax}"
    rain, wind = _fmt(f.precipitation), _fmt(f.wind_speed_max)
    if lang == "hi":
        return (
            f"GFS मॉडल (रन {run_label}) के अनुसार {loc} में {when}: तापमान {temp}°C, वर्षा {rain} मिमी, "
            f"हवा अधिकतम {wind} km/h। यह कच्चा मॉडल आउटपुट है, आधिकारिक पूर्वानुमान नहीं।"
        )
    if lang == "mr":
        return (
            f"GFS मॉडेल (रन {run_label}) नुसार {loc} मध्ये {when}: तापमान {temp}°C, पाऊस {rain} मिमी, "
            f"वारा कमाल {wind} km/h. हे कच्चे मॉडेल आउटपुट आहे, अधिकृत अंदाज नाही."
        )
    if lang == "hinglish":
        return (
            f"GFS model (run {run_label}) ke hisaab se {loc} mein {when}: temperature {temp}°C, baarish {rain} mm, "
            f"hawa max {wind} km/h. Yeh raw model output hai, official forecast nahi."
        )
    return (
        f"GFS model (run {run_label}) for {loc} {when}: {temp}°C, {rain} mm of precipitation, "
        f"winds up to {wind} km/h. Raw model output, not an official forecast."
    )


# ---------------------------------------------------------------------------
# Optional LLM wording, grounded against the facts
# ---------------------------------------------------------------------------


async def grounded_reply(intent: ChatIntent, facts: BaseModel, templated: str) -> str:
    try:
        from llm import provider as llm_provider
    except ImportError:
        return templated
    if not llm_provider.is_configured():
        return templated
    payload = (
        f"Language: {intent.language}\nIntent: {intent.intent}\nParameter: {intent.weather_parameter}\n"
        f"Facts JSON:\n{facts.model_dump_json()}\n"
        "Write the user-facing answer using ONLY these facts."
    )
    try:
        text = (await llm_provider.complete_text(_SYSTEM, payload, json_mode=False)).strip()
    except Exception as exc:
        logger.info("LLM reply failed; using template (%s)", type(exc).__name__)
        return templated
    allowed = allowed_numbers_in(facts) | {"48", "30"}  # "48-hour model window", "last 30 days"
    if not text or not numbers_grounded(text, allowed):
        logger.info("LLM reply failed grounding check; using template")
        return templated
    return text
