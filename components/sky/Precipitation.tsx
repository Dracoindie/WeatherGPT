'use client'

/** GPU particles: instanced rain streaks, ground splashes, depth-of-field snow. */

import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { flash, live } from '@/lib/skyStore'
import { RAIN_FRAG, RAIN_VERT, SNOW_FRAG, SNOW_VERT, SPLASH_FRAG, SPLASH_VERT } from './shaders'
import { CAMERA_Z, rig, TAN_HALF_FOV } from './rig'

type InstancedMesh = THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>
type SnowPoints = THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>

/** Unit quads with a random vec4 seed per instance. */
function seededQuads(max: number, streak: boolean) {
  const geo = new THREE.InstancedBufferGeometry()
  const base = new THREE.PlaneGeometry(1, 1)
  // streaks: position.y spans 0..1 along the fall direction (uv.y = 1 at the head)
  if (streak) base.translate(0, 0.5, 0)
  geo.index = base.index
  geo.setAttribute('position', base.getAttribute('position'))
  geo.setAttribute('uv', base.getAttribute('uv'))
  const seeds = new Float32Array(max * 4)
  for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random()
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4))
  geo.instanceCount = 0
  return geo
}

/** Random flake seeds (position = normalised spawn, aRand = per-flake variation). */
function snowSeeds(max: number) {
  const g = new THREE.BufferGeometry()
  const pos = new Float32Array(max * 3)
  const rnd = new Float32Array(max)
  for (let i = 0; i < pos.length; i++) pos[i] = Math.random()
  for (let i = 0; i < max; i++) rnd[i] = Math.random()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('aRand', new THREE.BufferAttribute(rnd, 1))
  g.setDrawRange(0, 0)
  return g
}

const depthUniforms = () => ({
  uTanHalf: { value: TAN_HALF_FOV },
  uAspect: { value: 1 },
  uCamZ: { value: CAMERA_Z },
})

function particleMaterial(vertexShader: string, fragmentShader: string, uniforms: Record<string, THREE.IUniform>) {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: { ...depthUniforms(), ...uniforms },
    transparent: true,
    depthTest: false,
    depthWrite: false,
  })
}

export function Rain({ max, splashes }: { max: number; splashes: number }) {
  const rainGeo = useMemo(() => seededQuads(max, true), [max])
  const splashGeo = useMemo(() => seededQuads(splashes, false), [splashes])
  const rainMat = useMemo(
    () =>
      particleMaterial(RAIN_VERT, RAIN_FRAG, {
        uTime: { value: 0 },
        uSpeed: { value: 10 },
        uSlant: { value: 0 },
        uOpacity: { value: 0 },
        uFlash: { value: 0 },
      }),
    []
  )
  const splashMat = useMemo(
    () => particleMaterial(SPLASH_VERT, SPLASH_FRAG, { uTime: { value: 0 }, uRate: { value: 1.6 }, uOpacity: { value: 0 } }),
    []
  )
  const rainRef = useRef<InstancedMesh>(null)
  const splashRef = useRef<InstancedMesh>(null)

  useFrame(({ clock }) => {
    const r = rainRef.current
    const s = splashRef.current
    if (!r || !s) return
    const t = clock.elapsedTime
    const intensity = live.rain
    r.geometry.instanceCount = Math.floor(max * Math.min(1, intensity * 1.1))
    s.geometry.instanceCount = Math.floor(splashes * intensity)
    const u = r.material.uniforms
    u.uTime.value = t
    u.uSpeed.value = 9 + live.windKmh * 0.06 + intensity * 4
    u.uSlant.value = Math.min(0.75, live.windKmh / 85)
    u.uOpacity.value = Math.min(1, 0.35 + intensity)
    u.uFlash.value = flash.value
    u.uAspect.value = rig.aspect
    const su = s.material.uniforms
    su.uTime.value = t
    su.uOpacity.value = Math.min(1, intensity * 1.4)
    su.uAspect.value = rig.aspect
  })

  return (
    <>
      <mesh ref={rainRef} geometry={rainGeo} material={rainMat} frustumCulled={false} renderOrder={12} />
      <mesh ref={splashRef} geometry={splashGeo} material={splashMat} frustumCulled={false} renderOrder={13} />
    </>
  )
}

export function Snow({ max }: { max: number }) {
  const geo = useMemo(() => snowSeeds(max), [max])
  const mat = useMemo(
    () =>
      particleMaterial(SNOW_VERT, SNOW_FRAG, {
        uTime: { value: 0 },
        uSpeed: { value: 0.8 },
        uDrift: { value: 0.2 },
        uSize: { value: 9 },
        uPixelRatio: { value: 1 },
        uOpacity: { value: 0 },
      }),
    []
  )
  const ref = useRef<SnowPoints>(null)

  useFrame(({ clock, gl }) => {
    const p = ref.current
    if (!p) return
    p.geometry.setDrawRange(0, Math.floor(max * live.snow))
    const u = p.material.uniforms
    u.uTime.value = clock.elapsedTime
    u.uDrift.value = 0.1 + live.windKmh * 0.025
    u.uPixelRatio.value = gl.getPixelRatio()
    u.uOpacity.value = Math.min(1, live.snow * 1.5)
    u.uAspect.value = rig.aspect
  })

  return <points ref={ref} geometry={geo} material={mat} frustumCulled={false} renderOrder={11} />
}
