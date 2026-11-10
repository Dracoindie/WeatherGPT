/**
 * Mock Supabase for Playwright, on 127.0.0.1 only (scripts/e2e-env.mjs).
 *
 * The browser's Supabase calls are answered per test by page.route
 * (e2e/support/mockApi.ts). This server is for what Playwright cannot
 * intercept: the Next.js proxy checking the session cookie on the server. It
 * knows no user, so every request gets 401, as a real project answers a
 * token it did not issue. GET /__e2e/requests lists what arrived, so a test
 * can prove the server-side check came here.
 */

import http from 'node:http'
import { E2E_SUPABASE_PORT } from './e2e-env.mjs'

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
}
const seen = []

const send = (res, status, body) => {
  res.writeHead(status, { ...CORS, 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

http
  .createServer((req, res) => {
    const { pathname } = new URL(req.url ?? '/', 'http://127.0.0.1')
    req.resume()
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS)
      return res.end()
    }
    if (pathname === '/__e2e/health') return send(res, 200, { ok: true })
    if (pathname === '/__e2e/requests') return send(res, 200, seen)
    seen.push({ method: req.method, path: pathname, authorization: req.headers.authorization ?? null })
    if (seen.length > 2000) seen.shift()
    send(res, 401, { code: 401, error_code: 'bad_jwt', msg: 'mock Supabase: no such user' })
  })
  .listen(E2E_SUPABASE_PORT, '127.0.0.1')
