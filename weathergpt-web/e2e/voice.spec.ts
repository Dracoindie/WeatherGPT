import { expect, test, type Page } from '@playwright/test'
import { chatResponse, mockBackend } from './support/mockApi'

/**
 * Voice: a fake SpeechRecognition (returns a scripted transcript) and a
 * recording speechSynthesis are installed before the page loads.
 */

declare global {
  interface Window {
    __recognitionLangs: string[]
    __spoken: { text: string; lang: string }[]
    __transcript: string
  }
}

async function installFakeSpeech(page: Page, transcript: string) {
  await page.addInitScript((t) => {
    window.__recognitionLangs = []
    window.__spoken = []
    window.__transcript = t
    class FakeRecognition {
      lang = 'en-IN'
      continuous = false
      interimResults = true
      maxAlternatives = 1
      onstart: (() => void) | null = null
      onresult: ((e: unknown) => void) | null = null
      onerror: ((e: unknown) => void) | null = null
      onend: (() => void) | null = null
      start() {
        window.__recognitionLangs.push(this.lang)
        setTimeout(() => {
          this.onstart?.()
          const result = Object.assign([{ transcript: window.__transcript, confidence: 0.9 }], { isFinal: true })
          this.onresult?.({ resultIndex: 0, results: [result] })
          this.onend?.()
        }, 50)
      }
      stop() {}
      abort() {}
    }
    Object.defineProperty(window, 'webkitSpeechRecognition', { configurable: true, value: FakeRecognition })
    Object.defineProperty(window, 'SpeechRecognition', { configurable: true, value: FakeRecognition })
    const synth = {
      speak(u: SpeechSynthesisUtterance) {
        window.__spoken.push({ text: u.text, lang: u.lang })
      },
      cancel() {},
      // real SpeechSynthesisVoice objects can't be faked; lang falls back to the BCP-47 tag
      getVoices() {
        return []
      },
    }
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: synth })
  }, transcript)
}

test.describe('voice on the Living Sky console', () => {
  test.skip(({ isMobile }) => isMobile, 'controls are the same; desktop covers the flow')

  for (const [label, expectLang] of [['EN-IN', 'en-IN'], ['हिंदी', 'hi-IN'], ['मराठी', 'mr-IN']] as const) {
    test(`mic asks in ${expectLang} and the reply is spoken`, async ({ page }) => {
      await installFakeSpeech(page, 'Pune mein kal baarish hogi kya')
      const log = await mockBackend(page, {
        chat: () => chatResponse({ message: 'Pune mein kal 80% baarish ka chance hai.', language: 'hinglish' }),
      })
      await page.goto('/')
      await page.getByRole('combobox', { name: 'Speech language' }).selectOption({ label })
      await page.getByRole('button', { name: /start voice question/i }).click()
      await expect.poll(() => log.chat.length).toBe(1)
      expect(log.chat[0].message).toBe('Pune mein kal baarish hogi kya')
      expect(await page.evaluate(() => window.__recognitionLangs)).toEqual([expectLang])
      await expect.poll(() => page.evaluate(() => window.__spoken.length)).toBe(1)
      const spoken = await page.evaluate(() => window.__spoken[0])
      expect(spoken.text).toContain('80% baarish')
      expect(spoken.lang).toBe('en-IN') // hinglish reply is read as Indian English
    })
  }

  test('mute stops spoken replies; Listen still reads on demand', async ({ page }) => {
    await installFakeSpeech(page, 'Will it rain in Pune tomorrow')
    const log = await mockBackend(page)
    await page.goto('/')
    await page.getByRole('button', { name: /mute spoken replies/i }).click()
    expect(await page.evaluate(() => localStorage.getItem('wgpt:voice-muted'))).toBe('1')
    await page.getByRole('button', { name: /start voice question/i }).click()
    await expect.poll(() => log.chat.length).toBe(1)
    await expect(page.getByRole('button', { name: 'Listen' })).toBeVisible({ timeout: 20_000 })
    expect(await page.evaluate(() => window.__spoken.length)).toBe(0)
    await page.getByRole('button', { name: 'Listen' }).click()
    await expect.poll(() => page.evaluate(() => window.__spoken.length)).toBe(1)
  })

  test('Hindi reply is spoken with a Hindi voice', async ({ page }) => {
    await installFakeSpeech(page, 'पुणे में कल बारिश होगी क्या')
    await mockBackend(page, {
      chat: () => chatResponse({ message: 'पुणे में कल बारिश की संभावना 80% है।', language: 'hi' }),
    })
    await page.goto('/')
    await page.getByRole('combobox', { name: 'Speech language' }).selectOption({ label: 'हिंदी' })
    await page.getByRole('button', { name: /start voice question/i }).click()
    await expect.poll(() => page.evaluate(() => window.__spoken.length)).toBe(1)
    expect(await page.evaluate(() => window.__spoken[0].lang)).toBe('hi-IN')
  })
})

test('without speech APIs the mic is disabled and typing still works', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'webkitSpeechRecognition', { configurable: true, value: undefined })
    Object.defineProperty(window, 'SpeechRecognition', { configurable: true, value: undefined })
  })
  const log = await mockBackend(page)
  await page.goto('/')
  const mic = page.getByRole('button', { name: /voice input is not supported/i })
  await expect(mic).toBeDisabled()
  const input = page.getByRole('textbox', { name: /ask about the weather/i })
  await input.fill('Will it rain in Pune tomorrow?')
  await input.press('Enter')
  await expect.poll(() => log.chat.length).toBe(1)
})
