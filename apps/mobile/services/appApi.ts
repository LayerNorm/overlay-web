import { AUTH_BASE_URL } from './appConfig'
import { loadAuthSession, type AuthSession } from './authService'

type QueryValue = string | number | boolean | null | undefined

interface AppRequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  query?: Record<string, QueryValue>
  json?: Record<string, unknown>
  formData?: FormData
  headers?: Record<string, string>
  timeoutMs?: number
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

  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
  }, options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS)

  let response: Response
  try {
    response = await fetch(createUrl(path, session, options.query), {
      method: options.method ?? 'GET',
      headers,
      body,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
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
    throw new Error('No response stream available')
  }

  const decoder = new TextDecoder()
  let buffer = ''

  function* parseBuffer(flush = false): Generator<T> {
    let delimiterIndex = buffer.indexOf('\n\n')
    while (delimiterIndex >= 0) {
      const rawEvent = buffer.slice(0, delimiterIndex)
      buffer = buffer.slice(delimiterIndex + 2)

      const line = rawEvent
        .split('\n')
        .find((part) => part.startsWith('data:'))

      if (line) {
        const payload = line.slice(5).trim()
        if (payload === '[DONE]') {
          return
        }
        if (payload) {
          yield JSON.parse(payload) as T
        }
      }

      delimiterIndex = buffer.indexOf('\n\n')
    }

    if (flush && buffer.trim().length > 0) {
      const payload = buffer.replace(/^data:\s*/, '').trim()
      buffer = ''
      if (payload && payload !== '[DONE]') {
        yield JSON.parse(payload) as T
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
