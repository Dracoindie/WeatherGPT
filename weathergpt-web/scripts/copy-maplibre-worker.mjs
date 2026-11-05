/**
 * MapLibre GL's tile worker as a separate file: v5's CSP worker build
 * (dist/maplibre-gl-csp-worker.js, a classic script) is copied to
 * public/vendor/ (git-ignored) before `dev` and `build`, and the map points
 * setWorkerUrl() at it (components/map3d/WeatherMap.tsx). A real file, not the
 * bundle's inline blob, so the service worker can cache it for the offline map.
 *
 * Why v5 and not v6: deck.gl 9.4's MapboxOverlay reads map.transform.elevation
 * when the map has terrain; MapLibre 6 has no map.transform, so 3D terrain threw
 * on every frame. deck.gl documents MapLibre support up to v5.
 */

import { copyFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const pkgDir = path.dirname(require.resolve('maplibre-gl/package.json'))
const out = path.join(process.cwd(), 'public', 'vendor')
mkdirSync(out, { recursive: true })
copyFileSync(path.join(pkgDir, 'dist', 'maplibre-gl-csp-worker.js'), path.join(out, 'maplibre-gl-worker.js'))
console.log('copied maplibre-gl-csp-worker.js to public/vendor/maplibre-gl-worker.js')
