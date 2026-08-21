import { overlayAppClient } from '@/shared/app/overlay-app-client'

/**
 * In-flight/recent title requests keyed by the seed message.
 *
 * The first message fires this request in parallel with the message itself, so
 * by the time the conversation id exists the title is usually already resolved
 * and can be applied without a second round trip.
 */
const requests = new Map<string, Promise<string | null>>()
const REQUEST_TTL_MS = 120_000
const MAX_TRACKED_REQUESTS = 8

function seedKey(text: string): string {
  return text.trim().slice(0, 1200)
}

async function requestTitle(text: string): Promise<string | null> {
  try {
    const res = await overlayAppClient.chat.generateTitleResponse({ text })
    if (res.ok) {
      const data = await res.json()
      return (data.title as string)?.trim() || null
    }
  } catch {
    /* Keep the local title; the chat is still usable without a generated one. */
  }
  return null
}

function track(key: string, promise: Promise<string | null>): Promise<string | null> {
  if (requests.size >= MAX_TRACKED_REQUESTS) {
    const oldest = requests.keys().next()
    if (!oldest.done) requests.delete(oldest.value)
  }
  requests.set(key, promise)
  void promise.finally(() => {
    window.setTimeout(() => {
      if (requests.get(key) === promise) requests.delete(key)
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

export function generateTitle(text: string): Promise<string | null> {
  const key = seedKey(text)
  if (!key) return Promise.resolve(null)
  const existing = requests.get(key)
  if (existing) return existing
  return track(key, requestTitle(text))
}
