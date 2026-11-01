"""
WMO weather-code descriptions in the reply languages.

English lives in ``query_service.WMO_DESCRIPTIONS`` (it is also the API's
``weather_description``). These tables translate the same codes so Hindi,
Hinglish and Marathi replies do not fall back to English phrases such as
"Dense drizzle". Hinglish is lower-case romanised Hindi, as in the templates.
"""

from __future__ import annotations

from typing import Optional

from query_service import WMO_DESCRIPTIONS

WMO_DESCRIPTIONS_I18N: dict[str, dict[int, str]] = {
    "hi": {
        0: "साफ़ आसमान",
        1: "ज़्यादातर साफ़ आसमान",
        2: "आंशिक रूप से बादल",
        3: "पूरी तरह बादल छाए",
        45: "कोहरा",
        48: "पाला जमाने वाला कोहरा",
        51: "हल्की बूँदाबाँदी",
        53: "बूँदाबाँदी",
        55: "तेज़ बूँदाबाँदी",
        56: "हल्की जमने वाली बूँदाबाँदी",
        57: "तेज़ जमने वाली बूँदाबाँदी",
        61: "हल्की बारिश",
        63: "बारिश",
        65: "भारी बारिश",
        66: "हल्की जमने वाली बारिश",
        67: "भारी जमने वाली बारिश",
        71: "हल्की बर्फ़बारी",
        73: "बर्फ़बारी",
        75: "भारी बर्फ़बारी",
        77: "बर्फ़ के दाने",
        80: "हल्की बौछारें",
        81: "बारिश की बौछारें",
        82: "तेज़ बौछारें",
        85: "हल्की बर्फ़ की बौछारें",
        86: "भारी बर्फ़ की बौछारें",
        95: "गरज वाला तूफ़ान",
        96: "हल्के ओलों के साथ गरज वाला तूफ़ान",
        99: "भारी ओलों के साथ गरज वाला तूफ़ान",
    },
    "hinglish": {
        0: "saaf aasmaan",
        1: "zyaadatar saaf aasmaan",
        2: "thode baadal",
        3: "poore baadal chhaaye",
        45: "kohra",
        48: "paala jamaane wala kohra",
        51: "halki boondabaandi",
        53: "boondabaandi",
        55: "tez boondabaandi",
        56: "halki jamne wali boondabaandi",
        57: "tez jamne wali boondabaandi",
        61: "halki baarish",
        63: "baarish",
        65: "bhaari baarish",
        66: "halki jamne wali baarish",
        67: "bhaari jamne wali baarish",
        71: "halki barfbaari",
        73: "barfbaari",
        75: "bhaari barfbaari",
        77: "barf ke daane",
        80: "halki bauchhaarein",
        81: "baarish ki bauchhaarein",
        82: "tez bauchhaarein",
        85: "halki barf ki bauchhaarein",
        86: "bhaari barf ki bauchhaarein",
        95: "garaj wala toofaan",
        96: "halke olon ke saath garaj wala toofaan",
        99: "bhaari olon ke saath garaj wala toofaan",
    },
    "mr": {
        0: "निरभ्र आकाश",
        1: "बहुतांश निरभ्र आकाश",
        2: "अंशतः ढगाळ",
        3: "पूर्ण ढगाळ",
        45: "धुके",
        48: "हिमकण जमवणारे धुके",
        51: "हलकी रिमझिम",
        53: "रिमझिम",
        55: "जोरदार रिमझिम",
        56: "हलकी गोठवणारी रिमझिम",
        57: "जोरदार गोठवणारी रिमझिम",
        61: "हलका पाऊस",
        63: "पाऊस",
        65: "मुसळधार पाऊस",
        66: "हलका गोठवणारा पाऊस",
        67: "जोरदार गोठवणारा पाऊस",
        71: "हलकी बर्फवृष्टी",
        73: "बर्फवृष्टी",
        75: "जोरदार बर्फवृष्टी",
        77: "बर्फाचे कण",
        80: "पावसाच्या हलक्या सरी",
        81: "पावसाच्या सरी",
        82: "पावसाच्या जोरदार सरी",
        85: "बर्फाच्या हलक्या सरी",
        86: "बर्फाच्या जोरदार सरी",
        95: "गडगडाटी वादळ",
        96: "हलक्या गारांसह गडगडाटी वादळ",
        99: "मोठ्या गारांसह गडगडाटी वादळ",
    },
}

_CODE_BY_ENGLISH = {text: code for code, text in WMO_DESCRIPTIONS.items()}


def localized_description(code: Optional[int], english: Optional[str], language: str) -> Optional[str]:
    """The description in ``language``; English (or an unknown code) is returned unchanged."""
    if english is None and code is None:
        return None
    table = WMO_DESCRIPTIONS_I18N.get(language)
    if table is None:
        return english
    if code is None and english is not None:
        code = _CODE_BY_ENGLISH.get(english)
    return table.get(code, english) if code is not None else english
