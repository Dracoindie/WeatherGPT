/** Mutable per-frame state shared by sky layers (no React re-renders). */

export const CAMERA_Z = 5
export const CAMERA_FOV = 60
export const TAN_HALF_FOV = Math.tan(((CAMERA_FOV / 2) * Math.PI) / 180)

export const rig = {
  /** smoothed pointer, -1..1 */
  px: 0,
  py: 0,
  /** camera shake amplitude (decays) */
  shake: 0,
  /** accumulated cloud drift offset along the wind (screen x / y) */
  driftX: 0,
  driftY: 0,
  aspect: 1,
}

export interface SkyQuality {
  mobile: boolean
  dpr: [number, number]
  rain: number
  splashes: number
  snow: number
  octaves: number
  cloudLayers: 1 | 2
}

export function detectQuality(): SkyQuality {
  const mobile =
    typeof window !== 'undefined' &&
    window.matchMedia('(max-width: 768px), (pointer: coarse)').matches
  return mobile
    ? { mobile, dpr: [1, 1], rain: 1600, splashes: 70, snow: 700, octaves: 3, cloudLayers: 1 }
    : { mobile, dpr: [1, 1.5], rain: 6000, splashes: 260, snow: 2400, octaves: 4, cloudLayers: 2 }
}
