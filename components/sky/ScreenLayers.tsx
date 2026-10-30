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

function useScreenMaterial(frag: string, uniforms: Uniforms, octaves: number) {
  return useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: SCREEN_VERT,
        fragmentShader: frag,
        uniforms,
        defines: { OCTAVES: octaves },
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }),
    [frag, uniforms, octaves]
  )
}

/** Sun/moon position in screen uv from local hour. */
function celestial(hour: number, elevation: number) {
  const dayT = Math.min(1, Math.max(0, (hour - 6) / 13))
  const sun = new THREE.Vector2(0.12 + dayT * 0.76, 0.18 + Math.max(-0.4, elevation) * 0.62)
  const nightHour = hour >= 19 ? hour - 19 : hour + 5 // 0..11
  const nightT = Math.min(1, Math.max(0, nightHour / 11))
  const moon = new THREE.Vector2(0.2 + nightT * 0.6, 0.62 + Math.sin(nightT * Math.PI) * 0.18)
  return { sun, moon }
}

export function SkyLayer({ octaves }: { octaves: number }) {
  const uniforms = useMemo<Uniforms>(
    () => ({
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
    }),
    []
  )
  const material = useScreenMaterial(SKY_FRAG, uniforms, octaves)

  useFrame(({ clock }) => {
    const p = skyPalette(live)
    const { sun, moon } = celestial(live.hour, p.sunElevation)
    uniforms.uTop.value.setRGB(...p.top)
    uniforms.uBottom.value.setRGB(...p.bottom)
    uniforms.uSun.value.copy(sun)
    uniforms.uMoon.value.copy(moon)
    uniforms.uSunElev.value = p.sunElevation
    uniforms.uStars.value = p.starAlpha
    uniforms.uTime.value = clock.elapsedTime
    uniforms.uFlash.value = flash.value
    uniforms.uHeat.value = live.heat
    uniforms.uCloud.value = Math.min(1, live.cloudCover * 0.8 + live.cloudDarkness * 0.4)
    uniforms.uAspect.value = rig.aspect
    uniforms.uParallax.value.set(rig.px * 0.01, rig.py * 0.008)
  })

  return (
    <mesh frustumCulled={false} renderOrder={0} material={material}>
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
  const uniforms = useMemo<Uniforms>(
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
    [alpha, scale, seed]
  )
  const material = useScreenMaterial(CLOUD_FRAG, uniforms, octaves)

  useFrame(({ clock }) => {
    const p = skyPalette(live)
    uniforms.uTime.value = clock.elapsedTime
    uniforms.uCover.value = live.cloudCover
    uniforms.uDark.value = live.cloudDarkness
    uniforms.uFlash.value = flash.value
    uniforms.uAspect.value = rig.aspect
    uniforms.uSunElev.value = p.sunElevation
    uniforms.uBottom.value.setRGB(...p.bottom)
    uniforms.uOffset.value.set(seed + rig.drift * depth, seed * 0.37)
    uniforms.uParallax.value.set(rig.px * 0.025 * depth, rig.py * 0.018 * depth)
  })

  return (
    <mesh frustumCulled={false} renderOrder={renderOrder} material={material}>
      <planeGeometry args={[2, 2]} />
    </mesh>
  )
}

export function FogLayer({ octaves }: { octaves: number }) {
  const uniforms = useMemo<Uniforms>(
    () => ({
      uTime: { value: 0 },
      uFog: { value: 0 },
      uWind: { value: 1 },
      uAspect: { value: 1 },
      uSunElev: { value: 0 },
      uBottom: { value: new THREE.Color() },
      uParallax: { value: new THREE.Vector2() },
    }),
    []
  )
  const material = useScreenMaterial(FOG_FRAG, uniforms, Math.min(octaves, 4))
  const meshRef = useRef<THREE.Mesh>(null)

  useFrame(({ clock }) => {
    const p = skyPalette(live)
    uniforms.uTime.value = clock.elapsedTime
    uniforms.uFog.value = live.fog
    uniforms.uWind.value = 0.6 + live.windKmh / 25
    uniforms.uAspect.value = rig.aspect
    uniforms.uSunElev.value = p.sunElevation
    uniforms.uBottom.value.setRGB(...p.bottom)
    uniforms.uParallax.value.set(rig.px * 0.03, rig.py * 0.015)
    if (meshRef.current) meshRef.current.visible = live.fog > 0.01
  })

  return (
    <mesh ref={meshRef} frustumCulled={false} renderOrder={20} material={material}>
      <planeGeometry args={[2, 2]} />
    </mesh>
  )
}
