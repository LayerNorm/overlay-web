import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { fallbackChatTitle, isPlaceholderChatTitle } from '@/shared/chat/chat-title'

/**
 * In-flight/recent title requests keyed by the seed message.
 *
 * The first message fires this request in parallel with the message itself, so
 * by the time the conversation id exists the title is usually already resolved
 * and can be applied without a second round trip.
 */
const requests = new Map<string, Promise<string | null>>()
const resolvedTitles = new Map<string, string>()
const REQUEST_TTL_MS = 120_000
const REQUEST_TIMEOUT_MS = 25_000
const MAX_REQUEST_ATTEMPTS = 2
const MAX_TRACKED_REQUESTS = 8

function seedKey(text: string): string {
  return text.trim().slice(0, 1200)
}

type TitleRequestAttempt =
  | { kind: 'resolved'; title: string | null }
  | { kind: 'retry' }
  | { kind: 'stop' }

async function requestTitleAttempt(text: string, timeoutMs: number): Promise<TitleRequestAttempt> {
  const controller = new AbortController()
  let timedOut = false
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      timedOut = true
      controller.abort()
      reject(new Error('Title request timed out'))
    }, timeoutMs)
  })
  const request = (async (): Promise<TitleRequestAttempt> => {
    let res: Response
    try {
      res = await overlayAppClient.chat.generateTitleResponse(
        { text },
        { signal: controller.signal },
      )
    } catch {
      return { kind: 'retry' }
    }

    if (!res.ok) {
      return res.status === 429 || res.status >= 500 ? { kind: 'retry' } : { kind: 'stop' }
    }

    let data: unknown
    try {
      data = await res.json()
    } catch (error) {
      const networkFailure = error instanceof TypeError || (error instanceof Error && error.name === 'AbortError')
      return timedOut || networkFailure ? { kind: 'retry' } : { kind: 'stop' }
    }

    const title = data && typeof data === 'object' && 'title' in data && typeof data.title === 'string'
      ? data.title.trim()
      : ''
    return { kind: 'resolved', title: title || null }
  })()

  try {
    return await Promise.race([request, timeout])
  } catch {
    return { kind: 'retry' }
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
  }
}

export async function requestTitle(
  text: string,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<string | null> {
  for (let attempt = 0; attempt < MAX_REQUEST_ATTEMPTS; attempt++) {
    const result = await requestTitleAttempt(text, timeoutMs)
    if (result.kind === 'resolved') {
      return isPlaceholderChatTitle(result.title) ? fallbackChatTitle(text) : result.title
    }
    if (result.kind === 'stop') return fallbackChatTitle(text)
  }
  return fallbackChatTitle(text)
}

function track(key: string, promise: Promise<string | null>): Promise<string | null> {
  if (requests.size >= MAX_TRACKED_REQUESTS) {
    const oldest = requests.keys().next()
    if (!oldest.done) {
      requests.delete(oldest.value)
      resolvedTitles.delete(oldest.value)
    }
  }
  requests.set(key, promise)
  void promise.then((title) => {
    if (requests.get(key) !== promise) return
    if (title) resolvedTitles.set(key, title)
    window.setTimeout(() => {
      if (requests.get(key) === promise) {
        requests.delete(key)
        resolvedTitles.delete(key)
      }
    }, REQUEST_TTL_MS)
  })
  return promise
}

/**
 * Start generating a title without waiting for it. Call this the moment the
 * first message is sent; `generateTitle` with the same seed then resolves from
 * this request instead of starting a new one.
 */
export function prefetchTitle(text: string): Promise<string | null> | null {
  const key = seedKey(text)
  if (!key) return null
  const existing = requests.get(key)
  if (existing) return existing
  return track(key, requestTitle(text))
}

export function peekResolvedTitle(text: string): string | null {
  return resolvedTitles.get(seedKey(text)) ?? null
}

export function generateTitle(text: string): Promise<string | null> {
  const key = seedKey(text)
  if (!key) return Promise.resolve(null)
  const existing = requests.get(key)
  if (existing) return existing
  return track(key, requestTitle(text))
}
