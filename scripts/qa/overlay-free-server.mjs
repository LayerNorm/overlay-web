import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { OverlayFreeRouter } from './overlay-free-router.mjs'

const port = Number(process.env.PORT ?? 4317)
const token = randomBytes(32).toString('hex')
const page = fileURLToPath(new URL('../../internal/plans/mockups/overlay-free.html', import.meta.url))
const router = new OverlayFreeRouter({ gatewayKey: process.env.AI_GATEWAY_API_KEY,
  openRouterKey: process.env.OPENROUTER_API_KEY,
  statePath: fileURLToPath(new URL('../../artifacts/overlay-free/quarantine.json', import.meta.url)) })
await router.init()
let busy = false
let refreshing = false

async function refresh() {
  if (busy || refreshing) return
  refreshing = true
  try { await router.refresh() } finally { refreshing = false }
}

function send(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  response.end(JSON.stringify(body))
}

function authorized(request) {
  const given = request.headers['x-prototype-token']
  return typeof given === 'string' && given.length === token.length && timingSafeEqual(Buffer.from(given), Buffer.from(token))
}

async function body(request) {
  let text = ''
  for await (const chunk of request) {
    text += chunk
    if (Buffer.byteLength(text) > 24000) throw new Error('Request is too large')
  }
  return JSON.parse(text)
}

createServer(async (request, response) => {
  try {
    const path = new URL(request.url, 'http://localhost').pathname
    if (request.method === 'GET' && path === '/') {
      const html = (await readFile(page, 'utf8')).replace('__PROTOTYPE_TOKEN__', token)
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'" })
      return response.end(html)
    }
    if (path === '/favicon.ico') { response.writeHead(204); return response.end() }
    if (!authorized(request)) return send(response, 403, { error: 'Open the prototype page to use this local API.' })
    if (request.method === 'GET' && path === '/api/status') return send(response, 200, { ...router.status(), refreshing, busy })
    if (request.method === 'POST' && path === '/api/refresh') {
      if (busy || refreshing) return send(response, 409, { error: 'A request or check is already running.' })
      void refresh()
      return send(response, 202, { ok: true })
    }
    if (request.method === 'POST' && path === '/v1/chat/completions') {
      if (busy || refreshing) return send(response, 409, { error: 'Please wait for the current check or request.' })
      const input = await body(request)
      if (busy || refreshing) return send(response, 409, { error: 'Please wait for the current check or request.' })
      if (input.model !== 'overlay-free' || !Array.isArray(input.messages) || !input.messages.length || input.messages.length > 30 ||
        !input.messages.every(message => ['user', 'assistant', 'system'].includes(message.role) && typeof message.content === 'string' && message.content.length <= 12000)) {
        return send(response, 400, { error: 'Expected model overlay-free and up to 30 text messages.' })
      }
      if (input.stream === true) return send(response, 400, { error: 'This prototype buffers responses to verify cost. Streaming is not implemented.' })
      busy = true
      try {
        const result = await router.generate(input.messages, { fallbackOnly: input.fallbackOnly === true })
        return send(response, result.error ? 503 : 200, result)
      } finally { busy = false }
    }
    return send(response, 404, { error: 'Not found' })
  } catch {
    return send(response, 400, { error: 'Invalid request or unavailable prototype state.' })
  }
}).listen(port, '0.0.0.0', () => {
  console.log(`Overlay Free prototype listening on port ${port}. Keys stay server-side.`)
  void refresh()
})

setInterval(() => { void refresh() }, 60 * 60 * 1000).unref()
