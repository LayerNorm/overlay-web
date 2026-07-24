import { createOverlayAppClient } from '@overlay/api-client'

export type DesktopApiErrorCode = 'unauthenticated' | 'not_found' | 'network' | 'server'

interface AppApiRequestResult {
  ok: boolean
  status: number
  statusText: string
  bodyText: string
  bodyBase64?: string
  headers?: Record<string, string>
}

interface AppApiBridge {
  request(input: {
    path: string
    method?: string
    headers?: Record<string, string>
    body?: string | null
  }): Promise<AppApiRequestResult>
  stream(
    input: {
      path: string
      method?: string
      headers?: Record<string, string>
      body?: string | null
      streamId: string
    },
    cb: (event: {
      type: 'ready' | 'chunk' | 'done' | 'error'
      status?: number
      statusText?: string
      headers?: Record<string, string>
      chunk?: string
      error?: string
    }) => void
  ): Promise<AppApiRequestResult>
  abort(streamId: string): Promise<{ aborted: boolean }>
}

const STREAM_APP_API_ROUTES = new Set([
  'POST /api/v1/conversations/act',
  'POST /api/v1/generate-video'
])
const FORBIDDEN_FORWARD_HEADERS = new Set([
  'authorization',
  'cookie',
  'host',
  'x-overlay-service-auth',
  'x-forwarded-for',
  'x-real-ip',
  'x-vercel-forwarded-for',
  'cf-connecting-ip',
  'content-length',
  'transfer-encoding',
  'connection',
  'keep-alive',
  'upgrade',
  'trailer',
  'te',
  'origin',
  'referer'
])

export class DesktopApiError extends Error {
  code: DesktopApiErrorCode
  status?: number

  constructor(message: string, code: DesktopApiErrorCode, status?: number) {
    super(message)
    this.name = 'DesktopApiError'
    this.code = code
    this.status = status
  }
}

export const overlayDesktopAppClient = createOverlayAppClient({
  fetch: desktopAppApiFetch
})

export async function desktopAppResponse(path: string, init: RequestInit = {}): Promise<Response> {
  const response = await overlayDesktopAppClient.request(path, init)
  if (!response.ok) {
    throw await errorFromResponse(response)
  }
  return response
}

export async function desktopAppJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await desktopAppResponse(path, init)
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export async function desktopAppJsonRequest<T>(
  path: string,
  body: unknown,
  init: Omit<RequestInit, 'body'> = {}
): Promise<T> {
  return desktopAppJson<T>(path, {
    ...init,
    method: init.method ?? 'POST',
    body: JSON.stringify(body)
  })
}

interface PaginatedEnvelope<T> {
  data: T[]
  nextCursor?: string
  hasMore: boolean
  total?: number
}

export function unwrapPaginatedData<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[]
  const envelope = value as PaginatedEnvelope<T> | undefined
  if (envelope && Array.isArray(envelope.data)) return envelope.data
  return []
}

export async function desktopAppStreamText(
  path: string,
  init: RequestInit = {},
  onChunk: (chunk: string) => boolean | void
): Promise<void> {
  const requestPath = normalizeBridgePath(path)
  assertStreamRequest(requestPath, init.method)
  const response = await desktopAppApiFetch(requestPath, init)
  if (!response.ok) throw await errorFromResponse(response)
  const reader = response.body?.getReader()
  if (!reader) return
  const decoder = new TextDecoder()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const chunk = decoder.decode(value, { stream: true })
    if (chunk && onChunk(chunk) === false) {
      await reader.cancel()
      return
    }
  }
  const finalChunk = decoder.decode()
  if (finalChunk) onChunk(finalChunk)
}

async function desktopAppApiFetch(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  const path = requestPathFromInput(input)
  const requestHeaders = withMutationIdempotencyHeader(init.method, init.headers)
  init = { ...init, headers: requestHeaders }
  if (init.body && typeof init.body !== 'string') {
    throw new DesktopApiError('Unsupported app API request body', 'server', 400)
  }

  if (isStreamRequest(path, init.method)) {
    return desktopAppApiStreamResponse(path, init)
  }

  let result: AppApiRequestResult
  try {
    result = await getAppApiBridge().request({
      path,
      method: init.method,
      headers: headersToRecord(init.headers),
      body: init.body ?? null
    })
  } catch (error) {
    throw new DesktopApiError(
      error instanceof Error ? error.message : 'Network request failed',
      'network'
    )
  }

  return responseFromBridgeResult(result)
}

function withMutationIdempotencyHeader(
  methodInput: string | undefined,
  headersInput: HeadersInit | undefined
): Headers {
  const headers = new Headers(headersInput)
  const method = (methodInput ?? 'GET').toUpperCase()
  if (
    (method === 'POST' || method === 'PATCH' || method === 'DELETE') &&
    !headers.has('Idempotency-Key')
  ) {
    headers.set('Idempotency-Key', crypto.randomUUID())
  }
  return headers
}

function desktopAppApiStreamResponse(path: string, init: RequestInit): Promise<Response> {
  const bridge = getAppApiBridge()
  const streamId = crypto.randomUUID()
  const encoder = new TextEncoder()
  let bodyController: ReadableStreamDefaultController<Uint8Array> | null = null
  let settled = false
  let closed = false
  let removeAbortListener = (): void => undefined

  return new Promise<Response>((resolve, reject) => {
    const abort = (): void => {
      void bridge.abort(streamId)
      if (!closed && bodyController) {
        closed = true
        bodyController.error(new DOMException('The operation was aborted.', 'AbortError'))
      }
      if (!settled) {
        settled = true
        reject(new DOMException('The operation was aborted.', 'AbortError'))
      }
    }
    if (init.signal?.aborted) {
      abort()
      return
    }
    init.signal?.addEventListener('abort', abort, { once: true })
    removeAbortListener = () => init.signal?.removeEventListener('abort', abort)

    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        bodyController = controller
      },
      cancel() {
        closed = true
        removeAbortListener()
        return bridge.abort(streamId).then(() => undefined)
      }
    })

    void bridge
      .stream(
        {
          path,
          method: init.method,
          headers: headersToRecord(init.headers),
          body: typeof init.body === 'string' ? init.body : null,
          streamId
        },
        (event) => {
          if (event.type === 'ready' && !settled) {
            settled = true
            resolve(
              new Response(body, {
                status: event.status || 500,
                statusText: event.statusText,
                headers: event.headers
              })
            )
            return
          }
          if (event.type === 'chunk' && typeof event.chunk === 'string' && !closed) {
            bodyController?.enqueue(encoder.encode(event.chunk))
            return
          }
          if (event.type === 'done' && !closed) {
            closed = true
            removeAbortListener()
            bodyController?.close()
            return
          }
          if (event.type === 'error' && !closed) {
            closed = true
            removeAbortListener()
            const error = new DesktopApiError(event.error || 'Network request failed', 'network')
            bodyController?.error(error)
            if (!settled) {
              settled = true
              reject(error)
            }
          }
        }
      )
      .catch((error) => {
        if (closed) return
        closed = true
        removeAbortListener()
        const bridgeError = new DesktopApiError(
          error instanceof Error ? error.message : 'Network request failed',
          'network'
        )
        bodyController?.error(bridgeError)
        if (!settled) {
          settled = true
          reject(bridgeError)
        }
      })
  })
}

function getAppApiBridge(): AppApiBridge {
  const appApi = window.bridge?.appApi as AppApiBridge | undefined
  if (!appApi?.request || !appApi?.stream || !appApi?.abort) {
    throw new DesktopApiError('Desktop app API bridge is unavailable', 'network')
  }
  return appApi
}

function requestPathFromInput(input: RequestInfo | URL): string {
  if (typeof input === 'string') return normalizeBridgePath(input)
  if (input instanceof URL) return normalizeBridgePath(input.toString())
  return normalizeBridgePath(input.url)
}

function normalizeBridgePath(pathOrUrl: string): string {
  const trimmed = pathOrUrl.trim()
  if (trimmed.startsWith('/')) return trimmed
  const url = new URL(trimmed)
  return `${url.pathname}${url.search}`
}

function assertStreamRequest(path: string, method: string | undefined): void {
  if (!isStreamRequest(path, method)) {
    throw new DesktopApiError('Unsupported app API stream path', 'server', 400)
  }
}

function isStreamRequest(path: string, method: string | undefined): boolean {
  const normalizedMethod = (method || 'GET').toUpperCase()
  const pathname = new URL(path, 'https://overlay.local').pathname
  return STREAM_APP_API_ROUTES.has(`${normalizedMethod} ${pathname}`)
}

export function headersToRecord(headersInit: HeadersInit | undefined): Record<string, string> {
  const headers = new Headers(headersInit)
  const record: Record<string, string> = {}
  headers.forEach((value, key) => {
    const normalizedKey = key.toLowerCase()
    if (FORBIDDEN_FORWARD_HEADERS.has(normalizedKey)) return
    if (normalizedKey.startsWith('proxy-') || normalizedKey.startsWith('sec-')) return
    record[key] = value
  })
  return record
}

function responseFromBridgeResult(result: AppApiRequestResult): Response {
  return new Response(responseBodyFromBridgeResult(result), {
    status: result.status || 500,
    statusText: result.statusText || undefined,
    headers: result.headers
  })
}

function responseBodyFromBridgeResult(result: AppApiRequestResult): BodyInit | null {
  if (result.bodyBase64) return new Blob([base64ToBytes(result.bodyBase64)])
  if (result.bodyText) return result.bodyText
  return null
}

function base64ToBytes(value: string): ArrayBuffer {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

async function errorFromResponse(response: Response): Promise<DesktopApiError> {
  const text = await response.text().catch(() => '')
  return errorForStatus(response.status, text || response.statusText)
}

export function errorForStatus(status: number, message: string): DesktopApiError {
  if (status === 401)
    return new DesktopApiError(message || 'Not authenticated', 'unauthenticated', 401)
  if (status === 404) return new DesktopApiError(message || 'Not found', 'not_found', 404)
  if (status === 0) return new DesktopApiError(message || 'Network request failed', 'network')
  return new DesktopApiError(message || `Request failed with ${status}`, 'server', status)
}
