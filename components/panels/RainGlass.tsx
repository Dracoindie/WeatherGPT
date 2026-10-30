'use client'

/**
 * "Rain on glass" overlay for .sky-glass panels.
 *
 * Beads condense on the glass; larger drops grow, break loose and slide down
 * with a wobble, swallowing beads in their path and leaving a bead trail.
 * Each drop is a pre-rendered lens sprite: the refraction cue is the
 * inverted gradient (dark top / sky-lit bottom) plus a specular highlight.
 *
 * Driven by the shared eased scene (live.rain), so it fades in/out with the
 * sky. All panels share one requestAnimationFrame loop; nothing animates
 * under prefers-reduced-motion.
 */

import { useEffect, useRef } from 'react'
import { useReducedMotion } from 'framer-motion'
import { live } from '@/lib/skyStore'

// ---------------------------------------------------------------------------
// Shared ticker
// ---------------------------------------------------------------------------

type Tick = (dt: number) => void
const ticks = new Set<Tick>()
let rafId = 0
let last = 0

function loop(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000)
  last = now
  ticks.forEach((t) => t(dt))
  rafId = ticks.size ? requestAnimationFrame(loop) : 0
}

function addTick(t: Tick) {
  ticks.add(t)
  if (!rafId) {
    last = performance.now()
    rafId = requestAnimationFrame(loop)
  }
  return () => {
    ticks.delete(t)
  }
}

// ---------------------------------------------------------------------------
// Lens sprite (rendered once)
// ---------------------------------------------------------------------------

let sprite: HTMLCanvasElement | null = null
const SPRITE_W = 64
const SPRITE_H = 76

function getSprite(): HTMLCanvasElement {
  if (sprite) return sprite
  const c = document.createElement('canvas')
  c.width = SPRITE_W
  c.height = SPRITE_H
  const g = c.getContext('2d')
  if (!g) return c
  const cx = SPRITE_W / 2
  const cy = SPRITE_H / 2 + 2
  const rx = SPRITE_W / 2 - 4
  const ry = SPRITE_H / 2 - 4

  // contact shadow below the drop
  g.fillStyle = 'rgba(0, 0, 0, 0.28)'
  g.beginPath()
  g.ellipse(cx, cy + 3, rx, ry, 0, 0, Math.PI * 2)
  g.fill()

  // lens body: inverted world — dark at the top, sky light at the bottom
  const body = g.createLinearGradient(0, cy - ry, 0, cy + ry)
  body.addColorStop(0, 'rgba(4, 8, 18, 0.55)')
  body.addColorStop(0.55, 'rgba(60, 90, 130, 0.25)')
  body.addColorStop(1, 'rgba(190, 220, 255, 0.55)')
  g.fillStyle = body
  g.beginPath()
  g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
  g.fill()

  // caustic glow at the bottom edge
  const caustic = g.createRadialGradient(cx, cy + ry * 0.55, 0, cx, cy + ry * 0.55, rx * 0.8)
  caustic.addColorStop(0, 'rgba(220, 240, 255, 0.45)')
  caustic.addColorStop(1, 'rgba(220, 240, 255, 0)')
  g.fillStyle = caustic
  g.fill()

  // rim
  g.strokeStyle = 'rgba(255, 255, 255, 0.18)'
  g.lineWidth = 1.5
  g.stroke()

  // specular highlight
  const hl = g.createRadialGradient(cx - rx * 0.35, cy - ry * 0.45, 0, cx - rx * 0.35, cy - ry * 0.45, rx * 0.38)
  hl.addColorStop(0, 'rgba(255, 255, 255, 0.95)')
  hl.addColorStop(1, 'rgba(255, 255, 255, 0)')
  g.fillStyle = hl
  g.beginPath()
  g.arc(cx - rx * 0.35, cy - ry * 0.45, rx * 0.38, 0, Math.PI * 2)
  g.fill()

  sprite = c
  return c
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

interface Drop {
  x: number
  y: number
  r: number
  vy: number
  sliding: boolean
  wobble: number
  trailCooldown: number
}

const MAX_DROPS = 140

export function RainGlass() {
  const ref = useRef<HTMLCanvasElement>(null)
  const reduced = useReducedMotion()

  useEffect(() => {
    const canvas = ref.current
    if (!canvas || reduced) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const lens = getSprite()
    const dpr = Math.min(1.5, window.devicePixelRatio || 1)
    let w = 0
    let h = 0
    let drops: Drop[] = []
    let visible = true
    let painted = false

    const resize = () => {
      w = canvas.clientWidth
      h = canvas.clientHeight
      canvas.width = Math.max(1, Math.round(w * dpr))
      canvas.height = Math.max(1, Math.round(h * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      drops = drops.filter((d) => d.x < w && d.y < h)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting
    })
    io.observe(canvas)

    const spawn = (x: number, y: number, r: number): Drop => ({
      x,
      y,
      r,
      vy: 0,
      sliding: false,
      wobble: Math.random() * 10,
      trailCooldown: 0,
    })

    const tick = (dt: number) => {
      if (!visible) return
      const rain = live.rain
      if (rain < 0.04 && drops.length === 0) {
        if (painted) {
          ctx.clearRect(0, 0, w, h)
          painted = false
        }
        return
      }

      // condensation: spawn beads proportional to rain and panel area
      const area = (w * h) / 60000
      const cap = Math.min(MAX_DROPS, Math.floor(30 + area * 40 * rain))
      const spawnRate = rain * area * 26
      if (rain > 0.04 && drops.length < cap && Math.random() < spawnRate * dt) {
        drops.push(spawn(Math.random() * w, Math.random() * h * 0.85, 1.2 + Math.random() * (2 + rain * 4)))
      }
      // dry out when the rain stops
      if (rain < 0.04) drops.forEach((d) => (d.r -= dt * 1.2))

      for (const d of drops) {
        if (!d.sliding) {
          // grow slowly; heavy drops break loose
          d.r += dt * rain * 0.35 * Math.random()
          if (d.r > 4.8 + Math.random() * 1.5 && Math.random() < dt * (0.6 + rain)) d.sliding = true
          continue
        }
        d.vy = Math.min(140 + d.r * 18, d.vy + dt * (90 + d.r * 25))
        // stick-slip: occasional pauses make it read as real water
        if (Math.random() < dt * 0.8) d.vy *= 0.25
        d.y += d.vy * dt
        d.wobble += dt * 6
        d.x += Math.sin(d.wobble) * 0.25
        d.trailCooldown -= dt
        if (d.trailCooldown <= 0 && d.r > 2.5) {
          d.trailCooldown = 0.06 + Math.random() * 0.08
          d.r -= 0.12
          if (drops.length < MAX_DROPS) drops.push(spawn(d.x + (Math.random() - 0.5) * 2, d.y - d.r * 1.6, 0.8 + Math.random() * 1.2))
        }
      }

      // sliding drops swallow beads they pass through
      for (const d of drops) {
        if (!d.sliding) continue
        for (const o of drops) {
          if (o === d || o.r <= 0 || o.sliding) continue
          const dx = o.x - d.x
          const dy = o.y - d.y
          if (dx * dx + dy * dy < (d.r + o.r) * (d.r + o.r) * 0.8) {
            d.r = Math.min(11, Math.sqrt(d.r * d.r + o.r * o.r))
            o.r = 0
          }
        }
      }
      drops = drops.filter((d) => d.r > 0.4 && d.y - d.r * 2 < h)

      ctx.clearRect(0, 0, w, h)
      for (const d of drops) {
        const rw = d.r * 2
        const rh = d.r * (d.sliding ? 2.6 : 2.25)
        ctx.drawImage(lens, d.x - d.r, d.y - rh * 0.55, rw, rh)
      }
      painted = true
    }

    const remove = addTick(tick)
    return () => {
      remove()
      ro.disconnect()
      io.disconnect()
    }
  }, [reduced])

  return <canvas ref={ref} className="rain-glass h-full w-full" aria-hidden="true" />
}
