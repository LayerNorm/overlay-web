/**
 * Single-flight Convex token broker.
 *
 * Ensures only one in-flight request to `/api/auth/convex-token` at a time.
 * The initial and interval refreshes in ConvexAuthProvider share the same
 * promise with other callers. The token travels as a query argument, never
 * through Convex's separate platform authentication callback.
 */

const flights = new Map<string, Promise<string | null>>()

export async function fetchConvexToken(refreshSession: () => Promise<void>, userId?: string): Promise<string | null> {
  const key = userId ?? ''
  const pending = flights.get(key)
  if (pending) return pending
  const request = doFetchConvexToken(refreshSession, userId)
  flights.set(key, request)
  const clear = () => { if (flights.get(key) === request) flights.delete(key) }
  // finally() creates a second rejected promise on network failure unless that promise is caught.
  void request.then(clear, clear)
  return request
}

async function doFetchConvexToken(refreshSession: () => Promise<void>, userId?: string): Promise<string | null> {
  const options: RequestInit = { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(30_000) }
  let response = await fetch('/api/auth/convex-token', options)
  if (response.status === 401) {
    // Use AuthContext's shared, locked refresh path so this cannot race refresh-token rotation.
    await refreshSession()
    response = await fetch('/api/auth/convex-token', options)
  }
  if (!response.ok) return null
  const data = await response.json() as { token?: string; userId?: string }
  if (userId && data.userId !== userId) return null
  return data.token?.trim() || null
}
