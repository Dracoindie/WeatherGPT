/**
 * Does a box fit the backend's map tile plan? The same rule as
 * backend/maps/tiles.py plan(): the finest step on the ladder whose covering
 * tiles stay within maxPoints. When no step fits, /api/map/grid and
 * /api/map/hazard answer 422, so the map does not ask and says "zoom in".
 * The constants are generated from the backend (gridSpec.generated.ts) and
 * e2e/grid-spec.spec.ts checks this port against the backend's own verdicts.
 */

import { GRID_SPEC } from './gridSpec.generated'

export interface Box {
  south: number
  west: number
  north: number
  east: number
}

// Python's round(x, 6) before floor/ceil, so edge values land the same way.
const r6 = (x: number) => Math.round(x * 1e6) / 1e6

export function gridFits(box: Box, maxPoints: number = GRID_SPEC.maxPoints): boolean {
  const n = GRID_SPEC.tilePoints
  const limit = Math.max(n * n, Math.min(GRID_SPEC.maxPoints, maxPoints))
  for (const step of GRID_SPEC.stepLadder) {
    const span = n * step
    const last = (n - 1) * step
    const row0 = Math.floor(r6(box.south / span))
    const col0 = Math.floor(r6(box.west / span))
    const row1 = Math.max(row0, Math.ceil(r6((box.north - last) / span)))
    const col1 = Math.max(col0, Math.ceil(r6((box.east - last) / span)))
    if ((row1 - row0 + 1) * (col1 - col0 + 1) * n * n <= limit) return true
  }
  return false
}
