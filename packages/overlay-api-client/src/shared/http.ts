import { validateApiClientBoundary } from '../../../../src/shared/schemas/api-boundary'
import { isPaginatedEnvelope } from '../../../../src/shared/api/pagination'
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
  const value = await response.json().catch(() => null) as unknown
  if (!response.ok) {
    const detail = value && typeof value === 'object'
      ? ('error' in value && typeof value.error === 'string'
          ? value.error
          : 'message' in value && typeof value.message === 'string'
            ? value.message
            : null)
      : null
    if (response.status === 429) {
      const retryAfterSeconds = retryAfterSecondsFromResponse(response, value)
      const retryGuidance = retryAfterSeconds === null
        ? 'Please wait a moment, then try again.'
        : `Try again in ${formatRetryDelay(retryAfterSeconds)}.`
      throw new Error(
        `${detail ?? 'Too many requests'}. This account has reached its temporary request limit. ${retryGuidance}`,
      )
    }
    throw new Error(detail ?? `Request failed (${response.status})`)
  }
  return value as T
}

function retryAfterSecondsFromResponse(response: Response, value: unknown): number | null {
  const bodySeconds = value && typeof value === 'object' && 'retryAfterSeconds' in value
    ? Number(value.retryAfterSeconds)
    : Number.NaN
  if (Number.isFinite(bodySeconds) && bodySeconds >= 0) return Math.ceil(bodySeconds)

  const headerSeconds = Number(response.headers.get('Retry-After'))
  return Number.isFinite(headerSeconds) && headerSeconds >= 0 ? Math.ceil(headerSeconds) : null
}

function formatRetryDelay(totalSeconds: number): string {
  if (totalSeconds < 60) {
    const seconds = Math.max(1, totalSeconds)
    return `${seconds} second${seconds === 1 ? '' : 's'}`
  }
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  const minuteLabel = `${minutes} minute${minutes === 1 ? '' : 's'}`
  if (seconds === 0) return minuteLabel
  return `${minuteLabel} ${seconds} second${seconds === 1 ? '' : 's'}`
}

export async function parseJsonData<T>(response: Response): Promise<T> {
  const value = await parseJson<unknown>(response)
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
