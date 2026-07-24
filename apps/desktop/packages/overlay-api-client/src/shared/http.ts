import { validateApiClientBoundary } from '../schemas/api-boundary'
import { isPaginatedEnvelope } from './pagination'
import type { MutationRequestInit } from './mutation'
import { createIdempotencyKey, toRequestInit } from './mutation'
import type { CreateOverlayAppClientOptions, QueryParams } from './types'

export function appendQuery(path: string, query?: QueryParams): string {
  if (!query) return path
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue
    params.set(key, String(value))
  }
  const search = params.toString()
  return search ? `${path}?${search}` : path
}

export function toUrl(baseUrl: string | undefined, path: string): string {
  if (!baseUrl) return path
  return new URL(path, baseUrl).toString()
}

export function jsonRequest(body: unknown, init: MutationRequestInit = {}): RequestInit {
  const resolved = toRequestInit(init)
  const headers = new Headers(resolved.headers)
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  return {
    ...resolved,
    headers,
    body: JSON.stringify(body),
  }
}

function bodyForBoundaryValidation(body: BodyInit | null | undefined): unknown {
  if (typeof body !== 'string') return undefined
  if (!body.trim()) return {}
  try {
    return JSON.parse(body)
  } catch {
    return body
  }
}

async function mergeHeaders(
  getAuthHeaders: CreateOverlayAppClientOptions['getAuthHeaders'],
  initHeaders: HeadersInit | undefined,
): Promise<Headers> {
  const headers = new Headers()
  const authHeaders = await getAuthHeaders?.()
  new Headers(authHeaders).forEach((value, key) => headers.set(key, value))
  new Headers(initHeaders).forEach((value, key) => headers.set(key, value))
  return headers
}

export async function parseJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T
}

export async function parseJsonData<T>(response: Response): Promise<T> {
  const value = await response.json()
  return (isPaginatedEnvelope(value) ? value.data : value) as T
}

export interface HttpContext {
  request(path: string, init?: RequestInit): Promise<Response>
  json<T>(path: string, init?: RequestInit): Promise<T>
  jsonData<T>(path: string, init?: RequestInit): Promise<T>
  appendQuery: typeof appendQuery
  jsonRequest: (body: unknown, init?: MutationRequestInit) => RequestInit
  parseJson: typeof parseJson
  parseJsonData: typeof parseJsonData
}

export function createHttpContext(options: CreateOverlayAppClientOptions): HttpContext {
  const fetchImpl = options.fetch ?? globalThis.fetch?.bind(globalThis)
  if (!fetchImpl) {
    throw new Error('createOverlayAppClient requires a fetch implementation')
  }

  async function request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = await mergeHeaders(options.getAuthHeaders, init.headers)
    const method = (init.method ?? 'GET').toUpperCase()
    if (
      (method === 'POST' || method === 'PATCH' || method === 'DELETE') &&
      !headers.has('Idempotency-Key')
    ) {
      headers.set('Idempotency-Key', createIdempotencyKey())
    }
    const requestInit: RequestInit = {
      ...init,
      headers,
    }
    if (requestInit.credentials === undefined) {
      requestInit.credentials = 'same-origin'
    }
    validateApiClientBoundary({
      body: bodyForBoundaryValidation(requestInit.body),
      method: requestInit.method,
      path,
    })
    return fetchImpl(toUrl(options.baseUrl, path), requestInit)
  }

  async function json<T>(path: string, init?: RequestInit): Promise<T> {
    return parseJson<T>(await request(path, init))
  }

  async function jsonData<T>(path: string, init?: RequestInit): Promise<T> {
    return parseJsonData<T>(await request(path, init))
  }

  return {
    request,
    json,
    jsonData,
    appendQuery,
    jsonRequest,
    parseJson,
    parseJsonData,
  }
}
