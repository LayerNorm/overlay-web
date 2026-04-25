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

function xhrRawStream(
  url: string,
  method: string,
  headers: Record<string, string>,
  body?: string,
): AsyncGenerator<string> {
  const queue: Array<{ text: string } | { error: Error } | null> = []
  let notify: (() => void) | null = null
  let finished = false

  const xhr = new XMLHttpRequest()
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
    const newText = xhr.responseText.slice(position)
    if (newText.length > 0) {
      position = xhr.responseText.length
      push({ text: newText })
    }
    finished = true
    push(null)
  }

  xhr.onerror = () => {
    finished = true
    push({ error: new Error(`XHR request failed (status ${xhr.status})`) })
  }

  xhr.ontimeout = () => {
    finished = true
    push({ error: new Error('XHR request timed out') })
  }

  xhr.send(body)

  async function* gen(): AsyncGenerator<string> {
    while (true) {
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
  }

  return gen()
}

async function* xhrStreamSse<T>(
  url: string,
  method: string,
  headers: Record<string, string>,
  body?: string,
): AsyncGenerator<T> {
  let buffer = ''

  for await (const chunk of xhrRawStream(url, method, headers, body)) {
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

export async function* appXhrStreamSse<T>(
  path: string,
  options: AppRequestOptions = {},
): AsyncGenerator<T> {
  const session = await getSession()
  const headers: Record<string, string> = { ...options.headers }
  if (session?.accessToken) {
    headers['Authorization'] = `Bearer ${session.accessToken}`
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
  yield* xhrStreamSse<T>(url, options.method ?? 'POST', headers, body)
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
