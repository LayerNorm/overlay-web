import { AUTH_BASE_URL } from './appConfig'
import {
  loadAuthSession,
  saveRefreshedAuthSession,
  refreshAuthSession,
  clearAuthSession,
  type AuthSession,
} from './authService'

type QueryValue = string | number | boolean | null | undefined

interface AppRequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  query?: Record<string, QueryValue>
  json?: Record<string, unknown>
  formData?: FormData
  headers?: Record<string, string>
  timeoutMs?: number | null
  signal?: AbortSignal
  /**
   * Explicit workspace scope for this request. When omitted, the module-level
   * active workspace (set by WorkspaceContext via `setRequestWorkspaceId`) is
   * sent as `x-overlay-workspace-id`; the server falls back to the user's
   * stored active workspace when no header is present.
   */
  workspaceId?: string | null
}

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  const error = new Error('The operation was cancelled.')
  error.name = 'AbortError'
  throw error
}

export const ACTIVE_WORKSPACE_HEADER = 'x-overlay-workspace-id'

let requestWorkspaceId: string | null = null

/**
 * Sets the workspace id attached to every appRequest/appFetch call.
 * WorkspaceContext calls this whenever the active workspace changes (or is
 * cleared on sign-out). Pass `null` to clear — the server then resolves the
 * user's stored active workspace.
 */
export function setRequestWorkspaceId(workspaceId: string | null): void {
  requestWorkspaceId = workspaceId && workspaceId.trim().length > 0 ? workspaceId.trim() : null
}

export function getRequestWorkspaceId(): string | null {
  return requestWorkspaceId
}

/** Typed API error so screens can branch on status/code instead of message text. */
export class OverlayApiError extends Error {
  readonly status: number
  readonly code: string | undefined

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'OverlayApiError'
    this.status = status
    this.code = code
  }

  get isAuthError(): boolean {
    return this.status === 401
  }

  get isForbidden(): boolean {
    return this.status === 403
  }

  get isBudgetExceeded(): boolean {
    return this.status === 402
  }

  get isRateLimited(): boolean {
    return this.status === 429
  }
}

function createUrl(
  path: string,
  session: AuthSession | null,
  query?: Record<string, QueryValue>,
): string {
  const url = new URL(path.startsWith('http') ? path : `${AUTH_BASE_URL}${path}`)
  if (session?.user.id) {
    url.searchParams.set('userId', session.user.id)
  }
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue
      url.searchParams.set(key, String(value))
    }
  }
  return url.toString()
}

// How many ms before the actual expiry we consider a token "about to expire"
// and proactively refresh it. WorkOS access tokens last 15 min; refreshing
// 5 min early avoids racing against the clock during long API calls.
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000

async function recoverRefreshFailure(session: AuthSession): Promise<AuthSession> {
  const current = await loadAuthSession()
  if (!current || current.user.id !== session.user.id) throw new Error('Session changed. Please sign in again.')
  if (current.refreshToken !== session.refreshToken || current.accessToken !== session.accessToken) return current
  await clearAuthSession()
  throw new Error('Session expired. Please sign in again.')
}

/**
 * Return a session with a still-valid access token, refreshing it proactively
 * if it has expired (or is about to expire). If refresh fails, the stored
 * session is cleared and an error is thrown so callers can redirect to sign-in.
 */
async function getValidSession(): Promise<AuthSession | null> {
  const session = await loadAuthSession()
  if (!session) return null

  const now = Date.now()
  const expiresAt = session.expiresAt ?? 0

  // If we don't know when the token expires (legacy session from before the
  // expiresAt field was added), still try to refresh it once so we get a
  // session that DOES carry an expiry. After that refresh, future calls will
  // have expiresAt and can be checked normally.
  if (!expiresAt) {
    console.log('[appApi] getValidSession: no expiresAt, forcing refresh')
    try {
      const refreshed = await refreshAuthSession(session)
      await saveRefreshedAuthSession(refreshed, session)
      return refreshed
    } catch (error) {
      console.error('[appApi] getValidSession: refresh failed for legacy session', error)
      return recoverRefreshFailure(session)
    }
  }

  // Token is still valid (with buffer) — use it as-is.
  if (expiresAt > now + TOKEN_REFRESH_BUFFER_MS) {
    return session
  }

  // Token has expired or is about to expire — refresh it.
  console.log(
    '[appApi] getValidSession: token expiring (expiresAt=%d now=%d), refreshing',
    expiresAt,
    now,
  )
  try {
    const refreshed = await refreshAuthSession(session)
    await saveRefreshedAuthSession(refreshed, session)
    console.log('[appApi] getValidSession: refresh succeeded')
    return refreshed
  } catch (error) {
    console.error('[appApi] getValidSession: refresh failed', error)
    return recoverRefreshFailure(session)
  }
}

function resolveWorkspaceId(options: AppRequestOptions): string | null {
  const workspaceId =
    options.workspaceId === undefined ? requestWorkspaceId : options.workspaceId
  return workspaceId && workspaceId.trim().length > 0 ? workspaceId.trim() : null
}

async function fetchWithSessionRetry(send: (session: AuthSession | null) => Promise<Response>): Promise<Response> {
  const session = await getValidSession()
  const response = await send(session)
  if (response.status !== 401 || !session) return response
  let current = await loadAuthSession()
  if (!current || current.user.id !== session.user.id) return response
  if (current.accessToken === session.accessToken) {
    try {
      const refreshed = await refreshAuthSession(current)
      await saveRefreshedAuthSession(refreshed, current)
    } catch {
      return response
    }
  }
  current = await loadAuthSession()
  if (!current || current.user.id !== session.user.id) return response
  return send(current)
}

export async function appRequest(
  path: string,
  options: AppRequestOptions = {},
): Promise<Response> {
  const workspaceId = resolveWorkspaceId(options)
  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  throwIfAborted(options.signal)
  const controller = timeoutMs > 0 || options.signal ? new AbortController() : null
  const abortFromOwner = () => controller?.abort()
  options.signal?.addEventListener('abort', abortFromOwner, { once: true })
  const timer = controller && timeoutMs > 0
    ? setTimeout(() => {
        console.warn(
          '[appApi] request timed out after %d ms: %s',
          timeoutMs,
          path,
        )
        controller.abort()
      }, timeoutMs)
    : null

  let response: Response
  try {
    response = await fetchWithSessionRetry(session => {
      throwIfAborted(options.signal)
      const headers = new Headers(options.headers)
      if (session?.accessToken) headers.set('Authorization', `Bearer ${session.accessToken}`)
      if (workspaceId) headers.set(ACTIVE_WORKSPACE_HEADER, workspaceId)
      let body: BodyInit | undefined = options.formData
      if (!body && options.json) {
        headers.set('Content-Type', 'application/json')
        body = JSON.stringify({ ...options.json, accessToken: session?.accessToken, userId: session?.user.id })
      }
      return fetch(createUrl(path, session, options.query), {
        method: options.method ?? 'GET', headers, body, signal: controller?.signal,
      })
    })
  } finally {
    options.signal?.removeEventListener('abort', abortFromOwner)
    if (timer) {
      clearTimeout(timer)
    }
  }

  return response
}

export async function appFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers)
  // RequestInit has no workspaceId option — callers scoping to a different
  // workspace set the header themselves; otherwise the module default applies.
  if (requestWorkspaceId && !headers.has(ACTIVE_WORKSPACE_HEADER)) {
    headers.set(ACTIVE_WORKSPACE_HEADER, requestWorkspaceId)
  }

  const path =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url
  return fetchWithSessionRetry(session => {
    throwIfAborted(init.signal ?? undefined)
    const attemptHeaders = new Headers(headers)
    if (session?.accessToken) attemptHeaders.set('Authorization', `Bearer ${session.accessToken}`)
    return fetch(createUrl(path, session), { ...init, headers: attemptHeaders })
  })
}

export async function appJson<T>(
  path: string,
  options: AppRequestOptions = {},
): Promise<T> {
  const response = await appRequest(path, options)
  if (!response.ok) {
    throw await toOverlayApiError(response)
  }
  return response.json() as Promise<T>
}

async function toOverlayApiError(response: Response): Promise<OverlayApiError> {
  const text = await response.text().catch(() => '')
  let payload: { error?: unknown; message?: unknown; code?: unknown } | null = null
  try {
    payload = text ? JSON.parse(text) as { error?: unknown; message?: unknown; code?: unknown } : null
  } catch {
    payload = null
  }

  const code = typeof payload?.code === 'string' ? payload.code : undefined
  const raw = String(payload?.message || payload?.error || text || '').trim()
  const lower = raw.toLowerCase()
  let message: string
  if (response.status === 401) {
    message = 'Session expired. Please sign in again.'
  } else if (response.status === 403 && (lower.includes('storage') || lower.includes('quota'))) {
    message = 'Not enough Overlay storage remaining.'
  } else if (response.status === 403 && (lower.includes('paid plan') || lower.includes('upgrade'))) {
    message = 'This feature requires a paid Overlay plan.'
  } else if (response.status === 402 || lower.includes('budget') || lower.includes('credits')) {
    message = 'Your Overlay budget is exhausted. Review billing on the web app.'
  } else if (response.status >= 500) {
    message = raw || 'Overlay backend is temporarily unavailable.'
  } else {
    message = raw || `Request failed with status ${response.status}`
  }
  return new OverlayApiError(message, response.status, code)
}

export async function readJsonSseStream<T>(
  response: Response,
  onChunk: (chunk: T) => void,
): Promise<void> {
  for await (const chunk of streamJsonSse<T>(response)) {
    onChunk(chunk)
  }
}

export async function* streamJsonSse<T>(response: Response): AsyncGenerator<T> {
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(text || `Stream failed with status ${response.status}`)
  }

  const reader = response.body?.getReader()
  if (!reader) {
    const text = await response.text()
    for (const chunk of parseSseText<T>(text)) {
      yield chunk
    }
    return
  }

  const decoder = new TextDecoder()
  let buffer = ''

  function* parseBuffer(flush = false): Generator<T> {
    let delimiterIndex = buffer.indexOf('\n\n')
    while (delimiterIndex >= 0) {
      const rawEvent = buffer.slice(0, delimiterIndex)
      buffer = buffer.slice(delimiterIndex + 2)

      const chunk = parseSseEvent<T>(rawEvent)
      if (chunk.done) {
        return
      }
      if (chunk.value !== undefined) {
        yield chunk.value
      }

      delimiterIndex = buffer.indexOf('\n\n')
    }

    if (flush && buffer.trim().length > 0) {
      const chunk = parseSseEvent<T>(buffer)
      buffer = ''
      if (chunk.done) {
        return
      }
      if (chunk.value !== undefined) {
        yield chunk.value
      }
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done })

    for (const chunk of parseBuffer(done)) {
      yield chunk
    }

    if (done) {
      return
    }
  }
}

function xhrRawStream(
  url: string,
  method: string,
  headers: Record<string, string>,
  body?: string,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const queue: Array<{ text: string } | { error: Error } | null> = []
  let notify: (() => void) | null = null
  let finished = false

  const xhr = new XMLHttpRequest()
  throwIfAborted(signal)
  const abort = () => xhr.abort()
  signal?.addEventListener('abort', abort, { once: true })
  xhr.open(method, url)
  for (const [key, value] of Object.entries(headers)) {
    xhr.setRequestHeader(key, value)
  }

  let position = 0

  function push(item: { text: string } | { error: Error } | null) {
    queue.push(item)
    const fn = notify
    notify = null
    fn?.()
  }

  xhr.onprogress = () => {
    const newText = xhr.responseText.slice(position)
    if (newText.length > 0) {
      position = xhr.responseText.length
      push({ text: newText })
    }
  }

  xhr.onload = () => {
    signal?.removeEventListener('abort', abort)
    if (xhr.status < 200 || xhr.status >= 300) {
      finished = true
      push({ error: new Error(`HTTP ${xhr.status}: ${xhr.statusText || 'Request failed'} — ${xhr.responseText.slice(0, 200)}`) })
      push(null)
      return
    }
    const newText = xhr.responseText.slice(position)
    if (newText.length > 0) {
      position = xhr.responseText.length
      push({ text: newText })
    }
    finished = true
    push(null)
  }

  xhr.onerror = () => {
    signal?.removeEventListener('abort', abort)
    finished = true
    push({ error: new Error(`XHR request failed (status ${xhr.status})`) })
  }

  xhr.onabort = () => {
    signal?.removeEventListener('abort', abort)
    finished = true
    const error = new Error('The operation was cancelled.')
    error.name = 'AbortError'
    push({ error })
    push(null)
  }

  xhr.ontimeout = () => {
    signal?.removeEventListener('abort', abort)
    finished = true
    push({ error: new Error('XHR request timed out') })
  }

  throwIfAborted(signal)
  xhr.send(body)

  async function* gen(): AsyncGenerator<string> {
    try {
      while (true) {
        throwIfAborted(signal)
        if (queue.length > 0) {
          const item = queue.shift()!
          if (item === null) return
          if ('error' in item) throw item.error
          yield item.text
        } else if (finished) {
          return
        } else {
          await new Promise<void>((resolve) => {
            notify = resolve
          })
        }
      }
    } finally {
      signal?.removeEventListener('abort', abort)
    }
  }

  const iterator = gen()
  const originalReturn = iterator.return.bind(iterator)
  iterator.return = async (value) => {
    if (!finished) xhr.abort()
    return originalReturn(value)
  }
  return iterator
}

async function* xhrStreamSse<T>(
  url: string,
  method: string,
  headers: Record<string, string>,
  body?: string,
  signal?: AbortSignal,
): AsyncGenerator<T> {
  let buffer = ''

  for await (const chunk of xhrRawStream(url, method, headers, body, signal)) {
    buffer += chunk
    let delimiterIndex = buffer.indexOf('\n\n')
    while (delimiterIndex >= 0) {
      const rawEvent = buffer.slice(0, delimiterIndex)
      buffer = buffer.slice(delimiterIndex + 2)
      const result = parseSseEvent<T>(rawEvent)
      if (result.done) return
      if (result.value !== undefined) yield result.value
      delimiterIndex = buffer.indexOf('\n\n')
    }
  }

  if (buffer.trim()) {
    const result = parseSseEvent<T>(buffer)
    if (!result.done && result.value !== undefined) yield result.value
  }
}

async function* appXhrStreamSseInner<T>(
  path: string,
  options: AppRequestOptions = {},
): AsyncGenerator<T> {
  throwIfAborted(options.signal)
  const streamWorkspaceId = resolveWorkspaceId(options)
  const session = await getValidSession()
  throwIfAborted(options.signal)
  const headers: Record<string, string> = { ...options.headers }
  if (session?.accessToken) {
    headers['Authorization'] = `Bearer ${session.accessToken}`
  }
  if (streamWorkspaceId && !headers[ACTIVE_WORKSPACE_HEADER]) {
    headers[ACTIVE_WORKSPACE_HEADER] = streamWorkspaceId
  }
  let body: string | undefined
  if (options.json) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify({
      ...options.json,
      accessToken: session?.accessToken,
      userId: session?.user.id,
    })
  }
  const url = createUrl(path, session, options.query)
  yield* xhrStreamSse<T>(url, options.method ?? 'POST', headers, body, options.signal)
}

export function appXhrStreamSse<T>(
  path: string,
  options: AppRequestOptions = {},
): AsyncGenerator<T> {
  const controller = new AbortController()
  const abortFromOwner = () => controller.abort()
  if (options.signal?.aborted) controller.abort()
  else options.signal?.addEventListener('abort', abortFromOwner, { once: true })
  const inner = appXhrStreamSseInner<T>(path, { ...options, signal: controller.signal })
  const generator = (async function* (): AsyncGenerator<T> {
    try {
      yield* inner
    } finally {
      options.signal?.removeEventListener('abort', abortFromOwner)
    }
  })()
  const originalReturn = generator.return.bind(generator)
  const originalThrow = generator.throw.bind(generator)
  generator.return = async (value) => {
    controller.abort()
    return originalReturn(value)
  }
  generator.throw = async (error) => {
    controller.abort()
    return originalThrow(error)
  }
  return generator
}

function* parseSseText<T>(text: string): Generator<T> {
  const normalized = text.replace(/\r\n/g, '\n')
  const events = normalized.split('\n\n')

  for (const rawEvent of events) {
    const chunk = parseSseEvent<T>(rawEvent)
    if (chunk.done) {
      return
    }
    if (chunk.value !== undefined) {
      yield chunk.value
    }
  }
}

function parseSseEvent<T>(
  rawEvent: string,
): { done: true; value?: never } | { done: false; value?: T } {
  const payload = rawEvent
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .join('\n')
    .trim()

  if (!payload) {
    return { done: false }
  }

  if (payload === '[DONE]') {
    return { done: true }
  }

  return { done: false, value: JSON.parse(payload) as T }
}
