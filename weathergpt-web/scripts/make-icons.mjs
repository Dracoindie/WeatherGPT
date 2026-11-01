/**
 * Renders the PWA icons to public/icons with Playwright's Chromium.
 *   node scripts/make-icons.mjs
 * "any" icons are a rounded tile; the maskable icon is full-bleed with the
 * mark inside the 80% safe zone.
 */

import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const OUT = 'public/icons'

function svg({ size, maskable }) {
  const r = maskable ? 0 : size * 0.22
  const s = maskable ? 0.62 : 0.78 // mark scale inside the tile
  const c = size / 2
  const ring = size * 0.34 * s
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0b2236"/><stop offset="1" stop-color="#02040a"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.42" r="0.5">
      <stop offset="0" stop-color="#22d3ee" stop-opacity="0.35"/><stop offset="1" stop-color="#22d3ee" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${r}" fill="url(#bg)"/>
  <rect width="${size}" height="${size}" rx="${r}" fill="url(#glow)"/>
  <circle cx="${c}" cy="${c}" r="${ring}" fill="none" stroke="#22d3ee" stroke-opacity="0.55" stroke-width="${size * 0.012}"/>
  <text x="${c}" y="${c}" dy="0.35em" text-anchor="middle"
    font-family="'Segoe UI', 'Helvetica Neue', Arial, sans-serif" font-weight="700"
    font-size="${size * 0.42 * s}" fill="#e7f0ff">W</text>
  <path d="M ${c - ring * 0.9} ${c + ring * 1.25} q ${ring * 0.45} ${-ring * 0.22} ${ring * 0.9} 0 t ${ring * 0.9} 0"
    fill="none" stroke="#22d3ee" stroke-width="${size * 0.02}" stroke-linecap="round"/>
</svg>`
}

const targets = [
  { file: 'icon-192.png', size: 192, maskable: false },
  { file: 'icon-512.png', size: 512, maskable: false },
  { file: 'maskable-512.png', size: 512, maskable: true },
  { file: 'apple-touch-icon.png', size: 180, maskable: true },
]

mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage()
for (const t of targets) {
  await page.setViewportSize({ width: t.size, height: t.size })
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg(t)}</body></html>`)
  await page.locator('svg').screenshot({ path: `${OUT}/${t.file}`, omitBackground: true })
  console.log('wrote', `${OUT}/${t.file}`)
}
await browser.close()
