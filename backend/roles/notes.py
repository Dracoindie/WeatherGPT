"""
One deterministic sentence that shifts a weather reply's focus to the asker's
role. Numbers come only from the period's WeatherFacts (the same values the
advisory sees), so the note passes the grounding check by construction.
"""

from __future__ import annotations

from typing import Optional

from llm.response_generator import _fmt
from models.chat import AdvisoryResult, ResponseLanguage, UserRole, WeatherFacts
from roles.farm import IRRIGATION_DELAY_PROBABILITY, IRRIGATION_DELAY_RAIN_MM, SPRAY_MAX_TEMP_C, SPRAY_MAX_WIND_KMH

_SEVERITY = {
    "low": {"en": "low", "hi": "कम", "hinglish": "low", "mr": "कमी"},
    "moderate": {"en": "moderate", "hi": "मध्यम", "hinglish": "moderate", "mr": "मध्यम"},
    "high": {"en": "high", "hi": "उच्च", "hinglish": "high", "mr": "जास्त"},
}


def _farmer(f: WeatherFacts, lang: ResponseLanguage) -> str:
    rain, prob = f.precipitation, f.precipitation_probability
    wind, tmax = f.wind_speed_10m, f.temperature_max if f.temperature_max is not None else f.temperature_2m
    if (rain is not None and rain >= IRRIGATION_DELAY_RAIN_MM) or (prob is not None and prob >= IRRIGATION_DELAY_PROBABILITY):
        detail = ", ".join(x for x in (f"{_fmt(rain)} mm" if rain is not None else None, f"{prob}%" if prob is not None else None) if x)
        return {
            "en": f"Farm guidance: rain likely ({detail}) — hold irrigation and avoid spraying.",
            "hi": f"खेती सलाह: बारिश की संभावना ({detail}) — सिंचाई रोकें और छिड़काव न करें।",
            "hinglish": f"Farm guidance: baarish ke chances ({detail}) — irrigation roko aur spray mat karo.",
            "mr": f"शेती सल्ला: पावसाची शक्यता ({detail}) — सिंचन थांबवा आणि फवारणी करू नका.",
        }[lang]
    if wind is not None and wind > SPRAY_MAX_WIND_KMH:
        w = _fmt(wind)
        return {
            "en": f"Farm guidance: wind up to {w} km/h — not suitable for spraying.",
            "hi": f"खेती सलाह: हवा {w} km/h तक — छिड़काव के लिए ठीक नहीं।",
            "hinglish": f"Farm guidance: hawa {w} km/h tak — spray ke liye theek nahi.",
            "mr": f"शेती सल्ला: वारा {w} km/h पर्यंत — फवारणीसाठी योग्य नाही.",
        }[lang]
    if tmax is not None and tmax > SPRAY_MAX_TEMP_C:
        t = _fmt(tmax)
        return {
            "en": f"Farm guidance: up to {t}°C — spray and irrigate in the early morning or evening.",
            "hi": f"खेती सलाह: तापमान {t}°C तक — छिड़काव और सिंचाई सुबह जल्दी या शाम को करें।",
            "hinglish": f"Farm guidance: {t}°C tak garmi — spray aur irrigation subah jaldi ya shaam ko karo.",
            "mr": f"शेती सल्ला: तापमान {t}°C पर्यंत — फवारणी आणि सिंचन पहाटे किंवा संध्याकाळी करा.",
        }[lang]
    return {
        "en": "Farm guidance: conditions suit spraying and field work.",
        "hi": "खेती सलाह: छिड़काव और खेत के काम के लिए मौसम ठीक है।",
        "hinglish": "Farm guidance: spray aur khet ke kaam ke liye mausam theek hai.",
        "mr": "शेती सल्ला: फवारणी आणि शेतीकामासाठी हवामान योग्य आहे.",
    }[lang]


def _aviation(f: WeatherFacts, lang: ResponseLanguage) -> Optional[str]:
    parts = []
    if f.wind_speed_10m is not None:
        parts.append(f"wind {_fmt(f.wind_speed_10m)} km/h")
    if f.wind_gusts_10m is not None:
        parts.append(f"gusts {_fmt(f.wind_gusts_10m)} km/h")
    if f.visibility is not None:
        parts.append(f"visibility {_fmt(f.visibility)} km")
    if f.cloud_cover is not None:
        parts.append(f"cloud cover {_fmt(f.cloud_cover)}%")
    if not parts:
        return None
    label = {"en": "Aviation", "hi": "विमानन", "hinglish": "Aviation", "mr": "विमानवाहतूक"}[lang]
    tail = {"en": " (not a METAR/TAF).", "hi": " (METAR/TAF नहीं)।", "hinglish": " (METAR/TAF nahi).", "mr": " (METAR/TAF नाही)."}[lang]
    return f"{label}: " + ", ".join(parts) + tail


def _disaster(advisory: Optional[AdvisoryResult], lang: ResponseLanguage) -> Optional[str]:
    if advisory is None:
        return None
    level = _SEVERITY[advisory.severity][lang]
    return {
        "en": f"Risk level: {level} ({advisory.condition}).",
        "hi": f"जोखिम स्तर: {level} ({advisory.condition})।",
        "hinglish": f"Risk level: {level} ({advisory.condition}).",
        "mr": f"धोक्याची पातळी: {level} ({advisory.condition}).",
    }[lang]


def _researcher(lang: ResponseLanguage) -> str:
    return {
        "en": "Data: Open-Meteo forecast (multi-model blend), not observations; ask \"What does GFS say?\" for raw GFS.",
        "hi": "डेटा: Open-Meteo पूर्वानुमान (कई मॉडलों का मिश्रण), अवलोकन नहीं; कच्चे GFS के लिए \"GFS क्या कहता है?\" पूछें।",
        "hinglish": "Data: Open-Meteo forecast (multi-model blend), observations nahi; raw GFS ke liye \"GFS kya kehta hai?\" poochho.",
        "mr": "माहिती: Open-Meteo अंदाज (अनेक मॉडेल्सचे मिश्रण), निरीक्षणे नाहीत; कच्च्या GFS साठी \"GFS काय सांगते?\" विचारा.",
    }[lang]


def role_note(
    role: UserRole,
    period_facts: WeatherFacts,
    advisory: Optional[AdvisoryResult],
    language: ResponseLanguage,
) -> Optional[str]:
    if not period_facts.period_available or role == "citizen":
        return None
    if role == "farmer":
        return _farmer(period_facts, language)
    if role == "aviation":
        return _aviation(period_facts, language)
    if role == "disaster_manager":
        return _disaster(advisory, language)
    if role == "researcher":
        return _researcher(language)
    return None
