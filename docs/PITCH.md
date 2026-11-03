# WeatherGPT pitch kit (SIH26068)

Everything here is true of the repo as of this commit. If a number changes, change it here too.

## Numbers you can quote

| Claim | Value | Source |
|-------|-------|--------|
| Parser accuracy, held-out (the headline) | **91.7%** exact match on 24 EN/HI/Hinglish/MR questions, written after tuning and scored once (41.7% before) | `IMPROVEMENTS_REPORT.md`, `tests/eval/heldout.jsonl` |
| Parser accuracy, tuning set | 99.2% on 120 questions. **Optimistic**: the parser was fixed against this set. | same |
| Languages | English, Hindi (Devanagari), Hinglish (romanised), Marathi: replies, UI, weather descriptions, voice | `llm/`, `I18nContext.tsx` |
| Data sources | Open-Meteo (forecast, archive, CAMS air quality), NOAA GFS 0.25°, Nominatim | `CLAUDE.md` |
| Backend tests | 679, all mocked (no network) | `pytest tests/` |
| Accessibility | axe (WCAG 2.1 AA) on every route, desktop and mobile | `e2e/a11y.spec.ts` |

**Do not claim:**
- IMD integration;
- official warnings;
- CPCB station AQI (ours is modelled from CAMS);
- WRF (WRF questions get GFS);
- METAR/TAF;
- tested speech recognition in Marathi on real phones;
- any accuracy figure for the *forecast itself*. We measure the parser, not the weather.

## Before you start

- **Have the backend and frontend running on the laptop.** Use `npm run build; npm run start` for the frontend.
- **If Wi-Fi is doubtful,** record fixtures that morning and start the backend with `DEMO_REPLAY=1` (`docs/DEMO.md`). The amber "Replay: recorded data from …" badge then appears. **Say so:** "this is data recorded at 8:15 this morning, because the venue Wi-Fi is unreliable."
- **Be signed in** with a real account that has an alert subscription, for **Send test alert** (`IMPROVEMENTS_REPORT.md` → "See a real test notification"). Allow notifications in the browser and in Windows.
- **Open these in tabs:** `/` (home), `/alerts`, `/disaster`.
- **Language buttons:** EN / हि / Hinglish / मरा are in the nav. The **role selector** is under **Settings** (and in the nav on wide screens).

## 2-minute live demo

| Time | Do | Say |
|------|----|-----|
| 0:00 | Home (`/`), empty sky | "WeatherGPT is a conversational weather assistant for India. Its one rule: **the AI never makes up a number.**" |
| 0:10 | Type `Will it rain in Pune tomorrow?`, Enter | "Real Open-Meteo data. The sky scene is driven by the real weather code and wind. Every number in this sentence is checked against the data before it's shown." |
| 0:30 | Type `What about Mumbai?` | "Follow-ups keep context: same day, new city." |
| 0:40 | Switch to **हि**, type `दिल्ली में कल बारिश होगी क्या?` | "Hindi, Hinglish and Marathi too, in the reply *and* the interface." |
| 0:55 | Press **D**, pick **Storm** | "Presenter controls: this only changes the sky, so you can see the effects. The numbers stay real, and the 'DEMO MODE' badge says so." Press **D** again to close. |
| 1:05 | Settings → role **Farmer**, type `Can I spray pesticide in Nashik tomorrow?` | "The role changes the advice, never the numbers: spray, irrigation and harvest windows from documented thresholds." |
| 1:25 | Open **`/disaster`** | "For disaster managers: districts sorted by severity, from one threshold table that also drives chat, push and CAP." |
| 1:40 | Open **`/alerts`**, tap **Send test alert** | "Early warning: Web Push when severity becomes 'warning', plus CAP 1.2 export and WhatsApp share. Every alert says it's from WeatherGPT, not an official IMD warning." |
| 1:55 | — | "Mobile-first, installable, works offline, 91.7% understanding on unseen multilingual questions." |

## 5-minute version

1. **Hook (0:00–0:30).**
   - "Weather data in India exists, but a farmer in Nashik or a DM in Ratnagiri can't easily ask it a question in their own language. Generic chatbots answer confidently, and they invent numbers."
2. **Chat and grounding (0:30–1:30).**
   - `Will it rain in Pune tomorrow?`, then `What about Mumbai?`.
   - Point at the location panel and the AQI/UV panels.
   - **Scrub the 7-day timeline:** drag across it, or Tab to it and use the arrow keys. Every hour is real data.
   - Explain the pipeline: data → validation → facts → wording. An optional LLM only rewords, and is rejected if any number isn't in the facts.
3. **Languages and voice (1:30–2:15).**
   - **Hinglish:** `Pune mein kal baarish hogi kya?`, then `aur parso?`.
   - **Marathi** (मरा): `पुण्यात उद्या पाऊस पडेल का?`.
   - Tap the mic and ask in Hindi; the reply is spoken (en-IN / hi-IN / mr-IN).
4. **Sky scenes (2:15–2:35).**
   - Press **D**, then click through Rain → Storm → Fog → Night.
   - "Visual only: the data panels never change."
5. **Roles (2:35–3:35).**
   - **Farmer:** `Can I spray pesticide in Nashik tomorrow?` gives spray, irrigation, harvest and sowing windows.
   - **Aviation:** `Is it safe to fly from Nagpur today?` gives visibility, cloud, wind and gusts in knots, plus flags. "A briefing, not a METAR."
   - **Researcher:**
     - `What does GFS say for tomorrow in Pune?` gives NOAA GFS 0.25° beside Open-Meteo, with bias and MAD.
     - `Has Mumbai been wetter than normal this month?` compares with the same dates over the last 10 years.
6. **Warning chain (3:35–4:30).**
   - **`/disaster` board:** 15 districts, most severe first, with a severity map.
   - **`/alerts`:**
     - the threshold table: "one source of truth";
     - **Send test alert**: the OS notification arrives;
     - **Download CAP** (CAP 1.2 XML, the format alerting systems exchange);
     - **WhatsApp share** on an alert card.
7. **Close (4:30–5:00).**
   - Mobile PWA: installable, lite mode on 2G/3G, last forecast offline.
   - "91.7% on held-out questions. Every alert is labelled unofficial. The IMD integration path is ready." (See Q3.)

## 10 likely judge questions

1. **Where does the data come from, and how accurate is it?**
   - Open-Meteo for current conditions and the 7-day hourly forecast, its archive for climate, and CAMS for air quality. NOAA GFS 0.25° for the NWP view. Nominatim for places.
   - We don't claim forecast accuracy of our own; that belongs to those models. The researcher view shows GFS vs Open-Meteo bias and MAD, so disagreement is visible.
   - What we measured is **query understanding: 91.7% exact match on a held-out multilingual set** (99.2% on the tuning set, which is optimistic).
2. **How do you stop the AI hallucinating?**
   - The LLM is never the source of facts. Numbers come from validated API data, turned into a facts object, and templates write the reply by default.
   - If an LLM rewords it, the output is rejected unless every number appears in the facts (`is_grounded`). There is a test for each reply type.
   - The LLM is optional: it runs with `LLM_PROVIDER=none`.
3. **What about IMD?**
   - Not integrated today, and we say so on every alert.
   - The path: IMD would be another source behind the same validation → facts layer, and official warnings would be shown *as* IMD's, beside ours.
   - Our CAP 1.2 export is the format official alerting uses, so the hand-off is standard.
4. **Scalability and cost?**
   - Stateless FastAPI and a static-friendly Next.js PWA. Every data source is free with no key.
   - Geocoding is cached for 24 h in memory, with a persistent 30-day cache, and rate-limited to Nominatim's 1 request per second.
   - Deploy on Render/Railway plus Vercel (`docs/DEPLOYMENT.md`).
   - Limits we know: the push test rate limit is per process, GFS decoding needs about 512 MB+, and at scale we'd need a paid Open-Meteo plan or self-hosting.
5. **Privacy?**
   - Demo mode needs no account.
   - Signed-in data (default location, role, push subscriptions) is in Supabase with row-level security. The backend verifies the JWT and reads only the caller's row.
   - Secrets never reach the browser.
   - Voice uses the browser's speech APIs.
6. **What's not done yet?**
   - No IMD feed and no WRF.
   - AQI is modelled, not CPCB stations.
   - Marathi speech recognition is untested on real phones.
   - Signed-in flows aren't covered by end-to-end tests.
   - Smart-city monitoring is partial (AQI/UV and the district board).
   - Not deployed publicly yet.
7. **Why Open-Meteo rather than IMD APIs?**
   - Open, documented, no key, hourly global coverage including India, with archive and air-quality endpoints in the same shape.
   - So we could build and test the whole pipeline. The source layer is swappable.
8. **What about offline and low-bandwidth users?**
   - Installable PWA; the app shell and the last forecast work offline.
   - Automatic lite mode (Save-Data, 2G/3G, ≤2 GB RAM or ≤2 cores) drops the 3D sky: about 316 kB gzip of JS instead of 565 kB on the home page.
   - Voice for people who'd rather not type.
   - WhatsApp share for forwarding.
9. **How reliable are the alerts?**
   - Deterministic: one threshold table (`backend/thresholds.py`) drives chat advisories, the alert engine, the board, push and CAP, so they can't disagree.
   - Push fires only when severity *becomes* "warning", so there's no repeat spam.
   - The alerts API retries, then serves the last good data marked stale, then fails clearly.
   - Thresholds are ours, not IMD criteria, and labelled as such.
10. **Future work?**
    - IMD and CPCB feeds.
    - SMS/IVR for feature phones.
    - Station data for verification.
    - More Indian languages.
    - Validating role thresholds with agronomists and ATC.
    - A forecast-verification dashboard.

## 10-slide outline (mapped to SIH26068)

| # | Slide | Content | SIH26068 point |
|---|-------|---------|----------------|
| 1 | Title | WeatherGPT: ask the sky, in your language. Team, PS SIH26068. | — |
| 2 | Problem | Weather data exists but isn't conversational, multilingual or role-specific; chatbots invent numbers. | Problem context |
| 3 | Solution | Living Sky chat: EN/HI/Hinglish/MR, voice, follow-ups. Screenshot. | Conversational AI, multilingual, NL queries |
| 4 | Trust | Pipeline diagram (data → validation → facts → words; LLM rewords only, number check). 91.7% held-out. | LLM query understanding, real-time data |
| 5 | Data | Open-Meteo real-time and 7-day hourly, GFS NWP, 10-year climate archive, CAMS AQI. | Real-time and forecast, NWP (GFS), climate trends |
| 6 | Roles | Farmer, aviation, disaster manager, researcher: same numbers, different advice. | Role-specific advisories |
| 7 | Early warning | Threshold table → alert engine → Web Push, CAP 1.2, WhatsApp; district risk board and map. "Not official IMD." | Extreme-weather alerts, dissemination, GIS |
| 8 | Mobile and access | PWA, offline, lite mode, voice, WCAG 2.1 AA checks. | Mobile-based platform |
| 9 | Honest status | Done vs not done (Q6), tests (679 backend, e2e incl. axe), deploy plan. | — |
| 10 | Roadmap and ask | IMD/CPCB integration, SMS/IVR, more languages, pilots with a district and an FPO. | Scalability |
