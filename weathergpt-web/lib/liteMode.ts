'use client'

/**
 * Lite mode: no WebGL sky and no rain-on-glass canvases, just the CSS sky.
 *
 * "auto" (default) turns it on when the browser signals Save-Data or a
 * reduced-data preference, a slow connection (2G/3G effective type), a
 * low-end device (<= 2 GB memory or <= 2 CPU cores), or WebGL drawn in
 * software (no GPU: SwiftShader, llvmpipe, Microsoft Basic Render Driver),
 * where the animated sky runs on the CPU and can freeze the page. The user
 * can force it on or off; that choice is remembered on this device.
 */

import { useSyncExternalStore } from 'react'

export type LitePref = 'auto' | 'on' | 'off'
export type LiteReason = 'save-data' | 'slow-connection' | 'low-end-device' | 'software-renderer' | null

interface NetworkInformationLike {
  saveData?: boolean
  effectiveType?: string
  addEventListener?: (type: 'change', cb: () => void) => void
  removeEventListener?: (type: 'change', cb: () => void) => void
}

export interface LiteState {
  lite: boolean
  pref: LitePref
  /** why auto mode chose lite (null when not constrained) */
  reason: LiteReason
}

const STORAGE_KEY = 'wgpt:lite-mode'
const SLOW_TYPES = new Set(['slow-2g', '2g', '3g'])

function connection(): NetworkInformationLike | undefined {
  return (navigator as Navigator & { connection?: NetworkInformationLike }).connection
}

const SOFTWARE_GL = /swiftshader|llvmpipe|softpipe|software rasterizer|basic render/i
let softwareGL: boolean | null = null

/** True when WebGL is drawn on the CPU (no GPU). Probed once per page. */
export function softwareRenderer(): boolean {
  if (softwareGL !== null) return softwareGL
  softwareGL = false
  try {
    const canvas = document.createElement('canvas')
    const gl = (canvas.getContext('webgl2') || canvas.getContext('webgl')) as WebGLRenderingContext | null
    if (gl) {
      const info = gl.getExtension('WEBGL_debug_renderer_info')
      const renderer = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '')
      softwareGL = SOFTWARE_GL.test(renderer)
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
  } catch {
    // no WebGL at all: SkyEngine already falls back to the CSS sky
  }
  return softwareGL
}

export function detectConstraint(): LiteReason {
  if (typeof navigator === 'undefined') return null
  const conn = connection()
  if (conn?.saveData || window.matchMedia?.('(prefers-reduced-data: reduce)').matches) return 'save-data'
  if (conn?.effectiveType && SLOW_TYPES.has(conn.effectiveType)) return 'slow-connection'
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
  const cores = navigator.hardwareConcurrency
  if ((memory != null && memory <= 2) || (cores != null && cores > 0 && cores <= 2)) return 'low-end-device'
  if (softwareRenderer()) return 'software-renderer'
  return null
}

function readPref(): LitePref {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v === 'on' || v === 'off' ? v : 'auto'
  } catch {
    return 'auto'
  }
}

const SERVER: LiteState = { lite: false, pref: 'auto', reason: null }
let state: LiteState | null = null
const listeners = new Set<() => void>()

function compute(): LiteState {
  const pref = readPref()
  const reason = detectConstraint()
  return { pref, reason, lite: pref === 'on' || (pref === 'auto' && reason !== null) }
}

function refresh() {
  const next = compute()
  if (!state || next.lite !== state.lite || next.pref !== state.pref || next.reason !== state.reason) {
    state = next
    listeners.forEach((l) => l())
  }
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  const conn = connection()
  conn?.addEventListener?.('change', refresh)
  return () => {
    listeners.delete(cb)
    conn?.removeEventListener?.('change', refresh)
  }
}

function snapshot(): LiteState {
  if (!state) state = compute()
  return state
}

export function setLitePref(pref: LitePref) {
  try {
    if (pref === 'auto') localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, pref)
  } catch {
    // storage blocked: the choice lasts for this page only
  }
  state = { ...compute(), pref, lite: pref === 'on' || (pref === 'auto' && detectConstraint() !== null) }
  listeners.forEach((l) => l())
}

export function useLiteMode(): LiteState {
  return useSyncExternalStore(subscribe, snapshot, () => SERVER)
}
