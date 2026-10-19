import { getBrowserSessionRevision, requestSessionState } from './browser-session'

function canRecoverBrowserSession(input: RequestInfo | URL, init?: RequestInit): boolean {
  if (typeof window === 'undefined' || input instanceof Request) return false
  if (init?.credentials === 'omit' || new Headers(init?.headers).has('Authorization')) return false
  // The app client's JSON bodies are replayable; request/stream bodies are not.
  if (init?.body != null && typeof init.body !== 'string') return false
  const url = new URL(String(input), window.location.href)
  return url.origin === window.location.origin && url.pathname.startsWith('/api/v1/')
}

export const fetchWithSessionRecovery: typeof fetch = async (input, init) => {
  const revision = getBrowserSessionRevision()
  const response = await fetch(input, init)
  if (response.status !== 401 || response.redirected || !canRecoverBrowserSession(input, init)) {
    return response
  }

  init?.signal?.throwIfAborted()
  // A delayed 401 may belong to the cookie another request has already renewed.
  if (revision === getBrowserSessionRevision()) {
    const session = await requestSessionState()
    if (session.status !== 'authenticated') return response
  }
  init?.signal?.throwIfAborted()
  // Keep the original body, headers and idempotency key. Never loop on a second 401.
  return fetch(input, init)
}
