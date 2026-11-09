/**
 * The broadcast camera: close and steep enough that the 3D terrain reads as
 * relief. A phone at zoom 8 and pitch 58 frames about 50 km of ground across;
 * a wide screen at the same zoom shows four times as much and the relief
 * flattens to a carpet. So the zoom grows with the map's width (one zoom step
 * per doubling, the same ground per pixel column), within limits, and wide
 * screens tilt a little more. Capped at 9: closer in, MapLibre's hillshade turns
 * faint. A user who has zoomed in further keeps their zoom.
 */

export interface BroadcastCamera {
  zoom: number
  pitch: number
  bearing: number
}

/** The phone framing the camera is matched to. */
const BASE_WIDTH = 390
const BASE_ZOOM = 8
const MAX_ZOOM = 9

export function broadcastCamera(mapWidth: number, currentZoom: number): BroadcastCamera {
  const w = Math.max(1, mapWidth)
  const target = Math.min(MAX_ZOOM, Math.max(BASE_ZOOM, BASE_ZOOM + Math.log2(w / BASE_WIDTH)))
  return {
    zoom: Math.max(currentZoom, target),
    pitch: w >= 640 ? 64 : 58,
    bearing: -18,
  }
}
