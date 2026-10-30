'use client'

/**
 * i18n context — adapted from Lovable's src/lib/i18n.tsx.
 * Supports English and Hindi. Hinglish falls back to English.
 * TanStack dependency removed; uses React context only.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

const dict = {
  en: {
    'brand.tag': 'Weather Intelligence',
    'nav.primary': 'Primary navigation',
    'nav.menu': 'Open menu',
    'nav.dashboard': 'Dashboard',
    'nav.map': 'Map',
    'nav.alerts': 'Alerts',
    'nav.climate': 'Climate',
    'nav.settings': 'Settings',
    'current.title': 'Current Conditions',
    'current.error': 'Could not load weather data.',
    'current.unconfigured': 'API not configured.',
    'current.empty': 'Select a location to see conditions.',
    'forecast.title': '7-Day Forecast',
    'forecast.empty': 'Select a location to see the forecast.',
    'intel.title': 'Weather Intelligence',
    'intel.empty': 'No active advisory for this location.',
    'intel.why': 'Why',
    'intel.action': 'Recommended action',
    'field.precipitation': 'Precipitation',
    'field.wind': 'Wind',
    'field.condition': 'Condition',
    'field.updated': 'Updated',
    'chat.placeholder': 'Pune mein kal baarish hogi kya?',
    'chat.ask': 'Ask',
    'chat.asking': '…',
    'chat.label': 'Ask about the weather',
    'chat.hint': 'Name a city in your question, or pick a location first.',
    'location.button': 'Use my current location',
    'location.detecting': 'Detecting…',
    'location.denied': 'Location denied',
    'location.error': 'Could not detect location',
    'location.manual': 'Enter city name',
    'trust.source': 'Source: Open-Meteo',
    'severity.low': 'Low',
    'severity.moderate': 'Moderate',
    'severity.high': 'High',
    'severity.advisory': 'Advisory',
    'severity.watch': 'Watch',
    'severity.warning': 'Warning',
    'alerts.title': 'Weather Alerts',
    'alerts.none': 'No active alerts for this location.',
    'alerts.routine': 'Conditions are currently within normal safe operating thresholds.',
    'alerts.action': 'Recommended Action',
    'alerts.threshold': 'Triggered Threshold',
    'voice.listening': 'Listening… Speak your question',
    'voice.speaking': 'Speaking response…',
    'voice.start': 'Start voice question',
    'voice.stop': 'Stop listening',
    'voice.stopSpeaking': 'Stop speaking',
    'voice.denied': 'Microphone permission denied',
    'voice.unsupported': 'Voice not supported in this browser',
    'nav.home': 'Living Sky',
    'nav.classic': 'Classic',
    'nav.signin': 'Sign in',
    'sky.title': 'Ask the Sky',
    'sky.subtitle': 'Live atmosphere console · English · हिंदी · Hinglish',
    'sky.send': 'Transmit',
    'sky.useLocation': 'Use my location',
    'sky.locating': 'Locating…',
    'sky.scanning': 'Scanning atmosphere',
    'sky.thread': 'Transmission log',
    'sky.threadEmpty': 'No transmissions yet. Ask about any city.',
    'sky.error': 'Uplink failed',
    'sky.needLocation': 'Location required',
    'sky.signedIn': 'Saved location enabled',
    'panel.temperature': 'Temperature',
    'panel.rain': 'Precipitation',
    'panel.wind': 'Wind',
    'panel.humidity': 'Humidity',
    'panel.location': 'Location lock',
    'panel.condition': 'Sky condition',
    'panel.timeline': 'Forecast timeline · 72 h',
    'panel.map': 'Geo lock',
    'panel.advisory': 'Advisory',
    'source.explicit_query': 'Query',
    'source.request_coordinates': 'GPS',
    'source.trusted_user_default': 'Saved',
    'sky.verified': 'Source: Open-Meteo · verified',
    'sky.live': 'Live',
    'sky.preview': 'Preview',
    'sky.unavailable': 'Not in forecast window',
  },
  hi: {
    'brand.tag': 'मौसम बुद्धिमत्ता',
    'nav.primary': 'मुख्य नेविगेशन',
    'nav.menu': 'मेनू खोलें',
    'nav.dashboard': 'डैशबोर्ड',
    'nav.map': 'मानचित्र',
    'nav.alerts': 'सतर्कता',
    'nav.climate': 'जलवायु',
    'nav.settings': 'सेटिंग्स',
    'current.title': 'वर्तमान स्थिति',
    'current.error': 'मौसम डेटा लोड नहीं हो सका।',
    'current.unconfigured': 'API कॉन्फ़िगर नहीं है।',
    'current.empty': 'स्थान चुनें।',
    'forecast.title': '7-दिन का पूर्वानुमान',
    'forecast.empty': 'पूर्वानुमान के लिए स्थान चुनें।',
    'intel.title': 'मौसम बुद्धिमत्ता',
    'intel.empty': 'इस स्थान के लिए कोई सक्रिय सलाह नहीं है।',
    'intel.why': 'कारण',
    'intel.action': 'अनुशंसित कार्रवाई',
    'field.precipitation': 'वर्षा',
    'field.wind': 'हवा',
    'field.condition': 'स्थिति',
    'field.updated': 'अपडेट किया',
    'chat.placeholder': 'पुणे में कल बारिश होगी क्या?',
    'chat.ask': 'पूछें',
    'chat.asking': '…',
    'chat.label': 'मौसम के बारे में पूछें',
    'chat.hint': 'अपने प्रश्न में शहर का नाम लिखें या पहले स्थान चुनें।',
    'location.button': 'मेरा वर्तमान स्थान उपयोग करें',
    'location.detecting': 'पता लगा रहे हैं…',
    'location.denied': 'स्थान अस्वीकृत',
    'location.error': 'स्थान पता नहीं चला',
    'location.manual': 'शहर का नाम दर्ज करें',
    'trust.source': 'स्रोत: Open-Meteo',
    'severity.low': 'कम',
    'severity.moderate': 'मध्यम',
    'severity.high': 'उच्च',
    'severity.advisory': 'सलाह',
    'severity.watch': 'निगरानी',
    'severity.warning': 'चेतावनी',
    'alerts.title': 'मौसम चेतावनी',
    'alerts.none': 'इस स्थान के लिए कोई सक्रिय चेतावनी नहीं है।',
    'alerts.routine': 'वर्तमान स्थिति सामान्य एवं सुरक्षित सीमा में है।',
    'alerts.action': 'अनुशंसित कार्रवाई',
    'alerts.threshold': 'सक्रिय सीमा',
    'voice.listening': 'सुन रहे हैं… अपना प्रश्न बोलें',
    'voice.speaking': 'उत्तर बोल रहे हैं…',
    'voice.start': 'बोलकर पूछें',
    'voice.stop': 'सुनना बंद करें',
    'voice.stopSpeaking': 'आवाज़ बंद करें',
    'voice.denied': 'माइक्रोफ़ोन अनुमति अस्वीकृत',
    'voice.unsupported': 'इस ब्राउज़र में आवाज़ समर्थित नहीं है',
    'nav.home': 'जीवंत आकाश',
    'nav.classic': 'क्लासिक',
    'nav.signin': 'साइन इन',
    'sky.title': 'आकाश से पूछें',
    'sky.subtitle': 'लाइव वायुमंडल कंसोल · English · हिंदी · Hinglish',
    'sky.send': 'भेजें',
    'sky.useLocation': 'मेरा स्थान',
    'sky.locating': 'स्थान खोज रहे हैं…',
    'sky.scanning': 'वायुमंडल स्कैन हो रहा है',
    'sky.thread': 'संवाद लॉग',
    'sky.threadEmpty': 'अभी कोई प्रश्न नहीं। किसी भी शहर के बारे में पूछें।',
    'sky.error': 'कनेक्शन विफल',
    'sky.needLocation': 'स्थान आवश्यक',
    'sky.signedIn': 'सहेजा गया स्थान सक्रिय',
    'panel.temperature': 'तापमान',
    'panel.rain': 'वर्षा',
    'panel.wind': 'हवा',
    'panel.humidity': 'आर्द्रता',
    'panel.location': 'स्थान',
    'panel.condition': 'आकाश की स्थिति',
    'panel.timeline': 'पूर्वानुमान समयरेखा · 72 घंटे',
    'panel.map': 'मानचित्र',
    'panel.advisory': 'सलाह',
    'source.explicit_query': 'प्रश्न',
    'source.request_coordinates': 'GPS',
    'source.trusted_user_default': 'सहेजा गया',
    'sky.verified': 'स्रोत: Open-Meteo · सत्यापित',
    'sky.live': 'लाइव',
    'sky.preview': 'पूर्वावलोकन',
    'sky.unavailable': 'पूर्वानुमान अवधि में नहीं',
  },
} as const

export type Language = 'en' | 'hi'
export type TranslationKey = keyof typeof dict.en

interface I18nValue {
  language: Language
  setLanguage: (lang: Language) => void
  t: (key: TranslationKey) => string
}

const I18nContext = createContext<I18nValue | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>('en')
  const setLanguage = useCallback((lang: Language) => setLanguageState(lang), [])

  const value = useMemo<I18nValue>(
    () => ({
      language,
      setLanguage,
      t: (key) => (dict[language][key] as string | undefined) ?? dict.en[key],
    }),
    [language, setLanguage]
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider')
  return ctx
}
