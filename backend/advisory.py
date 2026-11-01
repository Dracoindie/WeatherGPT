"""
Deterministic weather intelligence module.
Provides transparent, threshold-based interpretations of weather facts.
"""

from typing import List, NamedTuple
from models.chat import AdvisoryResult, ResponseLanguage, WeatherFacts, WeatherParameter

# Conservative Fallback Thresholds
# These thresholds are used as reasonable fallbacks for generating advisories
# since there are no scientifically validated models in the current project scope.

HEAVY_RAIN_MM = 15.0      # 15 mm in a period is considered moderate-to-heavy
EXTREME_RAIN_MM = 50.0    # 50+ mm is extreme
HIGH_WIND_KMH = 40.0      # 40 km/h is strong
STORM_WIND_KMH = 65.0     # 65+ km/h is gale/storm
HOT_TEMP_C = 35.0         # 35C is hot
EXTREME_HEAT_C = 40.0     # 40C+ is extreme heat
COLD_TEMP_C = 5.0         # 5C is cold

_SEVERITY_RANK = {"low": 0, "moderate": 1, "high": 2}


# Conditions that mean no threshold check fired.
UNKNOWN_CONDITION = "Unknown"
ROUTINE_CONDITION = "Routine conditions"
ACTIVE_CONDITION = "Active Conditions"
_UNTRIGGERED_CONDITIONS = {UNKNOWN_CONDITION, ROUTINE_CONDITION, ACTIVE_CONDITION}

# Advisory text by language, keyed by the English advisory string.
_ADVISORY_TRANSLATIONS: dict[str, dict[str, str]] = {
    "Severe precipitation expected. Avoid unnecessary travel and stay clear of waterlogged areas.": {
        "hi": "भारी वर्षा की संभावना है। अनावश्यक यात्रा से बचें और जलभराव वाले क्षेत्रों से दूर रहें।",
        "hinglish": "Bahut tez baarish expected hai. Bina zaroorat travel na karein aur paani bhare areas se door rahein.",
        "mr": "अतिवृष्टीची शक्यता आहे. अनावश्यक प्रवास टाळा आणि पाणी साचलेल्या भागांपासून दूर राहा.",
    },
    "Heavy rain expected. Carry an umbrella and expect minor travel delays.": {
        "hi": "तेज़ बारिश की संभावना है। छाता साथ रखें और यात्रा में थोड़ी देरी की उम्मीद रखें।",
        "hinglish": "Tez baarish expected hai. Chhata saath rakhein aur travel mein thodi der ho sakti hai.",
        "mr": "मुसळधार पावसाची शक्यता आहे. छत्री सोबत ठेवा; प्रवासाला थोडा उशीर होऊ शकतो.",
    },
    "Some rain is expected, but conditions remain largely manageable.": {
        "hi": "कुछ बारिश की संभावना है, लेकिन हालात सामान्यतः ठीक रहेंगे।",
        "hinglish": "Thodi baarish expected hai, lekin conditions mostly manageable rahengi.",
        "mr": "थोडा पाऊस अपेक्षित आहे, पण परिस्थिती बहुतांशी नियंत्रणात राहील.",
    },
    "Dangerous heat levels. Stay indoors, stay hydrated, and avoid direct sun exposure.": {
        "hi": "खतरनाक गर्मी। घर के अंदर रहें, पानी पीते रहें और सीधी धूप से बचें।",
        "hinglish": "Khatarnak garmi hai. Ghar ke andar rahein, paani peete rahein aur seedhi dhoop se bachein.",
        "mr": "धोकादायक उष्णता. घरात राहा, भरपूर पाणी प्या आणि थेट उन्हापासून दूर राहा.",
    },
    "Hot conditions expected. Keep hydrated if spending time outdoors.": {
        "hi": "गर्मी रहेगी। बाहर जाएँ तो पानी पीते रहें।",
        "hinglish": "Garmi rahegi. Bahar time bitayein toh paani peete rahein.",
        "mr": "उष्ण हवामान अपेक्षित आहे. बाहेर असाल तर पाणी पित राहा.",
    },
    "Cold temperatures expected. Dress warmly.": {
        "hi": "ठंड रहेगी। गर्म कपड़े पहनें।",
        "hinglish": "Thand rahegi. Garam kapde pehnein.",
        "mr": "थंडी अपेक्षित आहे. उबदार कपडे घाला.",
    },
    "Dangerous wind speeds. Secure loose objects and avoid outdoor activities.": {
        "hi": "खतरनाक तेज़ हवाएँ। ढीली चीज़ें सुरक्षित करें और बाहरी गतिविधियों से बचें।",
        "hinglish": "Khatarnak tez hawa hai. Dheeli cheezein secure karein aur outdoor activities avoid karein.",
        "mr": "धोकादायक वेगाचा वारा. सैल वस्तू सुरक्षित करा आणि बाहेरची कामे टाळा.",
    },
    "Breezy to strong winds expected. Exercise caution if driving high-profile vehicles.": {
        "hi": "तेज़ हवाएँ चलेंगी। ऊँचे वाहन चलाते समय सावधानी रखें।",
        "hinglish": "Tez hawa chalegi. Oonchi gaadiyan chalate waqt dhyan rakhein.",
        "mr": "जोरदार वारा अपेक्षित आहे. उंच वाहने चालवताना काळजी घ्या.",
    },
    "Weather conditions are currently normal with no significant risks.": {
        "hi": "मौसम अभी सामान्य है, कोई खास खतरा नहीं है।",
        "hinglish": "Mausam abhi normal hai, koi khaas risk nahi hai.",
        "mr": "सध्या हवामान सामान्य आहे; विशेष धोका नाही.",
    },
}


def localized_advisory(result: AdvisoryResult, language: ResponseLanguage) -> str:
    """Advisory text in the reply language; falls back to English."""
    if language == "en":
        return result.advisory
    return _ADVISORY_TRANSLATIONS.get(result.advisory, {}).get(language, result.advisory)


def should_mention_advisory(result: AdvisoryResult, parameter: WeatherParameter) -> bool:
    """Append the advisory to the reply only if a check fired or one was asked for."""
    if result.condition not in _UNTRIGGERED_CONDITIONS:
        return True
    return parameter == "advisory" and result.condition == ROUTINE_CONDITION


class _Trigger(NamedTuple):
    severity: str
    condition: str
    advisory: str


def evaluate_advisory(facts: WeatherFacts, parameter: WeatherParameter) -> AdvisoryResult:
    if not facts.period_available:
        return AdvisoryResult(
            severity="low",
            condition=UNKNOWN_CONDITION,
            advisory="Forecast data is unavailable for the requested time.",
            reasons=["No data available to evaluate."]
        )

    # Extract reliable values: heat uses the period max, cold uses the period min.
    temp_high = facts.temperature_max if facts.temperature_max is not None else facts.temperature_2m
    temp_low = facts.temperature_min if facts.temperature_min is not None else facts.temperature_2m
    wind = facts.wind_speed_10m
    rain = facts.precipitation
    rain_prob = facts.precipitation_probability

    # Every check appends its trigger; none overwrites another. The most severe
    # trigger becomes the primary condition (ties keep check order: rain, heat,
    # cold, wind) and all reasons are kept.
    triggers: List[_Trigger] = []
    reasons: List[str] = []
    is_rain = False

    # Check Rain
    if rain is not None and rain >= EXTREME_RAIN_MM:
        triggers.append(_Trigger(
            "high",
            "Extreme Rain / Flood Risk",
            "Severe precipitation expected. Avoid unnecessary travel and stay clear of waterlogged areas.",
        ))
        reasons.append(f"Precipitation is forecasted at {rain} mm.")
        is_rain = True
    elif rain is not None and rain >= HEAVY_RAIN_MM:
        triggers.append(_Trigger(
            "moderate",
            "Heavy Rain",
            "Heavy rain expected. Carry an umbrella and expect minor travel delays.",
        ))
        reasons.append(f"Precipitation is forecasted at {rain} mm.")
        is_rain = True
    elif parameter in ("heavy_rain", "storm", "rain_likelihood") and rain is not None and rain > 0:
        # If they explicitly asked about rain, and there's some rain
        triggers.append(_Trigger(
            "low",
            "Light to Moderate Rain",
            "Some rain is expected, but conditions remain largely manageable.",
        ))
        reasons.append(f"Precipitation is forecasted at {rain} mm.")

    if rain_prob is not None and rain_prob > 50 and not is_rain:
        reasons.append(f"There is a {rain_prob}% chance of rain.")

    # Check Heat
    if temp_high is not None and temp_high >= EXTREME_HEAT_C:
        triggers.append(_Trigger(
            "high",
            "Extreme Heat",
            "Dangerous heat levels. Stay indoors, stay hydrated, and avoid direct sun exposure.",
        ))
        reasons.append(f"Temperatures reaching {temp_high}°C.")
    elif temp_high is not None and temp_high >= HOT_TEMP_C:
        triggers.append(_Trigger(
            "moderate",
            "High Heat",
            "Hot conditions expected. Keep hydrated if spending time outdoors.",
        ))
        reasons.append(f"Temperatures reaching {temp_high}°C.")

    # Check Cold
    if temp_low is not None and temp_low <= COLD_TEMP_C:
        triggers.append(_Trigger(
            "moderate",
            "Cold / Chilly",
            "Cold temperatures expected. Dress warmly.",
        ))
        reasons.append(f"Temperatures dropping to {temp_low}°C.")

    # Check Wind
    if wind is not None and wind >= STORM_WIND_KMH:
        triggers.append(_Trigger(
            "high",
            "Storm / Gale Winds",
            "Dangerous wind speeds. Secure loose objects and avoid outdoor activities.",
        ))
        reasons.append(f"Wind speeds reaching {wind} km/h.")
    elif wind is not None and wind >= HIGH_WIND_KMH:
        triggers.append(_Trigger(
            "moderate",
            "Strong Winds",
            "Breezy to strong winds expected. Exercise caution if driving high-profile vehicles.",
        ))
        reasons.append(f"Wind speeds reaching {wind} km/h.")

    if triggers:
        primary = max(triggers, key=lambda t: _SEVERITY_RANK[t.severity])
        return AdvisoryResult(
            severity=primary.severity,
            condition=primary.condition,
            advisory=primary.advisory,
            reasons=reasons,
        )

    severity = "low"
    condition = ROUTINE_CONDITION
    advisory = "No specific weather advisories at this time."

    # Default fallbacks if the user specifically asked for an advisory but nothing crossed the threshold
    if parameter == "advisory" and len(reasons) == 0:
        advisory = "Weather conditions are currently normal with no significant risks."
        reasons.append("Temperatures, precipitation, and winds are well within safe operating thresholds.")
    elif len(reasons) > 0:
        # e.g. a high chance of rain with no threshold crossed
        condition = ACTIVE_CONDITION
        advisory = "Conditions are active but within moderate levels."

    return AdvisoryResult(
        severity=severity,
        condition=condition,
        advisory=advisory,
        reasons=reasons
    )
