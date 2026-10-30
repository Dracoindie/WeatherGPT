'use client'

/**
 * Fullscreen WebGL sky. Loaded with next/dynamic (ssr: false) by SkyEngine.
 *
 * Perf: DPR capped at 1.5 (1 on mobile, and drops to 1 if FPS declines),
 * mobile gets fewer particles and fewer fbm octaves, and the render loop is
 * paused while the tab is hidden.
 */

import { useEffect, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { PerformanceMonitor } from '@react-three/drei'
import { flash, live, sky } from '@/lib/skyStore'
import { CloudLayer, FogLayer, SkyLayer } from './ScreenLayers'
import { Rain, Snow } from './Precipitation'
import { Lightning } from './Lightning'
import { CAMERA_FOV, CAMERA_Z, detectQuality, rig, type SkyQuality } from './rig'

/** Advances the crossfade, parallax, shake and the UI flash variable. */
function Controller() {
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const pointer = useRef({ x: 0, y: 0 })
  const root = useRef<HTMLElement | null>(null)
  const lastFlash = useRef(0)

  useEffect(() => {
    root.current = document.querySelector<HTMLElement>('.sky-root')
    const onMove = (e: PointerEvent) => {
      pointer.current.x = (e.clientX / window.innerWidth) * 2 - 1
      pointer.current.y = -((e.clientY / window.innerHeight) * 2 - 1)
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => window.removeEventListener('pointermove', onMove)
  }, [])

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1)
    sky.step(dt)
    rig.aspect = size.width / Math.max(1, size.height)
    const ease = Math.min(1, dt * 2.5)
    rig.px += (pointer.current.x - rig.px) * ease
    rig.py += (pointer.current.y - rig.py) * ease
    rig.drift += dt * (0.006 + live.windKmh * 0.0012)
    rig.shake *= Math.exp(-dt * 7)
    const sx = (Math.random() - 0.5) * rig.shake
    const sy = (Math.random() - 0.5) * rig.shake
    camera.position.set(rig.px * 0.35 + sx, rig.py * 0.2 + sy, CAMERA_Z)
    camera.lookAt(rig.px * 0.1, rig.py * 0.05, -10)

    const v = flash.value
    if (root.current && Math.abs(v - lastFlash.current) > 0.01) {
      lastFlash.current = v
      root.current.style.setProperty('--sky-flash', v.toFixed(3))
    }
  })
  return null
}

function useTabVisible() {
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [])
  return visible
}

export default function SkyCanvas() {
  const [quality] = useState<SkyQuality>(detectQuality)
  const [dpr, setDpr] = useState<number>(quality.dpr[1])
  const visible = useTabVisible()

  return (
    <Canvas
      aria-hidden="true"
      style={{ position: 'fixed', inset: 0, zIndex: -10, pointerEvents: 'none' }}
      dpr={dpr}
      frameloop={visible ? 'always' : 'never'}
      camera={{ fov: CAMERA_FOV, position: [0, 0, CAMERA_Z], near: 0.1, far: 100 }}
      gl={{ antialias: false, alpha: false, powerPreference: 'high-performance' }}
      flat
      linear
    >
      <PerformanceMonitor onDecline={() => setDpr(1)} />
      <Controller />
      <SkyLayer octaves={quality.octaves} />
      {quality.cloudLayers === 2 && (
        <CloudLayer octaves={quality.octaves} scale={1.4} depth={0.6} alpha={0.7} renderOrder={1} seed={11.3} />
      )}
      <Lightning />
      <CloudLayer octaves={quality.octaves} scale={0.9} depth={1} alpha={0.92} renderOrder={8} seed={3.7} />
      <Snow max={quality.snow} />
      <Rain max={quality.rain} splashes={quality.splashes} />
      <FogLayer octaves={quality.octaves} />
    </Canvas>
  )
}

