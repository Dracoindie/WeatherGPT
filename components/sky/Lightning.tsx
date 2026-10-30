'use client'

/**
 * Procedural branching lightning. Every flash goes through sky.triggerFlash,
 * which enforces ≥ 350 ms between flashes (photosensitivity: < 3 per second).
 */

import { useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Line } from '@react-three/drei'
import * as THREE from 'three'
import { live, sky } from '@/lib/skyStore'
import { CAMERA_Z, rig, TAN_HALF_FOV } from './rig'

const BOLT_Z = -9

interface Bolt {
  id: number
  main: THREE.Vector3[]
  branches: THREE.Vector3[][]
}

function displace(start: THREE.Vector3, end: THREE.Vector3, detail: number, spread: number) {
  let pts = [start, end]
  for (let level = 0; level < detail; level++) {
    const next = [pts[0]]
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]
      const b = pts[i + 1]
      const mid = a.clone().lerp(b, 0.5)
      const len = a.distanceTo(b)
      mid.x += (Math.random() - 0.5) * len * spread
      mid.y += (Math.random() - 0.5) * len * spread * 0.25
      next.push(mid, b)
    }
    pts = next
  }
  return pts
}

let boltId = 0
function makeBolt(aspect: number): Bolt {
  const halfH = TAN_HALF_FOV * (CAMERA_Z - BOLT_Z)
  const halfW = halfH * aspect
  const x0 = (Math.random() * 2 - 1) * halfW * 0.65
  const start = new THREE.Vector3(x0, halfH * 1.05, BOLT_Z)
  const end = new THREE.Vector3(x0 + (Math.random() * 2 - 1) * 3, -halfH * (0.1 + Math.random() * 0.35), BOLT_Z)
  const main = displace(start, end, 6, 0.55)
  const branches: THREE.Vector3[][] = []
  const count = 2 + Math.floor(Math.random() * 3)
  for (let i = 0; i < count; i++) {
    const from = main[Math.floor(main.length * (0.15 + Math.random() * 0.5))]
    const side = Math.random() < 0.5 ? -1 : 1
    const to = from.clone().add(new THREE.Vector3(side * (1.2 + Math.random() * 2.4), -(1.5 + Math.random() * 3), 0))
    branches.push(displace(from.clone(), to, 4, 0.6))
  }
  return { id: ++boltId, main, branches }
}

export function Lightning() {
  const [bolt, setBolt] = useState<Bolt | null>(null)
  const group = useRef<THREE.Group>(null)
  const glow = useRef(0)
  const nextStrike = useRef(2)
  const flickerAt = useRef(0)

  useFrame(({ clock }, delta) => {
    const t = clock.elapsedTime
    const dt = Math.min(delta, 0.1)

    if (live.storm > 0.15 && t > nextStrike.current) {
      nextStrike.current = t + (1.4 + Math.random() * 4.5) / (0.4 + live.storm)
      if (sky.triggerFlash(0.42 + Math.random() * 0.33 * live.storm)) {
        glow.current = 1
        rig.shake = Math.max(rig.shake, 0.07 * live.storm)
        flickerAt.current = Math.random() < 0.6 ? t + 0.38 : 0
        setBolt(makeBolt(rig.aspect))
      }
    }
    // single after-flicker, still subject to the rate limit
    if (flickerAt.current && t > flickerAt.current) {
      flickerAt.current = 0
      if (sky.triggerFlash(0.22)) glow.current = Math.max(glow.current, 0.55)
    }

    glow.current *= Math.exp(-dt * 6.5)
    const g = group.current
    if (!g) return
    g.visible = glow.current > 0.02
    g.children.forEach((child, i) => {
      const mat = (child as THREE.Mesh).material as THREE.Material
      // children alternate: [glow, core] per segment
      mat.opacity = glow.current * (i % 2 === 0 ? 0.35 : 1)
    })
  })

  if (!bolt) return <group ref={group} />
  const paths = [bolt.main, ...bolt.branches]
  return (
    <group ref={group} key={bolt.id} renderOrder={5}>
      {paths.flatMap((pts, i) => {
        const main = i === 0
        return [
          <Line key={`g${i}`} points={pts} color="#8fb4ff" lineWidth={main ? 9 : 5} transparent depthTest={false} renderOrder={5} />,
          <Line key={`c${i}`} points={pts} color="#f4f8ff" lineWidth={main ? 2.4 : 1.2} transparent depthTest={false} renderOrder={6} />,
        ]
      })}
    </group>
  )
}
