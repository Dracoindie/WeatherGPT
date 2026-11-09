'use client'

/**
 * The /map engine: MapLibre GL (OpenFreeMap vector tiles, AWS terrain tiles,
 * both keyless) with a deck.gl overlay. Loaded only on /map (next/dynamic,
 * ssr: false), so no other route ships maplibre or deck.gl.
 *
 * - Tap anywhere: GET /api/map/point, a gold pin and a glass card.
 * - Layers: GET /api/map/grid for the visible box (one batched Open-Meteo
 *   request), drawn as a semi-transparent surface interpolated between the
 *   grid points: a MapLibre raster UNDER the basemap's roads and labels, so
 *   place names stay readable; its colours span the values at the hour shown.
 * - Time slider over the next 72 hours drives every layer.
 * - Broadcast mode: 3D terrain, tilt, extruded rain columns, wind particles
 *   that follow the real wind, a slow flyover and a big title and legend.
 *   Under prefers-reduced-motion or lite mode it stays 2D and still: no
 *   terrain, no flyover, no particles (wind arrows instead).
 *
 * - Route mode: weather along a driving route at the hour the traveller
 *   passes each point (GET /api/route, components/map3d/route.tsx).
 *
 * Every number drawn comes from the API. The map always says the model grid
 * size and that values are estimated and not official IMD data.
 */

import 'maplibre-gl/dist/maplibre-gl.css'
import type { Layer } from '@deck.gl/core'
import { ColumnLayer, LineLayer, ScatterplotLayer } from '@deck.gl/layers'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { useReducedMotion } from 'framer-motion'
import { Crosshair, Pause, Play, Tv, X } from 'lucide-react'
import { getVersion, Map as MapLibreMap, NavigationControl, setWorkerUrl, type CanvasSource, type FlyToOptions } from 'maplibre-gl'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { SkyButton } from '@/components/ui/SkyButton'
import { fill, useI18n, type TranslationKey } from '@/context/I18nContext'
import { fetchMapGrid, fetchMapPoint, type MapGrid } from '@/lib/api/map'
import { formatLocalTime, zonedClock } from '@/lib/format'
import { useLiteMode } from '@/lib/liteMode'
import { cn } from '@/lib/utils'
import { distinctColors, featherEdges, fieldPixels, LAYERS, rampFor, tokenRgb, valuesAt, windVector, type LayerId, type RGB } from './field'
import { MapLegend } from './MapLegend'
import { MapPointCard, type PointState } from './MapPointCard'
import {
  HazardCard,
  HazardLegend,
  hazardColors,
  hazardLayers,
  HazardSummaryPanel,
  HazardTypeChips,
  useHazard,
  useHexPolygons,
  type HazardType,
  type HexPick,
} from './hazard'
import { createField, PARTICLE_STYLE, particleCount, retarget, segmentAlpha, step, TRAIL, type ParticleField } from './particles'
import { routeBounds, routeLayers, RoutePlanner, RouteReportPanel, useRoute } from './route'
import { addMissingImageFallback, collapseAttributionOnUse, cssVar, firstOverlayLayer, MAPLIBRE_WORKER, tintBasemap } from './basemap'
import { broadcastCamera } from './camera'
import { gridFits } from './gridPlan'
import { KEYLESS, mapSources, type MapSources } from './sources'


/** Country view when no place is picked yet: India as a whole, not a city. */
const INDIA_VIEW = { center: [80, 22.5] as [number, number], zoom: 3.6 }

export interface MapPlace {
  latitude: number
  longitude: number
  name: string
}

interface Props {
  place: MapPlace | null
  /** for the place card: weather in the UI language, alert status line */
  conditionLabel?: string
  statusText?: string
  statusTone?: 'none' | 'warning'
  /** IANA zone for time labels (the place's, from /api/weather) */
  timezone?: string
}

type GridStatus = 'idle' | 'loading' | 'ready' | 'error' | 'too-large'
/** A weather surface, the hazard hexes and roads, or weather along a route. */
type MapMode = LayerId | 'hazard' | 'route'
const MODES: MapMode[] = [...LAYERS, 'hazard', 'route']

const rgba = (c: RGB, a: number): [number, number, number, number] => [c[0], c[1], c[2], a]

/** The weather surface's opacity: the basemap (and its labels, drawn above) stays readable. */
const FIELD_OPACITY = 0.5
const FIELD_ID = 'wx-field'
/** Broadcast 3D: the surface fades out over this share of each edge (no hard rectangle in the tilted view). */
const FIELD_FEATHER = 0.18
/** Broadcast 3D: ask for this much more than the view on each side, when the tile plan allows, so the fade sits off screen. */
const BROADCAST_PAD = 0.25

export function WeatherMap({ place: placeProp, conditionLabel, statusText, statusTone = 'none', timezone }: Props) {
  // The page passes a new object each render; only a real move counts.
  const placeKey = placeProp ? `${placeProp.latitude},${placeProp.longitude},${placeProp.name}` : ''
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const place = useMemo(() => placeProp, [placeKey])
  const { t, language } = useI18n()
  const reducedMotion = useReducedMotion() ?? false
  const { lite } = useLiteMode()
  const motion = !reducedMotion && !lite

  // The MapLibre container is created once and moved between the inline slot
  // and the full-screen broadcast slot (a portal on <body>), so the map is
  // never rebuilt. A portal escapes the page's stacking contexts and the
  // glass panels' backdrop-filter, which would otherwise trap position: fixed.
  const [mapEl] = useState(() => {
    const d = document.createElement('div')
    d.className = 'h-full w-full'
    d.setAttribute('role', 'region')
    return d
  })
  const [slot, setSlot] = useState<HTMLDivElement | null>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const overlayRef = useRef<MapboxOverlay | null>(null)
  const [mapError, setMapError] = useState(false)
  const [mapReady, setMapReady] = useState(false)

  const [grid, setGrid] = useState<MapGrid | null>(null)
  const [gridStatus, setGridStatus] = useState<GridStatus>('idle')
  const [layer, setLayer] = useState<MapMode>('temperature')
  const surface: LayerId | null = layer === 'hazard' || layer === 'route' ? null : layer
  const [hazardType, setHazardType] = useState<HazardType>('overall')
  const [hexPick, setHexPick] = useState<HexPick | null>(null)
  const [mapObj, setMapObj] = useState<MapLibreMap | null>(null)
  // MapTiler when NEXT_PUBLIC_MAPTILER_KEY is set, else (or after a refusal) the keyless sources
  const sourcesRef = useRef<MapSources>(mapSources())
  const [basemap, setBasemap] = useState<MapSources['provider']>(() => mapSources().provider)
  const [viewCentre, setViewCentre] = useState<{ latitude: number; longitude: number } | null>(null)
  const [hour, setHour] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [broadcast, setBroadcast] = useState(false)
  const [point, setPoint] = useState<PointState | null>(null)
  // ssr: false, so window exists on first render
  const [pitch, setPitch] = useState(0)
  const [terrainOn, setTerrainOn] = useState(false)
  const [mobile] = useState(() => window.matchMedia('(max-width: 639px)').matches)

  const broadcast3d = broadcast && motion
  // no particles over the hazard hexes, roads or a route: they would hide the levels
  const particlesOn = motion && layer !== 'hazard' && layer !== 'route' && (broadcast || layer === 'wind')
  // broadcast over a weather surface: the wind is a hint on top of the colours (thinner, fainter, sparser)
  const softParticles = broadcast && layer !== 'wind'
  const tz = timezone ?? (typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC')

  // -------------------------------------------------------------- hazard ---
  const hazardOn = layer === 'hazard'
  const maxGridHour = grid ? grid.times.length - 1 : 0
  const hz = useHazard({
    map: mapObj,
    active: hazardOn,
    hour: Math.min(hour, 48),
    type: hazardType,
    centre: place ?? viewCentre,
    mapReady,
  })
  const hazard = hazardOn ? hz.hazard : null
  const hexes = useHexPolygons(hazard)
  const maxHour = hazardOn && hazard ? hazard.max_hour : maxGridHour
  const hourShown = Math.min(hour, maxHour)
  const pickedHex = hazard && hexPick && hexPick.point < hazard.points.length ? hexPick : null

  // --------------------------------------------------------------- route ---
  const routeOn = layer === 'route'
  const rt = useRoute()
  const routeReport = routeOn ? rt.report : null

  // ---------------------------------------------------------------- grid ---
  const gridAbort = useRef<AbortController | null>(null)
  const gridTimer = useRef<number | null>(null)
  // The loaded grid's coverage and the zoom it was asked for: a pan or small
  // zoom that stays inside it needs no new request (Open-Meteo free tier).
  const gridCover = useRef<{ south: number; west: number; north: number; east: number; zoom: number } | null>(null)
  const [gridRequests, setGridRequests] = useState(0)
  // broadcast 3D asks for a margin around the view (BROADCAST_PAD)
  const padRef = useRef(false)
  useEffect(() => {
    padRef.current = broadcast3d
  }, [broadcast3d])
  const loadGrid = useCallback(() => {
    const map = mapRef.current
    if (!map) return
    if (gridTimer.current) window.clearTimeout(gridTimer.current)
    gridTimer.current = window.setTimeout(() => {
      const b = map.getBounds()
      const box = {
        south: Math.max(-84, b.getSouth()),
        north: Math.min(84, b.getNorth()),
        west: Math.max(-179.9, b.getWest()),
        east: Math.min(179.9, b.getEast()),
      }
      if (box.north <= box.south || box.east <= box.west) return
      // 4 shared tiles of 25 points (backend/maps/tiles.py)
      const max = 100
      // Too large for the tile plan: the backend would answer 422. Say "zoom in" without asking.
      if (!gridFits(box, max)) {
        gridAbort.current?.abort()
        gridCover.current = null
        setGridStatus('too-large')
        return
      }
      const zoom = map.getZoom()
      const cover = gridCover.current
      if (
        cover &&
        Math.abs(zoom - cover.zoom) < 0.5 &&
        box.south >= cover.south &&
        box.north <= cover.north &&
        box.west >= cover.west &&
        box.east <= cover.east
      )
        return
      // the view check above uses the view itself; the request adds the margin
      if (padRef.current) {
        const dy = (box.north - box.south) * BROADCAST_PAD
        const dx = (box.east - box.west) * BROADCAST_PAD
        const padded = {
          south: Math.max(-84, box.south - dy),
          north: Math.min(84, box.north + dy),
          west: Math.max(-179.9, box.west - dx),
          east: Math.min(179.9, box.east + dx),
        }
        if (gridFits(padded, max)) Object.assign(box, padded)
      }
      gridAbort.current?.abort()
      const ctrl = new AbortController()
      gridAbort.current = ctrl
      setGridStatus('loading')
      setGridRequests((n) => n + 1)
      fetchMapGrid(box, max, ctrl.signal)
        .then((g) => {
          gridCover.current = { south: g.south, west: g.west, north: g.north, east: g.east, zoom }
          setGrid(g)
          setGridStatus('ready')
          setHour((h) => Math.min(h, Math.max(0, g.times.length - 1)))
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === 'AbortError') return
          gridCover.current = null
          setGridStatus(err instanceof Error && /422/.test(err.message) ? 'too-large' : 'error')
        })
    }, 450)
  }, [])

  // --------------------------------------------------------------- point ---
  const pointAbort = useRef<AbortController | null>(null)
  const pinStart = useRef(0)
  const showPoint = useCallback((latitude: number, longitude: number) => {
    pointAbort.current?.abort()
    const ctrl = new AbortController()
    pointAbort.current = ctrl
    pinStart.current = performance.now()
    setPoint({ status: 'loading', latitude, longitude })
    fetchMapPoint(latitude, longitude, ctrl.signal)
      .then((data) => setPoint({ status: 'ready', latitude, longitude, data }))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return
        setPoint({ status: 'error', latitude, longitude })
      })
  }, [])

  // A tap: in hazard mode the hex under it, otherwise the point weather.
  const clickRef = useRef<(x: number, y: number, lat: number, lon: number) => void>(() => {})
  // ------------------------------------------------------------ map init ---
  const initialPlace = useRef(place)
  useEffect(() => {
    const el = mapEl
    let map: MapLibreMap
    try {
      setWorkerUrl(`${MAPLIBRE_WORKER}?v=${getVersion()}`)
      const p = initialPlace.current
      map = new MapLibreMap({
        container: el,
        style: sourcesRef.current.style,
        center: p ? [p.longitude, p.latitude] : INDIA_VIEW.center,
        zoom: p ? 8 : INDIA_VIEW.zoom,
        maxPitch: 72,
        // compact (the (i) button) only on small maps, where MapLibre switches at <= 640 px
        attributionControl: {},
        // Keyboard users pan with the arrow keys; the map canvas is focusable.
        keyboard: true,
      })
    } catch {
      // No WebGL (or it failed to start): the page still shows the place and its weather.
      const id = window.setTimeout(() => setMapError(true), 0)
      return () => window.clearTimeout(id)
    }
    mapRef.current = map
    map.addControl(new NavigationControl({ visualizePitch: true }), 'bottom-right')
    const overlay = new MapboxOverlay({ interleaved: false, layers: [] })
    overlayRef.current = overlay
    map.addControl(overlay)

    // icons the basemap's sprite lacks (OpenFreeMap dark asks for "circle-11"): a small neutral dot
    addMissingImageFallback(map)
    collapseAttributionOnUse(map)
    map.on('style.load', () => tintBasemap(map))
    map.on('load', () => {
      setMapReady(true)
      setMapObj(map)
      loadGrid()
    })
    // the broadcast flyover turns the camera a little every frame; each turn
    // ends a "move", which kept restarting the grid debounce so it never fired
    map.on('moveend', (e: { flyover?: boolean }) => {
      if (!e.flyover) loadGrid()
    })
    map.on('moveend', (e: { flyover?: boolean }) => {
      if (e.flyover) return
      const c = map.getCenter()
      setViewCentre({ latitude: c.lat, longitude: c.lng })
    })
    map.on('pitchend', () => setPitch(Math.round(map.getPitch())))
    map.on('terrain', () => setTerrainOn(map.getTerrain() != null))
    map.on('click', (e) => clickRef.current(e.point.x, e.point.y, e.lngLat.lat, e.lngLat.lng))
    map.on('error', (e) => {
      console.warn('[map]', e.error?.message ?? e)
      // MapTiler refused the key, is over quota or unreachable: fall back to the keyless sources
      const status = (e.error as { status?: number } | undefined)?.status
      if (sourcesRef.current.provider === 'maptiler' && (!map.isStyleLoaded() || status === 401 || status === 403 || status === 429)) {
        sourcesRef.current = KEYLESS
        setBasemap('openfreemap')
        map.setStyle(KEYLESS.style)
      }
    })

    return () => {
      gridAbort.current?.abort()
      pointAbort.current?.abort()
      if (gridTimer.current) window.clearTimeout(gridTimer.current)
      overlayRef.current = null
      mapRef.current = null
      // each step on its own: one failing must not leave the map (and its
      // render loop and listeners) alive after navigation
      const steps: Array<() => void> = [
        () => map.stop(),
        () => overlay.setProps({ layers: [] }),
        () => map.removeControl(overlay), // MapboxOverlay.onRemove finalizes deck
        () => map.remove(), // MapLibre: WebGL context, render loop, every listener
      ]
      for (const s of steps) {
        try {
          s()
        } catch (err) {
          console.warn('[map] cleanup step failed', err)
        }
      }
    }
  }, [mapEl, loadGrid, showPoint])

  useLayoutEffect(() => {
    if (!slot) return
    slot.appendChild(mapEl)
    mapRef.current?.resize()
  }, [slot, mapEl])

  useEffect(() => {
    mapEl.setAttribute('aria-label', t('map.region'))
  }, [mapEl, t])

  // No page scroll behind the full-screen broadcast.
  useEffect(() => {
    if (!broadcast) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [broadcast])

  // Follow the picked place.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !place) return
    return flyToSteady(map, { center: [place.longitude, place.latitude], zoom: Math.max(map.getZoom(), 8), animate: motion })
  }, [place, motion])

  // ------------------------------------------------------ broadcast mode ---
  // The view when broadcast began, restored when it ends.
  const preBroadcastView = useRef<{ center: [number, number]; zoom: number } | null>(null)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    // Entering or leaving broadcast moves the container node through a portal:
    // for a moment it is 0x0, and a resize and camera move made at that size
    // land hundreds of km off (MapLibre keeps a centre from the 0x0 view and
    // eases from it). Remember the view now, while it is still right, and move
    // the camera only once the container has its real size.
    if (broadcast && !preBroadcastView.current) {
      const c = map.getCenter()
      preBroadcastView.current = { center: [c.lng, c.lat], zoom: map.getZoom() }
    }
    const view = preBroadcastView.current
    if (!broadcast) preBroadcastView.current = null

    const apply = () => {
      map.resize()
      if (view) map.jumpTo({ center: view.center, zoom: view.zoom })
      if (broadcast3d) {
        if (!map.getSource('terrain')) {
          const dem = sourcesRef.current.terrain
          map.addSource('terrain', { type: 'raster-dem', ...dem })
          map.addSource('terrain-shade', { type: 'raster-dem', ...dem, attribution: undefined })
        }
        if (!map.getLayer('terrain-hillshade')) {
          // under the roads and labels, so place names stay on top of the relief
          map.addLayer(
            {
              id: 'terrain-hillshade',
              type: 'hillshade',
              source: 'terrain-shade',
              paint: { 'hillshade-shadow-color': cssVar('--sky-floor', 'black'), 'hillshade-highlight-color': cssVar('--sky-accent-2', 'white'), 'hillshade-exaggeration': 0.6 },
            },
            firstOverlayLayer(map)
          )
        }
        // Real 3D terrain. Needs MapLibre 5: deck.gl 9.4's overlay reads
        // map.transform.elevation when terrain is set, which MapLibre 6 removed
        // (it threw on every frame). scripts/copy-maplibre-worker.mjs
        map.setTerrain({ source: 'terrain', exaggeration: 1.6 })
        // the centre is explicit: the tilt must not walk the place off screen
        const center = view?.center ?? map.getCenter()
        // close and steep enough for the relief to show on wide screens too (camera.ts)
        const cam = broadcastCamera(el.clientWidth, view?.zoom ?? map.getZoom())
        map.easeTo({ center, ...cam, duration: 1800 })
      } else {
        if (map.getTerrain()) map.setTerrain(null)
        if (map.getLayer('terrain-hillshade')) map.removeLayer('terrain-hillshade')
        if (map.getPitch() !== 0 || map.getBearing() !== 0) map.easeTo({ pitch: 0, bearing: 0, duration: motion ? 900 : 0 })
      }
    }

    const el = map.getContainer()
    if (el.clientWidth > 0 && el.clientHeight > 0) {
      apply()
      return
    }
    const onResize = () => {
      if (el.clientWidth === 0 || el.clientHeight === 0) return
      map.off('resize', onResize)
      apply()
    }
    map.on('resize', onResize)
    return () => {
      map.off('resize', onResize)
    }
  }, [broadcast3d, broadcast, mapReady, motion])

  // Esc leaves broadcast mode; broadcast plays the 72 hours when motion is allowed.
  useEffect(() => {
    if (!broadcast) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setBroadcast(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [broadcast])

  // ----------------------------------------------------------- time play ---
  useEffect(() => {
    if (!playing || !grid) return
    const id = window.setInterval(() => setHour((h) => (Math.min(h, maxHour) + 1) % (maxHour + 1)), 900)
    return () => window.clearInterval(id)
  }, [playing, grid, maxHour])

  // -------------------------------------------------------------- layers ---
  const colors = useMemo(
    () => ({ gold: tokenRgb('--map-gold', [252, 211, 77]), accent: tokenRgb('--sky-accent', [34, 211, 238]), ink: tokenRgb('--sky-text', [231, 240, 255]) }),
    []
  )

  const staticLayers = useMemo<Layer[]>(() => {
    const out: Layer[] = []
    // the surface itself is a MapLibre raster under the roads and labels (see the effect below)
    if (grid && gridStatus !== 'too-large' && surface) {
      if (broadcast || layer === 'rain') {
        const rain = valuesAt(grid, 'rain', hour)
        const ramp = rampFor('rain')
        const wet = grid.points.map((p, i) => ({ p, mm: rain[i] })).filter((d) => d.mm != null && d.mm >= 0.1) as Array<{ p: MapGrid['points'][number]; mm: number }>
        const radius = grid.spacing_km * 1000 * 0.22
        // the wettest column is ~1.5 grid spacings tall, whatever the zoom
        const maxMm = Math.max(1, ...wet.map((d) => d.mm))
        out.push(
          broadcast3d
            ? new ColumnLayer({
                id: 'rain-columns',
                data: wet,
                getPosition: (d) => [d.p.longitude, d.p.latitude],
                getElevation: (d) => d.mm,
                elevationScale: (grid.spacing_km * 1000 * 1.5) / maxMm,
                radius,
                diskResolution: 12,
                extruded: true,
                getFillColor: (d) => rgba(ramp[Math.min(3, Math.floor(d.mm / 2.5))], 220),
                updateTriggers: { getElevation: hour, getFillColor: hour },
              })
            : new ScatterplotLayer({
                id: 'rain-dots',
                data: wet,
                getPosition: (d) => [d.p.longitude, d.p.latitude],
                getRadius: (d) => Math.min(14, 3 + d.mm * 1.5),
                radiusUnits: 'pixels',
                getFillColor: (d) => rgba(ramp[Math.min(3, Math.floor(d.mm / 2.5))], 200),
                updateTriggers: { getRadius: hour, getFillColor: hour },
              })
        )
      }

      if (!motion && (broadcast || layer === 'wind')) {
        // Still wind arrows: from each grid point toward where the air goes.
        const data = grid.points
          .map((p) => ({ p, s: p.wind_speed_10m[hour], d: p.wind_direction_10m[hour] }))
          .filter((x) => x.s != null && x.d != null) as Array<{ p: MapGrid['points'][number]; s: number; d: number }>
        const scale = grid.step_deg * 0.45
        const maxS = Math.max(1, ...data.map((x) => x.s))
        const end = (x: (typeof data)[number]): [number, number] => {
          const [u, v] = windVector(x.s, x.d)
          const k = (scale / maxS) * 1
          return [x.p.longitude + u * k, x.p.latitude + v * k]
        }
        out.push(
          new LineLayer({
            id: 'wind-arrows',
            data,
            getSourcePosition: (x) => [x.p.longitude, x.p.latitude],
            getTargetPosition: end,
            getColor: rgba(colors.ink, 220),
            getWidth: 2,
            widthUnits: 'pixels',
            updateTriggers: { getTargetPosition: hour },
          }),
          new ScatterplotLayer({
            id: 'wind-heads',
            data,
            getPosition: end,
            getRadius: 2.5,
            radiusUnits: 'pixels',
            getFillColor: rgba(colors.ink, 230),
            updateTriggers: { getPosition: hour },
          })
        )
      }
    }

    if (hazard) {
      out.push(...hazardLayers({ hazard, hexes, roads: hz.roads, type: hazardType, colors: hazardColors(), big: broadcast }))
    }

    if (routeOn) {
      out.push(
        ...routeLayers({
          report: routeReport,
          from: rt.from,
          to: rt.to,
          colors: { ...hazardColors(), unknown: tokenRgb('--sev-unknown', [148, 163, 184]), marker: colors.gold },
        })
      )
    }

    if (place) {
      out.push(
        new ScatterplotLayer({
          id: 'place',
          data: [place],
          getPosition: (d: MapPlace) => [d.longitude, d.latitude],
          getRadius: 7,
          radiusUnits: 'pixels',
          stroked: true,
          getLineColor: rgba(colors.ink, 255),
          lineWidthUnits: 'pixels',
          getLineWidth: 2,
          getFillColor: rgba(colors.accent, 255),
        })
      )
    }
    return out
  }, [grid, gridStatus, surface, layer, hour, broadcast, broadcast3d, motion, place, colors, hazard, hexes, hz.roads, hazardType, routeOn, routeReport, rt.from, rt.to])

  // Show the whole route when a new report arrives.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !routeReport || routeReport.segments.length === 0) return
    map.fitBounds(routeBounds(routeReport), { padding: mobile ? 32 : 60, maxZoom: 11, animate: motion, duration: motion ? 900 : 0 })
  }, [routeReport, motion, mobile])

  // The weather surface: a MapLibre canvas source and raster layer inserted
  // under the basemap's first road or label layer, semi-transparent. deck.gl's
  // (non-interleaved) overlay always draws on top of the whole basemap, which
  // hid the place names. A canvas source, not an image source: MapLibre 5's
  // ImageSource.load() reads its AbortController after an await, so an
  // updateImage() (hour change) or removal (navigation) in between queued a
  // request with a null controller and its image queue threw on "signal".
  const rootRef = useRef<HTMLDivElement>(null)
  const fieldCanvasRef = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const apply = () => {
      const root = rootRef.current
      if (!grid || gridStatus === 'too-large' || !surface) {
        if (map.getLayer(FIELD_ID)) map.removeLayer(FIELD_ID)
        if (map.getSource(FIELD_ID)) map.removeSource(FIELD_ID)
        root?.removeAttribute('data-field-before')
        root?.removeAttribute('data-field-colors')
        return
      }
      const w = Math.min(256, grid.cols * 24)
      const h = Math.min(256, grid.rows * 24)
      const feather = broadcast3d ? FIELD_FEATHER : 0
      const px = featherEdges(fieldPixels(grid, surface, hour, rampFor(surface), w, h, 255, playing), w, h, feather)
      const canvas = (fieldCanvasRef.current ??= document.createElement('canvas'))
      if (canvas.width !== w) canvas.width = w
      if (canvas.height !== h) canvas.height = h
      canvas.getContext('2d')?.putImageData(new ImageData(px as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0)
      const north = grid.south + (grid.rows - 1) * grid.step_deg
      const east = grid.west + (grid.cols - 1) * grid.step_deg
      const coordinates: [[number, number], [number, number], [number, number], [number, number]] = [
        [grid.west, north],
        [east, north],
        [east, grid.south],
        [grid.west, grid.south],
      ]
      const src = map.getSource(FIELD_ID) as CanvasSource | undefined
      if (src) {
        src.setCoordinates(coordinates)
        // animate: false uploads the canvas once; play for one frame to upload the redraw
        src.play()
        map.off('render', pauseField)
        pauseField = () => src.pause()
        map.once('render', pauseField)
      } else {
        map.addSource(FIELD_ID, { type: 'canvas', canvas, coordinates, animate: false })
      }
      const before = firstOverlayLayer(map)
      if (!map.getLayer(FIELD_ID)) {
        map.addLayer(
          {
            id: FIELD_ID,
            type: 'raster',
            source: FIELD_ID,
            paint: { 'raster-opacity': FIELD_OPACITY, 'raster-resampling': 'linear', 'raster-fade-duration': 0 },
          },
          before
        )
      }
      root?.setAttribute('data-field-before', before ?? '')
      root?.setAttribute('data-field-colors', String(distinctColors(px)))
      root?.setAttribute('data-field-opacity', String(FIELD_OPACITY))
      root?.setAttribute('data-field-feather', String(feather))
    }
    let pauseField = () => {}
    const retry = () => apply()
    try {
      apply()
    } catch {
      // the style is (re)loading, e.g. after the MapTiler fallback: try again when it settles
      map.once('idle', retry)
    }
    return () => {
      map.off('idle', retry)
      map.off('render', pauseField)
    }
  }, [grid, gridStatus, surface, hour, playing, mapReady, basemap, broadcast3d])

  // Particles live outside React state: the frame loop advances them and
  // pushes layers to deck directly.
  const fieldRef = useRef<ParticleField | null>(null)
  useEffect(() => {
    if (!particlesOn || !grid) {
      fieldRef.current = null
      return
    }
    const count = particleCount(window.innerWidth, mobile, softParticles)
    const f = fieldRef.current
    // same density: keep the particles and their trails, take the new hour's wind
    if (f && f.particles.length === count) {
      retarget(f, grid, hour)
      return
    }
    const b = mapRef.current?.getBounds()
    fieldRef.current = createField(grid, hour, count, b ? { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() } : undefined)
  }, [particlesOn, grid, hour, mobile, softParticles])

  const dynamicLayers = useCallback(
    (now: number): Layer[] => {
      const out: Layer[] = []
      const f = fieldRef.current
      if (f) {
        const style = PARTICLE_STYLE[softParticles ? 'soft' : 'normal']
        out.push(
          // TRAIL - 1 segments per particle, fading toward the tail; accessors
          // fill deck's target arrays, so no objects are made per frame
          new LineLayer({
            id: 'wind-particles',
            data: { length: f.particles.length * (TRAIL - 1) },
            getSourcePosition: (_: unknown, { index, target }: { index: number; target: number[] }) => {
              const tr = f.particles[Math.floor(index / (TRAIL - 1))].trail
              const k = index % (TRAIL - 1)
              target[0] = tr[2 * k + 2]
              target[1] = tr[2 * k + 3]
              target[2] = 0 // deck's reused array has 3 slots: a stale z would drop the segment
              return target as [number, number, number]
            },
            getTargetPosition: (_: unknown, { index, target }: { index: number; target: number[] }) => {
              const tr = f.particles[Math.floor(index / (TRAIL - 1))].trail
              const k = index % (TRAIL - 1)
              target[0] = tr[2 * k]
              target[1] = tr[2 * k + 1]
              target[2] = 0
              return target as [number, number, number]
            },
            getColor: (_: unknown, { index }: { index: number }) => {
              const p = f.particles[Math.floor(index / (TRAIL - 1))]
              return rgba(colors.ink, segmentAlpha(style, index % (TRAIL - 1), p.speed, f.maxSpeed))
            },
            getWidth: style.width,
            widthUnits: 'pixels',
            updateTriggers: { getSourcePosition: now, getTargetPosition: now, getColor: now },
          })
        )
      }
      if (point) {
        const tPin = motion ? Math.min(1, (now - pinStart.current) / 700) : 1
        const ease = 1 - Math.pow(1 - tPin, 3)
        const map = mapRef.current
        const zoom = map?.getZoom() ?? 8
        const mpp = (156543.03 * Math.cos((point.latitude * Math.PI) / 180)) / Math.pow(2, zoom)
        const pulse = motion ? ((now - pinStart.current) % 1600) / 1600 : 0.6
        if (broadcast3d) {
          // a standing 3D pin only when the camera is tilted; seen from
          // straight above, perspective would draw it as a sideways capsule
          out.push(
            new ColumnLayer({
            id: 'pin',
            data: [point],
            getPosition: (d: PointState) => [d.longitude, d.latitude],
            radius: 5 * mpp,
            getElevation: 70 * mpp * ease,
            extruded: true,
            diskResolution: 16,
            getFillColor: rgba(colors.gold, 255),
            updateTriggers: { getElevation: now },
          })
          )
        }
        out.push(
          new ScatterplotLayer({
            id: 'pin-ring',
            data: [point],
            getPosition: (d: PointState) => [d.longitude, d.latitude],
            getRadius: 6 + 26 * pulse,
            radiusUnits: 'pixels',
            stroked: true,
            filled: false,
            lineWidthUnits: 'pixels',
            getLineWidth: 2,
            getLineColor: rgba(colors.gold, Math.round(255 * (1 - pulse))),
            updateTriggers: { getRadius: now, getLineColor: now },
          }),
          new ScatterplotLayer({
            id: 'pin-base',
            data: [point],
            getPosition: (d: PointState) => [d.longitude, d.latitude],
            getRadius: 5,
            radiusUnits: 'pixels',
            getFillColor: rgba(colors.gold, 255),
          })
        )
      }
      return out
    },
    [point, motion, colors, broadcast3d, softParticles]
  )

  // Frame loop: particles, the pin animation and the broadcast flyover.
  useEffect(() => {
    const overlay = overlayRef.current
    const map = mapRef.current
    if (!overlay || !map) return
    let raf = 0
    let flying = broadcast3d
    const stop = () => {
      flying = false
    }
    map.on('mousedown', stop)
    map.on('touchstart', stop)
    map.on('wheel', stop)
    const animate = motion && (fieldRef.current != null || point != null || broadcast3d)
    // Set by the cleanup (broadcast exit, layer change, unmount): a frame that
    // is already queued does nothing, and nothing is queued after it.
    let stopped = false
    const frame = (now: number) => {
      if (stopped || mapRef.current !== map) return
      try {
        const f = fieldRef.current
        if (f) {
          const b = map.getBounds()
          f.spawnBox = { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() }
          // ~0.4 % of the view width per frame at the fastest wind in view
          const degPerKmh = ((b.getEast() - b.getWest()) * 0.004) / Math.max(10, f.maxSpeed)
          step(f, degPerKmh)
        }
        // after the tilt has finished: setBearing would cancel the ease
        if (flying && !map.isMoving()) map.setBearing(map.getBearing() + 0.05, { flyover: true })
        overlay.setProps({ layers: [...staticLayers, ...dynamicLayers(now)] })
      } catch (err) {
        // never spin on an error: report it once and stop this loop
        stopped = true
        console.error('[map] frame loop stopped:', err)
        return
      }
      if (animate && !stopped) raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      stopped = true
      flying = false
      cancelAnimationFrame(raf)
      map.off('mousedown', stop)
      map.off('touchstart', stop)
      map.off('wheel', stop)
    }
  }, [staticLayers, dynamicLayers, motion, point, broadcast3d, particlesOn, mapReady])

  // ------------------------------------------------------------------ UI ---
  const timeLabel = useMemo(() => {
    const iso = grid?.times[hourShown]
    if (!iso) return ''
    const z = zonedClock(iso, 0, tz)
    return z ? formatLocalTime(z.full.replace(' ', 'T'), language) : ''
  }, [grid, hourShown, tz, language])

  // in route mode the report states the grid and the sample spacing; the
  // (hidden) weather grid's point spacing would only mislead next to a route
  const resolution = routeOn
    ? routeReport
      ? null
      : grid
        ? fill(t('map.resolutionShort'), { km: grid.model_grid_km })
        : null
    : hazard
    ? fill(t('map.hazard.resolution'), { km: hazard.model_grid_km, hex: hazard.hex_km, res: hazard.h3_resolution })
    : grid
    ? fill(t('map.resolution'), { km: grid.model_grid_km, spacing: grid.spacing_km })
    : point?.status === 'ready'
      ? fill(t('map.resolutionShort'), { km: point.data.model_grid_km })
      : null

  const toggleBroadcast = () => {
    const next = !broadcast
    setBroadcast(next)
    setPlaying(next && motion)
  }

  const { picking: routePicking, setPicking: setRoutePicking, setFrom: setRouteFrom, setTo: setRouteTo, clear: clearRoute } = rt
  const handleTap = useCallback(
    (x: number, y: number, lat: number, lon: number) => {
      if (routeOn && routePicking) {
        // "Pick on map": this tap sets the start or the destination
        const end = { latitude: lat, longitude: lon, name: fill(t('route.mapPoint'), { lat: lat.toFixed(3), lon: lon.toFixed(3) }) }
        if (routePicking === 'from') setRouteFrom(end)
        else setRouteTo(end)
        setRoutePicking(null)
        clearRoute()
        return
      }
      if (hazardOn && overlayRef.current) {
        const info = overlayRef.current.pickObject({ x, y, radius: 2, layerIds: ['hazard-hex'] })
        const d = info?.object as { cell: string; point: number } | undefined
        if (d) {
          setHexPick({ cell: d.cell, point: d.point })
          setPoint(null)
          return
        }
      }
      setHexPick(null)
      showPoint(lat, lon)
    },
    [hazardOn, showPoint, routeOn, routePicking, setRouteFrom, setRouteTo, setRoutePicking, clearRoute, t]
  )
  useEffect(() => {
    clickRef.current = handleTap
  }, [handleTap])

  const centre = () => {
    const map = mapRef.current
    const c = map?.getCenter()
    if (!map || !c) return
    const px = map.project(c)
    handleTap(px.x, px.y, c.lat, c.lng)
  }

  const showWorst = (lat: number, lon: number, h: number) => {
    setPlaying(false)
    setHour(h)
    setHexPick(null)
    const map = mapRef.current
    if (map) flyToSteady(map, { center: [lon, lat], zoom: Math.max(map.getZoom(), 9), animate: motion })
  }

  const layerButtons = (
    <div role="group" aria-label={t('map.layer.label')} className="flex flex-wrap gap-1.5">
      {MODES.map((id) => (
        <button
          key={id}
          type="button"
          data-testid={`map-layer-${id}`}
          aria-pressed={layer === id}
          onClick={() => {
            setLayer(id)
            setHexPick(null)
            // the picked place is a natural start
            if (id === 'route' && !rt.from && place) rt.setFrom(place)
            if (id !== 'route') rt.setPicking(null)
          }}
          className={cn(
            'rounded-full border px-3 py-1.5 text-xs transition-colors',
            layer === id ? 'border-accent bg-accent/15 text-hud' : 'border-white/10 bg-white/[0.04] text-hud-dim hover:text-hud'
          )}
        >
          {t(`map.layer.${id}` as TranslationKey)}
        </button>
      ))}
    </div>
  )

  const slider = grid && (
    <div className="flex items-center gap-3">
      <SkyButton
        variant="ghost"
        className="h-9 w-9 shrink-0 justify-center p-0"
        onClick={() => setPlaying((p) => !p)}
        aria-label={playing ? t('map.time.pause') : t('map.time.play')}
        data-testid="map-play"
      >
        {playing ? <Pause className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
      </SkyButton>
      <div className="min-w-0 flex-1">
        <label htmlFor="map-hour" className="flex justify-between gap-2 text-xs text-hud-dim">
          <span>{t('map.time.label')}</span>
          <span className="font-readout text-hud" data-testid="map-time-label">
            {timeLabel}
          </span>
        </label>
        <input
          id="map-hour"
          type="range"
          min={0}
          max={maxHour}
          value={hourShown}
          onChange={(e) => {
            setPlaying(false)
            setHour(Number(e.target.value))
          }}
          aria-valuetext={timeLabel}
          data-testid="map-time-slider"
          className="w-full accent-[var(--sky-accent)]"
        />
      </div>
    </div>
  )

  const status = hazardOn
    ? hz.status === 'loading' && !hz.hazard
      ? t('map.hazard.loading')
      : hz.status === 'error'
        ? t('map.hazard.error')
        : hz.status === 'too-large'
          ? t('map.zoomIn')
          : null
    : gridStatus === 'loading' && !grid
      ? t('map.loading')
      : gridStatus === 'error'
        ? t('map.gridError')
        : gridStatus === 'too-large'
          ? t('map.zoomIn')
          : null

  const placeShort = place?.name.split(',')[0]

  const legend = (big: boolean) =>
    routeOn ? null : hazardOn ? (
      hazard ? <HazardLegend hazard={hazard} roadsShown={hz.roads.length > 0} tz={tz} big={big} /> : null
    ) : grid && surface ? (
      <MapLegend grid={grid} layer={surface} hour={hourShown} fixed={playing} timeLabel={timeLabel} big={big} />
    ) : null

  const hazardCard = (className?: string) =>
    hazard && pickedHex ? (
      <HazardCard hazard={hazard} pick={pickedHex} type={hazardType} tz={tz} onClose={() => setHexPick(null)} className={className} />
    ) : null

  if (mapError) {
    return (
      <div className="flex h-full min-h-[200px] items-center justify-center p-6 text-center text-sm text-hud-dim" role="note">
        {t('map.webgl')}
      </div>
    )
  }

  const broadcastView = broadcast
    ? createPortal(
        <div
          className="map-broadcast fixed inset-0 z-[200] bg-[var(--sky-floor)]"
          data-testid="map-broadcast-root"
          role="dialog"
          aria-modal="true"
          aria-label={t('map.broadcast.kicker')}
        >
          <div ref={setSlot} className="absolute inset-0 z-0" />
          <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-wrap items-start justify-between gap-2">
            <div className="sky-glass map-overlay pointer-events-auto space-y-2 px-3 py-2">
              {layerButtons}
              {hazardOn && <HazardTypeChips type={hazardType} onChange={setHazardType} />}
            </div>
            <SkyButton variant="primary" onClick={toggleBroadcast} data-testid="map-broadcast-exit" className="pointer-events-auto">
              <X className="h-4 w-4" aria-hidden /> {t('map.broadcast.exit')}
            </SkyButton>
          </div>
          {legend(true) && <div className="sky-glass map-overlay absolute right-3 top-20 hidden w-72 p-4 sm:block">{legend(true)}</div>}
          {!mobile && hazardCard('absolute left-3 top-20 max-h-[45%] w-72 overflow-y-auto')}
          {point && !mobile && (
            <MapPointCard point={point} onClose={() => setPoint(null)} className="absolute left-3 top-20 max-h-[45%] w-72 overflow-y-auto" />
          )}
          {/* news-style lower third */}
          <div className="absolute inset-x-3 bottom-9 sm:inset-x-6 sm:bottom-10">
            <div className="sky-glass map-overlay overflow-hidden p-0">
              <div className="flex flex-wrap items-stretch">
                <div className="flex items-center bg-accent px-4 py-2 font-hud text-xs uppercase tracking-[0.2em] text-[var(--sky-floor)] sm:text-sm">
                  {t('map.broadcast.kicker')}
                </div>
                <p className="min-w-0 flex-1 px-4 py-2 font-hud text-xl text-hud sm:text-3xl" data-testid="map-broadcast-title">
                  {placeShort ? `${placeShort} · ` : ''}
                  {t(`map.layer.${layer}` as TranslationKey)}
                </p>
              </div>
              {legend(false) && <div className="border-t border-white/10 px-4 py-2 sm:hidden">{legend(false)}</div>}
              <div className="border-t border-white/10 px-4 py-2">{slider}</div>
              <p className="border-t border-white/10 px-4 py-1.5 text-[11px] text-hud-dim" data-testid="map-resolution">
                {resolution}
                {!broadcast3d && ` · ${t('map.broadcast.flat')}`}
              </p>
            </div>
          </div>
        </div>,
        document.body
      )
    : null

  return (
    <div
      ref={rootRef}
      data-testid="weather-map"
      data-broadcast={broadcast ? (broadcast3d ? '3d' : '2d') : 'off'}
      data-particles={particlesOn && grid ? particleCount(window.innerWidth, mobile, softParticles) : 0}
      data-particle-style={particlesOn && grid ? (softParticles ? 'soft' : 'normal') : undefined}
      data-layer={layer}
      data-grid-requests={gridRequests}
      data-pitch={pitch}
      data-terrain={terrainOn ? 'on' : 'off'}
      data-basemap={basemap}
      data-hazard-type={hazardOn ? hazardType : undefined}
      data-hazard-cells={hazard ? hazard.cells.length : 0}
      data-road-pieces={hz.roads.length}
      data-route-segments={routeReport ? routeReport.segments.length : 0}
      data-route-worst={routeReport ? routeReport.worst : undefined}
      data-route-picking={routeOn && rt.picking ? rt.picking : undefined}
      data-center={viewCentre ? `${viewCentre.latitude.toFixed(3)},${viewCentre.longitude.toFixed(3)}` : undefined}
      className="flex h-full flex-col gap-3"
    >
      {broadcastView}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {layerButtons}
        <div className="flex flex-wrap gap-1.5">
          <SkyButton variant="subtle" onClick={centre} data-testid="map-centre">
            <Crosshair className="h-4 w-4" aria-hidden /> {t('map.centre')}
          </SkyButton>
          <SkyButton variant="primary" onClick={toggleBroadcast} data-testid="map-broadcast">
            <Tv className="h-4 w-4" aria-hidden /> {t('map.broadcast')}
          </SkyButton>
        </div>
      </div>

      {hazardOn && <HazardTypeChips type={hazardType} onChange={setHazardType} />}
      {routeOn && !broadcast && <RoutePlanner r={rt} />}

      <div className="relative min-h-[380px] flex-1 overflow-hidden rounded-xl sm:min-h-[460px] lg:min-h-[580px]">
        {!broadcast && <div ref={setSlot} className="absolute inset-0 z-0" />}

        {place && (
          <div className="sky-glass map-overlay pointer-events-none absolute left-2 top-2 max-w-[60%] px-3 py-2 text-xs" data-testid="map-location-card">
            <p className="truncate font-semibold text-hud" title={place.name}>
              {placeShort}
            </p>
            {conditionLabel && (
              <p className="text-hud" data-testid="weather-description">
                {conditionLabel}
              </p>
            )}
            {statusText && <p className={statusTone === 'warning' ? 'text-sev-warning-text' : 'text-sev-none-text'}>{statusText}</p>}
          </div>
        )}

        {status && (
          <p className="sky-glass map-overlay absolute bottom-2 left-2 max-w-[80%] px-3 py-1.5 text-xs text-hud" role="status">
            {status}
          </p>
        )}

        {/* tapped point: overlay on wider screens */}
        {point && !mobile && !broadcast && (
          <MapPointCard point={point} onClose={() => setPoint(null)} className="absolute right-2 top-2 max-h-[calc(100%-7.5rem)] w-72 overflow-y-auto" />
        )}
        {!mobile && !broadcast && hazardCard('absolute right-2 top-2 max-h-[calc(100%-7.5rem)] w-72 overflow-y-auto')}
      </div>

      {point && mobile && !broadcast && <MapPointCard point={point} onClose={() => setPoint(null)} />}
      {mobile && !broadcast && hazardCard()}

      {routeOn ? (
        routeReport && !broadcast && <RouteReportPanel report={routeReport} tz={tz} onDepart={rt.departAt} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,18rem)]">
          <div className="min-w-0 space-y-2">
            {!broadcast && slider}
            <p className="text-xs text-hud-dim">{t('map.tapHint')}</p>
          </div>
          {!broadcast && legend(false) && <div className="min-w-0">{legend(false)}</div>}
        </div>
      )}
      {hazardOn && hz.summary && !broadcast && (
        <HazardSummaryPanel summary={hz.summary} placeName={placeShort ?? null} tz={tz} onShowWorst={showWorst} />
      )}
      {resolution && !broadcast && (
        <p className="text-[11px] text-hud-dim" data-testid="map-resolution">
          {resolution}
        </p>
      )}
    </div>
  )
}

/**
 * flyTo that still ends on its target when the container resizes during the
 * flight (the page grows when a place is picked). MapLibre eases in pixels, so
 * a mid-flight resize shifts the end point. When the flight ends off target,
 * ease the rest of the way (at most twice). Stops as soon as the user moves
 * the map or the camera is on target, so it never fights a later tilt or pan.
 * Returns a cleanup function.
 */
function flyToSteady(map: MapLibreMap, opts: FlyToOptions): () => void {
  const [lng, lat] = opts.center as [number, number]
  let tries = 0
  const off = () => {
    map.off('moveend', check)
    map.off('movestart', userMove)
  }
  const userMove = (e: { originalEvent?: unknown }) => {
    if (e.originalEvent) off()
  }
  function check() {
    if (map.isMoving()) return
    const c = map.getCenter()
    if ((Math.abs(c.lng - lng) < 1e-4 && Math.abs(c.lat - lat) < 1e-4) || ++tries > 2) {
      off()
      return
    }
    map.easeTo({ center: [lng, lat], zoom: opts.zoom, duration: opts.animate === false ? 0 : 400 })
  }
  map.on('moveend', check)
  map.on('movestart', userMove)
  map.flyTo(opts)
  const id = window.setTimeout(off, 10_000)
  return () => {
    window.clearTimeout(id)
    off()
  }
}

