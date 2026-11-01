'use client'

/** Fullscreen shader layers: sky gradient/sun/stars, fbm clouds, layered fog. */

import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { flash, live } from '@/lib/skyStore'
import { skyPalette } from '@/lib/weatherScene'
import { CLOUD_FRAG, FOG_FRAG, SCREEN_VERT, SKY_FRAG } from './shaders'
import { rig } from './rig'

type Uniforms = Record<string, THREE.IUniform>
type ScreenMesh = THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>

/**
 * Creates the layer material once; per-frame uniform writes go through the
 * mesh ref (three.js objects are mutable scene state, not React state).
 */
function useScreenMaterial(frag: string, makeUniforms: () => Uniforms, octaves: number) {
  return useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: SCREEN_VERT,
        fragmentShader: frag,
        uniforms: makeUniforms(),
        defines: { OCTAVES: octaves },
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }),
    // makeUniforms is a stable factory per layer
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [frag, octaves]
  )
}

/** Sun/moon position in screen uv from local hour. */
function celestial(hour: number, elevation: number) {
  const dayT = Math.min(1, Math.max(0, (hour - 6) / 13))
  const sun: [number, number] = [0.12 + dayT * 0.76, 0.18 + Math.max(-0.4, elevation) * 0.62]
  const nightHour = hour >= 19 ? hour - 19 : hour + 5 // 0..11
  const nightT = Math.min(1, Math.max(0, nightHour / 11))
  const moon: [number, number] = [0.2 + nightT * 0.6, 0.62 + Math.sin(nightT * Math.PI) * 0.18]
  return { sun, moon }
}

const skyUniforms = (): Uniforms => ({
  uTop: { value: new THREE.Color() },
  uBottom: { value: new THREE.Color() },
  uSun: { value: new THREE.Vector2() },
  uMoon: { value: new THREE.Vector2() },
  uSunElev: { value: 0 },
  uStars: { value: 0 },
  uTime: { value: 0 },
  uFlash: { value: 0 },
  uHeat: { value: 0 },
  uCloud: { value: 0 },
  uAspect: { value: 1 },
  uParallax: { value: new THREE.Vector2() },
})

export function SkyLayer({ octaves }: { octaves: number }) {
  const material = useScreenMaterial(SKY_FRAG, skyUniforms, octaves)
  const mesh = useRef<ScreenMesh>(null)

  useFrame(({ clock }) => {
    const u = mesh.current?.material.uniforms
    if (!u) return
    const p = skyPalette(live)
    const { sun, moon } = celestial(live.hour, p.sunElevation)
    u.uTop.value.setRGB(...p.top)
    u.uBottom.value.setRGB(...p.bottom)
    u.uSun.value.set(...sun)
    u.uMoon.value.set(...moon)
    u.uSunElev.value = p.sunElevation
    u.uStars.value = p.starAlpha
    u.uTime.value = clock.elapsedTime
    u.uFlash.value = flash.value
    u.uHeat.value = live.heat
    u.uCloud.value = Math.min(1, live.cloudCover * 0.8 + live.cloudDarkness * 0.4)
    u.uAspect.value = rig.aspect
    u.uParallax.value.set(rig.px * 0.01, rig.py * 0.008)
  })

  return (
    <mesh ref={mesh} frustumCulled={false} renderOrder={0} material={material}>
      <planeGeometry args={[2, 2]} />
    </mesh>
  )
}

interface CloudProps {
  octaves: number
  scale: number
  depth: number
  alpha: number
  renderOrder: number
  seed: number
}

export function CloudLayer({ octaves, scale, depth, alpha, renderOrder, seed }: CloudProps) {
  const mesh = useRef<ScreenMesh>(null)
  const material = useScreenMaterial(
    CLOUD_FRAG,
    () => ({
      uTime: { value: 0 },
      uCover: { value: 0 },
      uDark: { value: 0 },
      uFlash: { value: 0 },
      uAlpha: { value: alpha },
      uScale: { value: scale },
      uAspect: { value: 1 },
      uSunElev: { value: 0 },
      uBottom: { value: new THREE.Color() },
      uOffset: { value: new THREE.Vector2(seed, seed * 0.37) },
      uParallax: { value: new THREE.Vector2() },
    }),
    octaves
  )

  useFrame(({ clock }) => {
    const u = mesh.current?.material.uniforms
    if (!u) return
    const p = skyPalette(live)
    u.uTime.value = clock.elapsedTime
    u.uCover.value = live.cloudCover
    u.uDark.value = live.cloudDarkness
    u.uFlash.value = flash.value
    u.uAlpha.value = alpha
    u.uScale.value = scale
    u.uAspect.value = rig.aspect
    u.uSunElev.value = p.sunElevation
    u.uBottom.value.setRGB(...p.bottom)
    // The shader samples at uv + offset, so subtracting moves clouds along the wind.
    u.uOffset.value.set(seed - rig.driftX * depth, seed * 0.37 - rig.driftY * depth)
    u.uParallax.value.set(rig.px * 0.025 * depth, rig.py * 0.018 * depth)
  })

  return (
    <mesh ref={mesh} frustumCulled={false} renderOrder={renderOrder} material={material}>
      <planeGeometry args={[2, 2]} />
    </mesh>
  )
}

const fogUniforms = (): Uniforms => ({
  uTime: { value: 0 },
  uFog: { value: 0 },
  uWind: { value: 1 },
  uAspect: { value: 1 },
  uSunElev: { value: 0 },
  uBottom: { value: new THREE.Color() },
  uParallax: { value: new THREE.Vector2() },
})

export function FogLayer({ octaves }: { octaves: number }) {
  const material = useScreenMaterial(FOG_FRAG, fogUniforms, Math.min(octaves, 4))
  const mesh = useRef<ScreenMesh>(null)

  useFrame(({ clock }) => {
    const m = mesh.current
    if (!m) return
    const u = m.material.uniforms
    const p = skyPalette(live)
    u.uTime.value = clock.elapsedTime
    u.uFog.value = live.fog
    u.uWind.value = 0.6 + live.windKmh / 25
    u.uAspect.value = rig.aspect
    u.uSunElev.value = p.sunElevation
    u.uBottom.value.setRGB(...p.bottom)
    u.uParallax.value.set(rig.px * 0.03, rig.py * 0.015)
    m.visible = live.fog > 0.01
  })

  return (
    <mesh ref={mesh} frustumCulled={false} renderOrder={20} material={material}>
      <planeGeometry args={[2, 2]} />
    </mesh>
  )
}
