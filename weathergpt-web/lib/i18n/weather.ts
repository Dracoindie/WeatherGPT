/**
 * Localised WMO weather descriptions for the UI.
 *
 * The words come from weatherCodes.generated.ts, which is generated from the
 * backend tables (backend/query_service.py + backend/llm/weather_codes.py), so
 * the UI and chat replies always say the same thing. Never add a second table.
 */

import { useCallback } from 'react'
import { useI18n } from '@/context/I18nContext'
import { WMO_DESCRIPTIONS, type WeatherCodeLanguage } from './weatherCodes.generated'

const CODE_BY_ENGLISH: Record<string, string> = Object.fromEntries(
  Object.entries(WMO_DESCRIPTIONS.en).map(([code, text]) => [text, code])
)

/**
 * Description of ``code`` in ``language``. ``english`` (the API's
 * weather_description) is used to find the code when it is missing, and as
 * the last fallback for an unknown code.
 */
export function describeWeather(
  code: number | null | undefined,
  language: WeatherCodeLanguage,
  english?: string | null
): string | null {
  const key = code != null ? String(code) : english ? CODE_BY_ENGLISH[english] : undefined
  if (key != null) {
    const text = WMO_DESCRIPTIONS[language][key] ?? WMO_DESCRIPTIONS.en[key]
    if (text) return text
  }
  if (english) return english
  return code != null ? `WMO ${code}` : null
}

/** describeWeather bound to the selected UI language. */
export function useDescribeWeather() {
  const { language } = useI18n()
  return useCallback(
    (code: number | null | undefined, english?: string | null) => describeWeather(code, language, english),
    [language]
  )
}
