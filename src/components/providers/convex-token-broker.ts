/**
 * Single-flight Convex token broker.
 *
 * Ensures only one in-flight request to `/api/auth/convex-token` at a time.
 * Both the interval-based refresh in ConvexAuthProvider and the Convex
 * client's on-demand auth callback share the same promise, eliminating
 * duplicate token fetches.
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
