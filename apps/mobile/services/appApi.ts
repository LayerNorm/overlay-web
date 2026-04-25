import { AUTH_BASE_URL } from './appConfig'
import { loadAuthSession, type AuthSession } from './authService'

type QueryValue = string | number | boolean | null | undefined

interface AppRequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  query?: Record<string, QueryValue>
  json?: Record<string, unknown>
  formData?: FormData
  headers?: Record<string, string>
  timeoutMs?: number | null
}

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000

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

async function getSession(): Promise<AuthSession | null> {
  return loadAuthSession()
}

export async function appRequest(
  path: string,
  options: AppRequestOptions = {},
): Promise<Response> {
  const session = await getSession()
  const headers = new Headers(options.headers)
  if (session?.accessToken) {
    headers.set('Authorization', `Bearer ${session.accessToken}`)
  }

  let body: BodyInit | undefined
  if (options.formData) {
    body = options.formData
  } else if (options.json) {
    headers.set('Content-Type', 'application/json')
    body = JSON.stringify({
      ...options.json,
      accessToken: session?.accessToken,
      userId: session?.user.id,
    })
  }

  const requestUrl = createUrl(path, session, options.query)
  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  const controller = timeoutMs > 0 ? new AbortController() : null
  const timer = controller
    ? setTimeout(() => {
        console.warn(
          '[appApi] request timed out after %d ms: %s',
          timeoutMs,
          requestUrl,
        )
        controller.abort()
      }, timeoutMs)
    : null

  let response: Response
  try {
    response = await fetch(requestUrl, {
      method: options.method ?? 'GET',
      headers,
      body,
      signal: controller?.signal,
    })
  } finally {
    if (timer) {
      clearTimeout(timer)
    }
  }

  return response
}

export async function appJson<T>(
  path: string,
  options: AppRequestOptions = {},
): Promise<T> {
  const response = await appRequest(path, options)
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(text || `Request failed with status ${response.status}`)
  }
  return response.json() as Promise<T>
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
