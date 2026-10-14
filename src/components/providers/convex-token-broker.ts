/**
 * Single-flight Convex token broker.
 *
 * Ensures only one in-flight request to `/api/auth/convex-token` at a time.
 * The initial and interval refreshes in ConvexAuthProvider share the same
 * promise with other callers. The token travels as a query argument, never
 * through Convex's separate platform authentication callback.
 */

let inFlight: Promise<string | null> | null = null

export async function fetchConvexToken(): Promise<string | null> {
  if (inFlight) return inFlight
  const request = doFetchConvexToken()
  inFlight = request
  void request.finally(() => {
    if (inFlight === request) inFlight = null
  })
  return request
}

async function doFetchConvexToken(): Promise<string | null> {
  const response = await fetch('/api/auth/convex-token', {
    credentials: 'same-origin',
    cache: 'no-store',
  })
  if (!response.ok) return null
  const data = await response.json() as { token?: string }
  return data.token?.trim() || null
}
