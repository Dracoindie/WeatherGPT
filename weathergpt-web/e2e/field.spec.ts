import { expect, test } from '@playwright/test'
import { featherEdges, hexToRgb } from '../components/map3d/field'

/**
 * The broadcast surface fades out toward its edges (no hard rectangle in the
 * tilted view). Pure logic: no page.
 */
const alphaAt = (px: Uint8ClampedArray, w: number, x: number, y: number) => px[(y * w + x) * 4 + 3]

function solid(w: number, h: number, alpha = 255) {
  const px = new Uint8ClampedArray(w * h * 4)
  for (let o = 0; o < px.length; o += 4) {
    px[o] = 10
    px[o + 1] = 20
    px[o + 2] = 30
    px[o + 3] = alpha
  }
  return px
}

test('featherEdges: transparent at the border, untouched in the middle, rising smoothly in between', () => {
  const w = 100
  const h = 60
  const px = featherEdges(solid(w, h), w, h, 0.2)
  // every border pixel is fully transparent
  for (let x = 0; x < w; x++) {
    expect(alphaAt(px, w, x, 0)).toBe(0)
    expect(alphaAt(px, w, x, h - 1)).toBe(0)
  }
  for (let y = 0; y < h; y++) {
    expect(alphaAt(px, w, 0, y)).toBe(0)
    expect(alphaAt(px, w, w - 1, y)).toBe(0)
  }
  // the middle keeps its alpha
  expect(alphaAt(px, w, 50, 30)).toBe(255)
  // along a row through the middle the alpha never drops toward the centre
  let prev = -1
  for (let x = 0; x <= 50; x++) {
    const a = alphaAt(px, w, x, 30)
    expect(a).toBeGreaterThanOrEqual(prev)
    prev = a
  }
  // colours are untouched
  expect([px[(30 * w + 3) * 4], px[(30 * w + 3) * 4 + 1], px[(30 * w + 3) * 4 + 2]]).toEqual([10, 20, 30])
})

test('featherEdges: frac 0 changes nothing; transparent pixels stay transparent', () => {
  const w = 20
  const h = 20
  const px = solid(w, h)
  featherEdges(px, w, h, 0)
  expect(alphaAt(px, w, 0, 0)).toBe(255)
  const holes = solid(w, h, 0)
  featherEdges(holes, w, h, 0.3)
  expect(Math.max(...Array.from({ length: w * h }, (_, i) => holes[i * 4 + 3]))).toBe(0)
})

test('tokenRgb colours: hex and rgb() both parse (StaticSky sets --sky-floor as rgb())', () => {
  expect(hexToRgb('#02040a')).toEqual([2, 4, 10])
  expect(hexToRgb(' rgb(12, 20, 33)')).toEqual([12, 20, 33])
  expect(hexToRgb('rgba(1.6, 2, 3, 0.5)')).toEqual([2, 2, 3])
})
