/**
 * Fetches the Convex token for the signed-in user. `onFailure` runs when no token could be had for that user (network
 * error, timeout, server error), so the caller can try again: Convex asks a fetcher once and then stays signed out.
 */
export function createNativeConvexTokenFetcher(userId: string | null, refreshSession: () => Promise<void>, onFailure?: () => void) {
  const flights = new Map<boolean, Promise<string | null>>()
  return ({ forceRefreshToken }: { forceRefreshToken: boolean }): Promise<string | null> => {
    if (!userId) return Promise.resolve(null)
    const pending = flights.get(forceRefreshToken)
    if (pending) return pending
    const run = async () => {
      if (forceRefreshToken) await refreshSession()
      const options: RequestInit = { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(30_000) }
      let response = await fetch('/api/auth/convex-token', options)
      if (response.status === 401 && !forceRefreshToken) {
        await refreshSession()
        response = await fetch('/api/auth/convex-token', { ...options, signal: AbortSignal.timeout(30_000) })
      }
      if (!response.ok) return null
      const data = await response.json() as { token?: unknown; userId?: unknown }
      if (data.userId !== userId) return null
      return typeof data.token === 'string' ? data.token.trim() || null : null
    }
    const request = run().catch(() => null).then((token) => {
      if (token === null) onFailure?.()
      return token
    })
    flights.set(forceRefreshToken, request)
    void request.then(() => { if (flights.get(forceRefreshToken) === request) flights.delete(forceRefreshToken) })
    return request
  }
}
