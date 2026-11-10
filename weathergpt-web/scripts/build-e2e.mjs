/**
 * `npm run build:e2e`: the same `next build`, with the test-only addresses
 * from e2e-env.mjs, into `.next-e2e`. Playwright serves that folder
 * (playwright.config.ts), so tests never carry the Supabase URL from
 * `.env.local`.
 */

import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { E2E_BUILD_ENV } from './e2e-env.mjs'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const run = (args) => {
  const r = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...E2E_BUILD_ENV } })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

run([path.join('scripts', 'copy-maplibre-worker.mjs')]) // what `prebuild` does for `npm run build`
run([path.join('node_modules', 'next', 'dist', 'bin', 'next'), 'build'])
