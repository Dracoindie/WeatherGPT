'use client'

/**
 * Chooses the sky renderer: WebGL (lazy, client-only) or, under
 * prefers-reduced-motion, the static CSS gradient with no shake or flashes.
 */

import { useEffect } from 'react'
import dynamic from 'next/dynamic'
import { useReducedMotion } from 'framer-motion'
import { sky } from '@/lib/skyStore'
import { StaticSky } from './StaticSky'

const SkyCanvas = dynamic(() => import('./SkyCanvas'), { ssr: false })

function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
}

export function SkyEngine() {
  const reduced = useReducedMotion() ?? false
  const webgl = typeof document !== 'undefined' && hasWebGL()

  // Without the render loop, keep the shared live scene in sync instantly.
  useEffect(() => {
    if (!reduced && webgl) return
    sky.snap()
    return sky.subscribe(() => sky.snap())
  }, [reduced, webgl])

  return (
    <>
      <StaticSky />
      {!reduced && webgl && <SkyCanvas />}
    </>
  )
}
