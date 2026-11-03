/**
 * MapLibre GL v6 loads its tile worker from a separate ES module next to the
 * main bundle. Next.js does not emit that file, so it is copied to
 * public/vendor/ (git-ignored) before `dev` and `build`; the map points
 * setWorkerUrl() at it (components/map3d/WeatherMap.tsx).
 */

import { copyFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const pkgDir = path.dirname(require.resolve('maplibre-gl/package.json'))
const out = path.join(process.cwd(), 'public', 'vendor')
mkdirSync(out, { recursive: true })
copyFileSync(path.join(pkgDir, 'dist', 'maplibre-gl-worker.mjs'), path.join(out, 'maplibre-gl-worker.mjs'))
console.log('copied maplibre-gl-worker.mjs to public/vendor/')
