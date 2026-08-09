import 'server-only'

import { validatePublicNetworkUrl } from './ssrf'

/**
 * OAuth metadata is authored by the remote MCP server: it names its own authorization, token,
 * registration, and revocation endpoints. Fetching those URLs unguarded would let any server we
 * connect to aim our server-side HTTP client at link-local or private infrastructure
 * (169.254.169.254, 10.0.0.0/8, localhost), so every request and every redirect hop is revalidated
 * here before it leaves the process.
 *
 * Redirects are followed manually — `redirect: 'follow'` would let a public URL bounce to a private
 * one without us ever seeing the intermediate address.
 */

export const MAX_GUARDED_RESPONSE_BYTES = 1_000_000
const MAX_REDIRECTS = 5
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

export class GuardedFetchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GuardedFetchError'
  }
}

export interface GuardedFetchOptions {
  /** Allow http://localhost during local development, matching the MCP URL validator. */
  allowLocalDev?: boolean
  maxResponseBytes?: number
  timeoutMs?: number
}

async function assertSafeUrl(url: string | URL, options: GuardedFetchOptions): Promise<URL> {
  const result = await validatePublicNetworkUrl(String(url), {
    allowLocalDev: options.allowLocalDev ?? true,
    requireHttps: true,
  })
  if (!result.ok) throw new GuardedFetchError(`Blocked request to ${redactUrl(url)}: ${result.error}`)
  return result.url
}

/** Query strings can carry codes and tokens, so error messages only ever name origin + path. */
function redactUrl(url: string | URL): string {
  try {
    const parsed = new URL(String(url))
    return `${parsed.origin}${parsed.pathname}`
  } catch (_error) {
    return 'the requested URL'
  }
}

/**
 * A `fetch`-compatible function that refuses to touch private address space and caps how much of a
 * response it will buffer. Pass it to the MCP SDK's `fetchFn` so discovery, dynamic client
 * registration, token exchange, and refresh all inherit the same guard.
 */
export function createGuardedFetch(options: GuardedFetchOptions = {}) {
  const maxBytes = options.maxResponseBytes ?? MAX_GUARDED_RESPONSE_BYTES

  return async function guardedFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    let target = await assertSafeUrl(input instanceof Request ? input.url : input, options)
    let request: RequestInit = input instanceof Request
      ? { body: input.body, headers: input.headers, method: input.method, ...init }
      : { ...init }

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const controller = new AbortController()
      const timeout = options.timeoutMs
        ? setTimeout(() => controller.abort(), options.timeoutMs)
        : undefined
      let response: Response
      try {
        response = await fetch(target, {
          ...request,
          redirect: 'manual',
          signal: request.signal ?? controller.signal,
        })
      } finally {
        if (timeout) clearTimeout(timeout)
      }

      if (!REDIRECT_STATUSES.has(response.status)) return capResponse(response, maxBytes)

      const location = response.headers.get('location')
      if (!location) return capResponse(response, maxBytes)
      if (hop === MAX_REDIRECTS) {
        throw new GuardedFetchError(`Too many redirects from ${redactUrl(target)}`)
      }

      const next = await assertSafeUrl(new URL(location, target), options)
      // 303, and 301/302 on POST, degrade to a bodyless GET per fetch semantics.
      if (response.status === 303 || (request.method === 'POST' && response.status !== 307 && response.status !== 308)) {
        request = { ...request, body: undefined, method: 'GET' }
      }
      target = next
    }

    throw new GuardedFetchError('Redirect handling failed')
  }
}

/**
 * Buffers at most `maxBytes` so a hostile token endpoint cannot exhaust memory with an unbounded
 * body. Returns a new Response carrying the original status and headers.
 */
async function capResponse(response: Response, maxBytes: number): Promise<Response> {
  const declared = Number(response.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new GuardedFetchError(`Response exceeded ${maxBytes} bytes`)
  }
  if (!response.body) return response

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch((_error) => undefined)
        throw new GuardedFetchError(`Response exceeded ${maxBytes} bytes`)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new Response(body, {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  })
}
