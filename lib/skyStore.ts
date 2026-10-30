/**
 * Living Sky scene store.
 *
 * - `data`    scene derived from the latest API response
 * - `preview` scene from the forecast timeline scrubber (optional)
 * - `demo`    demo-panel override (visual only)
 *
 * The render loops (WebGL sky, rain-on-glass) read `live` every frame; it
 * eases toward the effective target so scene changes crossfade (~1.5 s).
 * React components subscribe only to coarse snapshot changes.
 */

'use client'

import { useSyncExternalStore } from 'react'
import {
  defaultScene,
  demoScene,
  NUMERIC_KEYS,
  type DemoPreset,
  type SceneParams,
} from '@/lib/weatherScene'

export interface DemoState {
  active: boolean
  preset: DemoPreset
  windKmh: number
}

export interface SkySnapshot {
  target: SceneParams
  demo: DemoState
  previewing: boolean
}

const CROSSFADE_SECONDS = 1.5
/** Lightning photosensitivity guard: ≥ 350 ms between flashes (< 3 / s). */
export const MIN_FLASH_INTERVAL_MS = 350

let data: SceneParams = defaultScene()
let preview: SceneParams | null = null
let demo: DemoState = { active: false, preset: 'storm', windKmh: 30 }
let snapshot: SkySnapshot = { target: data, demo, previewing: false }
const listeners = new Set<() => void>()

/** Eased scene read by render loops every frame. */
export const live: SceneParams = { ...data }
/** 0..1 lightning flash, decays in step(). */
export const flash = { value: 0, lastAt: 0 }

function effective(): SceneParams {
  if (demo.active) return demoScene(demo.preset, demo.windKmh)
  return preview ?? data
}

function emit() {
  snapshot = { target: effective(), demo, previewing: preview !== null }
  listeners.forEach((l) => l())
}

export const sky = {
  setData(scene: SceneParams) {
    data = scene
    emit()
  },
  setPreview(scene: SceneParams | null) {
    preview = scene
    emit()
  },
  setDemo(next: Partial<DemoState>) {
    demo = { ...demo, ...next }
    emit()
  },
  /** Ask for a lightning flash. Returns false if it would exceed the rate limit. */
  triggerFlash(strength: number): boolean {
    const now = performance.now()
    if (now - flash.lastAt < MIN_FLASH_INTERVAL_MS) return false
    flash.lastAt = now
    flash.value = Math.max(flash.value, Math.min(0.85, strength))
    return true
  },
  /** Advance the crossfade. Called once per frame by whichever loop is running. */
  step(dt: number) {
    const target = snapshot.target
    // exponential ease that reaches ~95% in CROSSFADE_SECONDS
    const k = 1 - Math.exp((-3 * dt) / CROSSFADE_SECONDS)
    for (const key of NUMERIC_KEYS) {
      live[key] += (target[key] - live[key]) * k
    }
    // hour wraps around midnight — ease along the shortest arc
    let dh = target.hour - live.hour
    if (dh > 12) dh -= 24
    if (dh < -12) dh += 24
    live.hour = (live.hour + dh * k + 24) % 24
    live.kind = target.kind
    flash.value *= Math.exp(-dt * 9)
    if (flash.value < 0.002) flash.value = 0
  },
  /** Jump straight to the target (reduced motion). */
  snap() {
    Object.assign(live, snapshot.target)
    flash.value = 0
  },
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  getSnapshot: () => snapshot,
}

export function useSky(): SkySnapshot {
  return useSyncExternalStore(sky.subscribe, sky.getSnapshot, sky.getSnapshot)
}
