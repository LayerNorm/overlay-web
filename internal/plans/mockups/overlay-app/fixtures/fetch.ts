/** In-page fake of the web app's own HTTP routes. Unknown routes answer 404 and are listed in window.__mockupMissing. */
import { missing } from './convex'

type Handler = (request: { method: string; path: string; search: URLSearchParams; body: unknown }) => unknown
const routes: Array<{ method: string; pattern: RegExp; handler: Handler }> = []

export function route(method: string, pattern: RegExp, handler: Handler) {
  routes.push({ method, pattern, handler })
}

export function installFakeFetch() {
  const realFetch = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, globalThis.location.origin.startsWith('http') ? globalThis.location.origin : 'https://mockup.overlay')
    if (url.protocol === 'data:' || url.protocol === 'blob:') return realFetch(input, init)
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    let body: unknown = undefined
    if (typeof init?.body === 'string') {
      try { body = JSON.parse(init.body) } catch { body = init.body }
    }
    const match = routes.find((entry) => (entry.method === method || entry.method === '*') && entry.pattern.test(url.pathname))
    if (!match) {
      if (!missing.has('fetch ' + method + ' ' + url.pathname)) {
        missing.add('fetch ' + method + ' ' + url.pathname)
        console.warn('[mockup] no fixture for', method, url.pathname + url.search)
      }
      return new Response(JSON.stringify({ error: 'Not available in the mockup' }), { status: 404, headers: { 'Content-Type': 'application/json' } })
    }
    const result = await match.handler({ method, path: url.pathname, search: url.searchParams, body })
    if (result instanceof Response) return result
    return new Response(JSON.stringify(result ?? {}), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
}
