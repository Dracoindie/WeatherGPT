import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { PALETTES } from '../lib/weatherScene'
import { mockBackend } from './support/mockApi'

/**
 * Text contrast over the Living Sky. axe cannot measure text on the sky
 * gradient (it reports "needs review"), so this computes it from the live CSS
 * tokens: each text colour on a glass panel (.sky-glass, its most transparent
 * stop) composited over the brightest colour of every sky phase, and inside a
 * severity badge's 12% tint. WCAG AA for normal text is 4.5:1.
 */

type RGB = [number, number, number]

const AA = 4.5
/** .sky-glass: linear-gradient(rgba(14,22,38,0.66) → rgba(5,9,18,0.78)); 0.66 is the worst case. */
const GLASS: RGB = [14, 22, 38]
const GLASS_ALPHA = 0.66
const BADGE_TINT = 0.12

const to255 = (c: RGB): RGB => c.map((v) => Math.round(v * 255)) as RGB
/** Brightest sky colours the app draws: each phase's horizon (bottom) and zenith (top). */
const SKIES: Record<string, RGB> = Object.fromEntries(
  Object.entries(PALETTES).flatMap(([phase, p]) => [
    [`${phase} horizon`, to255(p.bottom)],
    [`${phase} zenith`, to255(p.top)],
  ])
)

const mix = (fg: RGB, a: number, bg: RGB): RGB => fg.map((v, i) => a * v + (1 - a) * bg[i]) as RGB
function luminance([r, g, b]: RGB) {
  const f = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
function ratio(a: RGB, b: RGB) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** Resolve a CSS colour (hex, rgb(), rgba()) to RGB plus alpha via the browser. */
type Rgba = { rgb: RGB; alpha: number }

const LEVELS = ['none', 'advisory', 'watch', 'warning', 'severe', 'unknown'] as const

test('text tokens meet AA on glass over every sky phase', async ({ page, isMobile }) => {
  test.skip(isMobile, 'tokens are the same at every width')
  await mockBackend(page)
  await page.goto('/offline')

  // Read the tokens on .sky-root in each severity state (the accent text changes with it).
  const tokens = await page.evaluate((levels) => {
    const parse = (value: string) => {
      const probe = document.createElement('span')
      probe.style.color = value
      document.body.appendChild(probe)
      const m = getComputedStyle(probe).color.match(/[\d.]+/g)!.map(Number)
      probe.remove()
      return { rgb: [m[0], m[1], m[2]], alpha: m[3] ?? 1 }
    }
    const root = document.querySelector('.sky-root') as HTMLElement
    const read = (name: string) => parse(getComputedStyle(root).getPropertyValue(name).trim())
    const out: Record<string, { rgb: number[]; alpha: number }> = {}
    out['--sky-text'] = read('--sky-text')
    out['--sky-text-dim'] = read('--sky-text-dim')
    for (const l of levels) {
      out[`--sev-${l}`] = read(`--sev-${l}`)
      out[`--sev-${l}-text`] = read(`--sev-${l}-text`)
    }
    for (const state of ['', 'moderate', 'high']) {
      if (state) root.dataset.severity = state
      else delete root.dataset.severity
      out[`--sky-accent-text${state ? ` (${state})` : ''}`] = read('--sky-accent-text')
    }
    return out
  }, [...LEVELS]) as Record<string, Rgba>

  const failures: string[] = []
  const check = (label: string, fg: Rgba, bg: RGB) => {
    const text = fg.alpha < 1 ? mix(fg.rgb, fg.alpha, bg) : fg.rgb
    const r = ratio(text, bg)
    if (r < AA) failures.push(`${label}: ${r.toFixed(2)}:1`)
  }

  for (const [sky, colour] of Object.entries(SKIES)) {
    const glass = mix(GLASS, GLASS_ALPHA, colour)
    for (const name of ['--sky-text', '--sky-text-dim', '--sky-accent-text', '--sky-accent-text (moderate)', '--sky-accent-text (high)']) {
      check(`${name} on glass over ${sky}`, tokens[name], glass)
    }
    for (const l of LEVELS) {
      const textToken = tokens[`--sev-${l}-text`]
      check(`--sev-${l}-text on glass over ${sky}`, textToken, glass)
      // SeverityBadge: text shade on a 12% tint of the strong colour.
      check(`--sev-${l}-text in its badge over ${sky}`, textToken, mix(tokens[`--sev-${l}`].rgb, BADGE_TINT, glass))
    }
  }
  expect(failures, 'text below 4.5:1').toEqual([])
})

/** Strong severity colours are for fills, borders, dots and markers; text uses the -text shades. */
test('no strong severity or accent colour is used as text in the source', async ({ isMobile }) => {
  test.skip(isMobile, 'source check')
  const roots = ['app', 'components', 'lib', 'context'].map((d) => path.join(__dirname, '..', d))
  const files: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.(tsx?|css)$/.test(name)) files.push(p)
    }
  }
  roots.forEach(walk)

  const banned = [
    /\btext-sev-(none|advisory|watch|warning|severe|unknown)(?!-text)\b(?!-)/, // class without -text
    /\btext-accent(?![-\w])/, // accent class as text
    /\bcolor:\s*var\(--sev-(none|advisory|watch|warning|severe|unknown)\)/, // inline CSS text colour
    /\bcolor:\s*SEVERITY_VAR\b/, // inline React style text colour
    /style=\{\{\s*color[,\s}]/, // `color` shorthand from SEVERITY_VAR
  ]
  const hits: string[] = []
  for (const f of files) {
    readFileSync(f, 'utf-8')
      .split('\n')
      .forEach((line, i) => {
        if (line.trim().startsWith('//') || line.trim().startsWith('*') || line.includes('/*')) return
        if (banned.some((re) => re.test(line))) hits.push(`${path.relative(process.cwd(), f)}:${i + 1}: ${line.trim()}`)
      })
  }
  expect(hits).toEqual([])
})
