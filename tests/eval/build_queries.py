"""
Source of tests/eval/queries.jsonl (run this file to regenerate it).

Labels say what a sensible parser should extract, written before tuning the
parser, not what the parser happened to output. Conventions:
- intent: "current_weather" only for now/right-now questions; a named day,
  "today" with a forecast verb, "tonight" etc. is "forecast"; past-years
  comparisons are "climate"; questions about GFS/NWP/"the model" are "nwp".
- location_name: the English city name; null when no place is named.
- date_reference "now" for climate questions (the period is climate_period).
- role: who would typically ask (the role is sent by the client, not parsed;
  role rows check the parser copes with role-flavoured wording).
"""

import json
import os

C, F, CL, N = "current_weather", "forecast", "climate", "nwp"

# (lang, role, query, intent, location, date, parameter, climate_period)
ROWS = [
    # ---------------- English (40)
    ("en", "citizen", "What's the weather in Mumbai right now?", C, "Mumbai", "now", "general", None),
    ("en", "citizen", "Will it rain in Pune tomorrow?", F, "Pune", "tomorrow", "precipitation", None),
    ("en", "citizen", "What is the temperature in Delhi today?", F, "Delhi", "today", "temperature", None),
    ("en", "citizen", "How windy will it be in Chennai tonight?", F, "Chennai", "tonight", "wind", None),
    ("en", "citizen", "Is there a chance of rain in Bengaluru this afternoon?", F, "Bengaluru", "this_afternoon", "rain_likelihood", None),
    ("en", "citizen", "How humid is it in Kolkata right now?", C, "Kolkata", "now", "humidity", None),
    ("en", "citizen", "Will there be a thunderstorm in Nagpur on Friday?", F, "Nagpur", "friday", "storm", None),
    ("en", "disaster_manager", "Any heavy rain expected in Ratnagiri day after tomorrow?", F, "Ratnagiri", "day_after_tomorrow", "heavy_rain", None),
    ("en", "citizen", "How hot will it get in Jaipur tomorrow?", F, "Jaipur", "tomorrow", "high_temperature", None),
    ("en", "disaster_manager", "Strong winds in Visakhapatnam on Sunday?", F, "Visakhapatnam", "sunday", "strong_wind", None),
    ("en", "citizen", "Is it safe to travel to Shimla tomorrow?", F, "Shimla", "tomorrow", "advisory", None),
    ("en", "disaster_manager", "Are there any weather warnings for Guwahati today?", F, "Guwahati", "today", "advisory", None),
    ("en", "citizen", "What's the AQI in Delhi right now?", C, "Delhi", "now", "air_quality", None),
    ("en", "citizen", "How bad is the air pollution in Lucknow today?", F, "Lucknow", "today", "air_quality", None),
    ("en", "citizen", "What is the UV index in Chennai tomorrow?", F, "Chennai", "tomorrow", "uv", None),
    ("en", "researcher", "Is this year hotter than usual in Delhi?", CL, "Delhi", "now", "high_temperature", "this_year"),
    ("en", "researcher", "Has Mumbai been wetter than normal this month?", CL, "Mumbai", "now", "precipitation", "this_month"),
    ("en", "researcher", "How does the last month compare to the historical average in Hyderabad?", CL, "Hyderabad", "now", "general", "last_30_days"),
    ("en", "researcher", "What does GFS say for tomorrow in Pune?", N, "Pune", "tomorrow", "general", None),
    ("en", "researcher", "Show me the NWP model forecast for Kochi tonight", N, "Kochi", "tonight", "general", None),
    ("en", "citizen", "Will it be cold in Srinagar on Monday?", F, "Srinagar", "monday", "temperature", None),
    ("en", "farmer", "Can I spray pesticide in Nashik tomorrow?", F, "Nashik", "tomorrow", "general", None),
    ("en", "farmer", "Should I irrigate my farm in Latur tomorrow?", F, "Latur", "tomorrow", "precipitation", None),
    ("en", "aviation", "What's the visibility at Mumbai airport right now?", C, "Mumbai", "now", "general", None),
    ("en", "aviation", "Crosswind and gusts at Pune tonight?", F, "Pune", "tonight", "wind", None),
    ("en", "disaster_manager", "Flood risk in Kolhapur tomorrow?", F, "Kolhapur", "tomorrow", "heavy_rain", None),
    ("en", "disaster_manager", "Is a cyclone expected near Visakhapatnam on Saturday?", F, "Visakhapatnam", "saturday", "storm", None),
    ("en", "citizen", "Temperature in Bhopal right now", C, "Bhopal", "now", "temperature", None),
    ("en", "citizen", "Will it drizzle in Goa this afternoon?", F, "Goa", "this_afternoon", "precipitation", None),
    ("en", "citizen", "What's the probability of rain in Indore on Thursday?", F, "Indore", "thursday", "rain_likelihood", None),
    ("en", "citizen", "Is it going to be sunny in Udaipur tomorrow?", F, "Udaipur", "tomorrow", "general", None),
    ("en", "researcher", "How much rain did Mumbai get compared to previous years?", CL, "Mumbai", "now", "precipitation", "last_30_days"),
    ("en", "citizen", "Weather in Amritsar tomorrow", F, "Amritsar", "tomorrow", "general", None),
    ("en", "researcher", "What does the weather model predict for Bhubaneswar on Wednesday?", N, "Bhubaneswar", "wednesday", "general", None),
    ("en", "citizen", "Will it rain in Thane tonight?", F, "Thane", "tonight", "precipitation", None),
    ("en", "citizen", "Is the air quality okay for a morning run in Gurugram today?", F, "Gurugram", "today", "air_quality", None),
    ("en", "citizen", "Do I need sunscreen in Jaisalmer tomorrow?", F, "Jaisalmer", "tomorrow", "uv", None),
    ("en", "citizen", "Current weather", C, None, "now", "general", None),
    ("en", "citizen", "Will it rain tomorrow?", F, None, "tomorrow", "precipitation", None),
    ("en", "researcher", "What's the trend in temperatures in Pune this year compared to past years?", CL, "Pune", "now", "temperature", "this_year"),
    # ---------------- Hindi (28)
    ("hi", "citizen", "मुंबई में अभी मौसम कैसा है?", C, "Mumbai", "now", "general", None),
    ("hi", "citizen", "दिल्ली में कल बारिश होगी क्या?", F, "Delhi", "tomorrow", "precipitation", None),
    ("hi", "citizen", "पुणे में आज तापमान कितना है?", F, "Pune", "today", "temperature", None),
    ("hi", "citizen", "चेन्नई में आज रात हवा कितनी चलेगी?", F, "Chennai", "tonight", "wind", None),
    ("hi", "citizen", "कोलकाता में अभी नमी कितनी है?", C, "Kolkata", "now", "humidity", None),
    ("hi", "citizen", "नागपुर में शुक्रवार को तूफान आएगा?", F, "Nagpur", "friday", "storm", None),
    ("hi", "disaster_manager", "जयपुर में परसों भारी बारिश होगी?", F, "Jaipur", "day_after_tomorrow", "heavy_rain", None),
    ("hi", "citizen", "हैदराबाद में कल गर्मी कितनी होगी?", F, "Hyderabad", "tomorrow", "high_temperature", None),
    ("hi", "citizen", "लखनऊ में आज वायु गुणवत्ता कैसी है?", F, "Lucknow", "today", "air_quality", None),
    ("hi", "citizen", "दिल्ली में अभी प्रदूषण कितना है?", C, "Delhi", "now", "air_quality", None),
    ("hi", "citizen", "चेन्नई में कल यूवी इंडेक्स क्या है?", F, "Chennai", "tomorrow", "uv", None),
    ("hi", "researcher", "क्या इस साल दिल्ली में सामान्य से ज्यादा गर्मी है?", CL, "Delhi", "now", "high_temperature", "this_year"),
    ("hi", "researcher", "मुंबई में पिछले साल की तुलना में बारिश ज्यादा हुई क्या?", CL, "Mumbai", "now", "precipitation", "last_30_days"),
    ("hi", "researcher", "पुणे के लिए GFS मॉडल कल क्या कहता है?", N, "Pune", "tomorrow", "general", None),
    ("hi", "citizen", "बेंगलुरु में आज दोपहर बारिश की संभावना?", F, "Bengaluru", "this_afternoon", "rain_likelihood", None),
    ("hi", "citizen", "क्या कल हैदराबाद की यात्रा सुरक्षित है?", F, "Hyderabad", "tomorrow", "advisory", None),
    ("hi", "disaster_manager", "कोलकाता में रविवार को तेज हवा चलेगी?", F, "Kolkata", "sunday", "strong_wind", None),
    ("hi", "citizen", "दिल्ली में सोमवार को ठंड होगी?", F, "Delhi", "monday", "temperature", None),
    ("hi", "citizen", "पटना में आज मौसम कैसा रहेगा?", F, "Patna", "today", "general", None),
    ("hi", "disaster_manager", "मुंबई में आज कोई चेतावनी है?", F, "Mumbai", "today", "advisory", None),
    ("hi", "citizen", "कल बारिश होगी?", F, None, "tomorrow", "precipitation", None),
    ("hi", "citizen", "पुणे में मंगलवार को बारिश होगी?", F, "Pune", "tuesday", "precipitation", None),
    ("hi", "citizen", "चेन्नई में आज रात तापमान?", F, "Chennai", "tonight", "temperature", None),
    ("hi", "disaster_manager", "हैदराबाद में कल बाढ़ का खतरा है क्या?", F, "Hyderabad", "tomorrow", "heavy_rain", None),
    ("hi", "farmer", "क्या किसान कल नाशिक में दवा का छिड़काव कर सकते हैं?", F, "Nashik", "tomorrow", "general", None),
    ("hi", "aviation", "दिल्ली हवाई अड्डे पर अभी हवा कैसी है?", C, "Delhi", "now", "wind", None),
    ("hi", "researcher", "मुंबई में इस महीने बारिश सामान्य से कम रही क्या?", CL, "Mumbai", "now", "precipitation", "this_month"),
    ("hi", "citizen", "बेंगलुरु में अभी आर्द्रता कितनी है?", C, "Bengaluru", "now", "humidity", None),
    # ---------------- Hinglish (28)
    ("hinglish", "citizen", "Mumbai mein abhi mausam kaisa hai?", C, "Mumbai", "now", "general", None),
    ("hinglish", "citizen", "Pune mein kal baarish hogi kya?", F, "Pune", "tomorrow", "precipitation", None),
    ("hinglish", "citizen", "Delhi mein aaj kitni garmi hai?", F, "Delhi", "today", "high_temperature", None),
    ("hinglish", "citizen", "Chennai mein aaj raat tez hawa chalegi kya?", F, "Chennai", "tonight", "strong_wind", None),
    ("hinglish", "citizen", "Kolkata mein humidity kitni hai abhi?", C, "Kolkata", "now", "humidity", None),
    ("hinglish", "citizen", "Nagpur mein Friday ko toofan aayega kya?", F, "Nagpur", "friday", "storm", None),
    ("hinglish", "disaster_manager", "Jaipur mein parso bhari barish hogi?", F, "Jaipur", "day_after_tomorrow", "heavy_rain", None),
    ("hinglish", "citizen", "Hyderabad mein kal tapmaan kitna rahega?", F, "Hyderabad", "tomorrow", "temperature", None),
    ("hinglish", "citizen", "Delhi mein pollution kitna hai aaj?", F, "Delhi", "today", "air_quality", None),
    ("hinglish", "citizen", "Lucknow ka AQI kya hai abhi?", C, "Lucknow", "now", "air_quality", None),
    ("hinglish", "citizen", "Chennai mein kal UV index kitna hoga?", F, "Chennai", "tomorrow", "uv", None),
    ("hinglish", "researcher", "Kya is saal Delhi mein normal se zyada garmi hai?", CL, "Delhi", "now", "high_temperature", "this_year"),
    ("hinglish", "researcher", "Mumbai mein is mahine baarish normal se kam hui kya?", CL, "Mumbai", "now", "precipitation", "this_month"),
    ("hinglish", "researcher", "Pune ke liye GFS model kal kya bol raha hai?", N, "Pune", "tomorrow", "general", None),
    ("hinglish", "citizen", "Bengaluru mein dopahar ko baarish ka chance kitna hai?", F, "Bengaluru", "this_afternoon", "rain_likelihood", None),
    ("hinglish", "citizen", "Kal Shimla jaana safe hai kya?", F, "Shimla", "tomorrow", "advisory", None),
    ("hinglish", "disaster_manager", "Kolkata mein Sunday ko tez hawa chalegi?", F, "Kolkata", "sunday", "strong_wind", None),
    ("hinglish", "citizen", "Delhi mein Monday ko thand hogi?", F, "Delhi", "monday", "temperature", None),
    ("hinglish", "citizen", "Patna mein aaj mausam kaisa rahega?", F, "Patna", "today", "general", None),
    ("hinglish", "disaster_manager", "Mumbai mein aaj koi alert hai kya?", F, "Mumbai", "today", "advisory", None),
    ("hinglish", "citizen", "Kal baarish hogi kya?", F, None, "tomorrow", "precipitation", None),
    ("hinglish", "citizen", "Pune mein mangalvar ko baarish hogi?", F, "Pune", "tuesday", "precipitation", None),
    ("hinglish", "citizen", "Goa mein aaj raat temperature kya rahega?", F, "Goa", "tonight", "temperature", None),
    ("hinglish", "disaster_manager", "Kolhapur mein kal flood ka khatra hai kya?", F, "Kolhapur", "tomorrow", "heavy_rain", None),
    ("hinglish", "farmer", "Nashik mein kal spray kar sakte hain kya?", F, "Nashik", "tomorrow", "general", None),
    ("hinglish", "aviation", "Kal Indore mein hawa kitni tez rahegi?", F, "Indore", "tomorrow", "wind", None),
    ("hinglish", "researcher", "Pichle saal ke comparison mein Chennai mein zyada baarish hui kya?", CL, "Chennai", "now", "precipitation", "last_30_days"),
    ("hinglish", "citizen", "Abhi bahar UV kitna hai?", C, None, "now", "uv", None),
    # ---------------- Marathi (24)
    ("mr", "citizen", "मुंबईत आत्ता हवामान कसे आहे?", C, "Mumbai", "now", "general", None),
    ("mr", "citizen", "पुण्यात उद्या पाऊस पडेल का?", F, "Pune", "tomorrow", "precipitation", None),
    ("mr", "citizen", "नागपुरात आज तापमान किती आहे?", F, "Nagpur", "today", "temperature", None),
    ("mr", "citizen", "नाशिकमध्ये आज रात्री वारा किती असेल?", F, "Nashik", "tonight", "wind", None),
    ("mr", "disaster_manager", "कोल्हापुरात परवा मुसळधार पाऊस होईल का?", F, "Kolhapur", "day_after_tomorrow", "heavy_rain", None),
    ("mr", "disaster_manager", "ठाण्यात शुक्रवारी वादळ येईल का?", F, "Thane", "friday", "storm", None),
    ("mr", "citizen", "सोलापुरात उद्या उकाडा किती असेल?", F, "Solapur", "tomorrow", "high_temperature", None),
    ("mr", "citizen", "पुण्यात आत्ता आर्द्रता किती आहे?", C, "Pune", "now", "humidity", None),
    ("mr", "citizen", "हवेची गुणवत्ता पुण्यात कशी आहे?", C, "Pune", "now", "air_quality", None),
    ("mr", "citizen", "मुंबईत आज प्रदूषण किती आहे?", F, "Mumbai", "today", "air_quality", None),
    ("mr", "citizen", "नागपुरात उद्या UV निर्देशांक किती असेल?", F, "Nagpur", "tomorrow", "uv", None),
    ("mr", "researcher", "या वर्षी पुण्यात नेहमीपेक्षा जास्त उष्णता आहे का?", CL, "Pune", "now", "high_temperature", "this_year"),
    ("mr", "researcher", "मुंबईत या महिन्यात पाऊस सामान्यपेक्षा कमी झाला का?", CL, "Mumbai", "now", "precipitation", "this_month"),
    ("mr", "researcher", "पुण्यासाठी उद्या GFS मॉडेल काय सांगते?", N, "Pune", "tomorrow", "general", None),
    ("mr", "citizen", "साताऱ्यात आज दुपारी पावसाची शक्यता किती?", F, "Satara", "this_afternoon", "rain_likelihood", None),
    ("mr", "citizen", "उद्या रत्नागिरीला प्रवास करणे सुरक्षित आहे का?", F, "Ratnagiri", "tomorrow", "advisory", None),
    ("mr", "disaster_manager", "कोल्हापुरात रविवारी जोरदार वारा असेल का?", F, "Kolhapur", "sunday", "strong_wind", None),
    ("mr", "citizen", "पुण्यात सोमवारी थंडी असेल का?", F, "Pune", "monday", "temperature", None),
    ("mr", "citizen", "औरंगाबादमध्ये आज हवामान कसे राहील?", F, "Chhatrapati Sambhajinagar", "today", "general", None),
    ("mr", "disaster_manager", "मुंबईत आज काही इशारा आहे का?", F, "Mumbai", "today", "advisory", None),
    ("mr", "citizen", "उद्या पाऊस पडेल का?", F, None, "tomorrow", "precipitation", None),
    ("mr", "citizen", "पुण्यात मंगळवारी पाऊस पडेल का?", F, "Pune", "tuesday", "precipitation", None),
    ("mr", "farmer", "शेतकऱ्यांनी उद्या नाशिकमध्ये फवारणी करावी का?", F, "Nashik", "tomorrow", "general", None),
    ("mr", "citizen", "punyat udya paus padel ka?", F, "Pune", "tomorrow", "precipitation", None),
]


def main() -> None:
    out = os.path.join(os.path.dirname(__file__), "queries.jsonl")
    with open(out, "w", encoding="utf-8", newline="\n") as f:
        for i, (lang, role, query, intent, loc, date, param, period) in enumerate(ROWS, 1):
            expected = {
                "intent": intent,
                "location_name": loc,
                "date_reference": date,
                "weather_parameter": param,
                "language": lang,
            }
            if intent == "climate":
                expected["climate_period"] = period
            f.write(json.dumps({"id": i, "lang": lang, "role": role, "query": query, "expected": expected}, ensure_ascii=False) + "\n")
    print(f"wrote {len(ROWS)} queries to {out}")


if __name__ == "__main__":
    main()


# Held-out set: written after the parser was tuned on ROWS and scored once,
# without tuning against it (python build_queries.py writes both files).
HELDOUT = [
    ("en", "citizen", "Is it raining in Kanpur at the moment?", C, "Kanpur", "now", "precipitation", None),
    ("en", "citizen", "What will the maximum temperature be in Surat on Saturday?", F, "Surat", "saturday", "high_temperature", None),
    ("en", "farmer", "Will the wind be too strong to spray in Akola tomorrow?", F, "Akola", "tomorrow", "strong_wind", None),
    ("en", "aviation", "Any thunderstorms forecast for Nagpur tonight?", F, "Nagpur", "tonight", "storm", None),
    ("en", "researcher", "Was last month wetter than average in Kochi?", CL, "Kochi", "now", "precipitation", "last_30_days"),
    ("en", "citizen", "Air quality index for Noida tomorrow?", F, "Noida", "tomorrow", "air_quality", None),
    ("hi", "citizen", "भोपाल में अभी बारिश हो रही है क्या?", C, "Bhopal", "now", "precipitation", None),
    ("hi", "citizen", "इंदौर में शनिवार को अधिकतम तापमान कितना रहेगा?", F, "Indore", "saturday", "temperature", None),
    ("hi", "disaster_manager", "गुवाहाटी में कल बाढ़ का खतरा?", F, "Guwahati", "tomorrow", "heavy_rain", None),
    ("hi", "citizen", "शिमला में आज रात ठंड कितनी होगी?", F, "Shimla", "tonight", "temperature", None),
    ("hi", "researcher", "क्या इस साल पटना में सामान्य से कम बारिश हुई?", CL, "Patna", "now", "precipitation", "this_year"),
    ("hi", "citizen", "दिल्ली में कल हवा की गुणवत्ता कैसी रहेगी?", F, "Delhi", "tomorrow", "air_quality", None),
    ("hinglish", "citizen", "Bhopal mein abhi baarish ho rahi hai kya?", C, "Bhopal", "now", "precipitation", None),
    ("hinglish", "citizen", "Surat mein Saturday ko kitni garmi hogi?", F, "Surat", "saturday", "high_temperature", None),
    ("hinglish", "disaster_manager", "Guwahati mein kal flood ka risk hai kya?", F, "Guwahati", "tomorrow", "heavy_rain", None),
    ("hinglish", "citizen", "Shimla mein aaj raat thand kitni hogi?", F, "Shimla", "tonight", "temperature", None),
    ("hinglish", "researcher", "Is saal Patna mein normal se kam baarish hui kya?", CL, "Patna", "now", "precipitation", "this_year"),
    ("hinglish", "citizen", "Noida mein kal AQI kitna rahega?", F, "Noida", "tomorrow", "air_quality", None),
    ("mr", "citizen", "लातूरमध्ये आत्ता पाऊस पडतोय का?", C, "Latur", "now", "precipitation", None),
    ("mr", "citizen", "अमरावतीत शनिवारी कमाल तापमान किती असेल?", F, "Amravati", "saturday", "temperature", None),
    ("mr", "disaster_manager", "रत्नागिरीत उद्या पुराचा धोका आहे का?", F, "Ratnagiri", "tomorrow", "heavy_rain", None),
    ("mr", "citizen", "नाशिकमध्ये आज रात्री थंडी किती असेल?", F, "Nashik", "tonight", "temperature", None),
    ("mr", "researcher", "यंदा लातूरमध्ये सामान्यपेक्षा कमी पाऊस झाला का?", CL, "Latur", "now", "precipitation", "this_year"),
    ("mr", "farmer", "नांदेडमध्ये उद्या वारा फवारणीसाठी योग्य आहे का?", F, "Nanded", "tomorrow", "wind", None),
]


def write_heldout() -> None:
    global ROWS
    out = os.path.join(os.path.dirname(__file__), "heldout.jsonl")
    with open(out, "w", encoding="utf-8", newline="\n") as f:
        for i, (lang, role, query, intent, loc, date, param, period) in enumerate(HELDOUT, 1):
            expected = {"intent": intent, "location_name": loc, "date_reference": date, "weather_parameter": param, "language": lang}
            if intent == "climate":
                expected["climate_period"] = period
            f.write(json.dumps({"id": i, "lang": lang, "role": role, "query": query, "expected": expected}, ensure_ascii=False) + "\n")
    print(f"wrote {len(HELDOUT)} held-out queries to {out}")


if __name__ == "__main__":
    write_heldout()
