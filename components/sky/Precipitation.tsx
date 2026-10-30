'use client'

/** GPU particles: instanced rain streaks, ground splashes, depth-of-field snow. */

import { useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { flash, live } from '@/lib/skyStore'
import { RAIN_FRAG, RAIN_VERT, SNOW_FRAG, SNOW_VERT, SPLASH_FRAG, SPLASH_VERT } from './shaders'
import { CAMERA_Z, rig, TAN_HALF_FOV } from './rig'

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

const depthUniforms = () => ({
  uTanHalf: { value: TAN_HALF_FOV },
  uAspect: { value: 1 },
  uCamZ: { value: CAMERA_Z },
})

export function Rain({ max, splashes }: { max: number; splashes: number }) {
  const rainGeo = useMemo(() => seededQuads(max, true), [max])
  const splashGeo = useMemo(() => seededQuads(splashes, false), [splashes])

  const rainMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: RAIN_VERT,
        fragmentShader: RAIN_FRAG,
        uniforms: {
          ...depthUniforms(),
          uTime: { value: 0 },
          uSpeed: { value: 10 },
          uSlant: { value: 0 },
          uOpacity: { value: 0 },
          uFlash: { value: 0 },
        },
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }),
    []
  )
  const splashMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: SPLASH_VERT,
        fragmentShader: SPLASH_FRAG,
        uniforms: { ...depthUniforms(), uTime: { value: 0 }, uRate: { value: 1.6 }, uOpacity: { value: 0 } },
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }),
    []
  )

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    const intensity = live.rain
    rainGeo.instanceCount = Math.floor(max * Math.min(1, intensity * 1.1))
    splashGeo.instanceCount = Math.floor(splashes * intensity)
    const u = rainMat.uniforms
    u.uTime.value = t
    u.uSpeed.value = 9 + live.windKmh * 0.06 + intensity * 4
    u.uSlant.value = Math.min(0.75, live.windKmh / 85)
    u.uOpacity.value = Math.min(1, 0.35 + intensity)
    u.uFlash.value = flash.value
    u.uAspect.value = rig.aspect
    const s = splashMat.uniforms
    s.uTime.value = t
    s.uOpacity.value = Math.min(1, intensity * 1.4)
    s.uAspect.value = rig.aspect
  })

  return (
    <>
      <mesh geometry={rainGeo} material={rainMat} frustumCulled={false} renderOrder={12} />
      <mesh geometry={splashGeo} material={splashMat} frustumCulled={false} renderOrder={13} />
    </>
  )
}

export function Snow({ max }: { max: number }) {
  const gl = useThree((s) => s.gl)
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const pos = new Float32Array(max * 3)
    const rnd = new Float32Array(max)
    for (let i = 0; i < pos.length; i++) pos[i] = Math.random()
    for (let i = 0; i < max; i++) rnd[i] = Math.random()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('aRand', new THREE.BufferAttribute(rnd, 1))
    g.setDrawRange(0, 0)
    return g
  }, [max])
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: SNOW_VERT,
        fragmentShader: SNOW_FRAG,
        uniforms: {
          ...depthUniforms(),
          uTime: { value: 0 },
          uSpeed: { value: 0.8 },
          uDrift: { value: 0.2 },
          uSize: { value: 9 },
          uPixelRatio: { value: 1 },
          uOpacity: { value: 0 },
        },
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }),
    []
  )

  useFrame(({ clock }) => {
    geo.setDrawRange(0, Math.floor(max * live.snow))
    const u = mat.uniforms
    u.uTime.value = clock.elapsedTime
    u.uDrift.value = 0.1 + live.windKmh * 0.025
    u.uPixelRatio.value = gl.getPixelRatio()
    u.uOpacity.value = Math.min(1, live.snow * 1.5)
    u.uAspect.value = rig.aspect
  })

  return <points geometry={geo} material={mat} frustumCulled={false} renderOrder={11} />
}
