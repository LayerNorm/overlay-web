/**
 * Single-flight Convex token broker.
 *
 * Ensures only one in-flight request to `/api/auth/convex-token` at a time.
 * The initial and interval refreshes in ConvexAuthProvider share the same
 * promise with other callers. The token travels as a query argument, never
 * through Convex's separate platform authentication callback.
 */

let inFlight: Promise<string | null> | null = null

export async function fetchConvexToken(refreshSession: () => Promise<void>): Promise<string | null> {
  if (inFlight) return inFlight
  const request = doFetchConvexToken(refreshSession)
  inFlight = request
  const clear = () => { if (inFlight === request) inFlight = null }
  // finally() creates a second rejected promise on network failure unless that promise is caught.
  void request.then(clear, clear)
  return request
}

async function doFetchConvexToken(refreshSession: () => Promise<void>): Promise<string | null> {
  const options: RequestInit = { credentials: 'same-origin', cache: 'no-store' }
  let response = await fetch('/api/auth/convex-token', options)
  if (response.status === 401) {
    // Use AuthContext's shared, locked refresh path so this cannot race refresh-token rotation.
    await refreshSession()
    response = await fetch('/api/auth/convex-token', options)
  }
  if (!response.ok) return null
  const data = await response.json() as { token?: string }
  return data.token?.trim() || null
}
