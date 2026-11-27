import type { AuthSession } from './authService'

export function convexTokenRetryDelay(failures: number): number {
  return Math.min(1_000 * 2 ** Math.max(0, failures - 1), 30_000)
}

export function scheduleConvexTokenRetry(failures: number, onRetry: () => void): () => void {
  const timer = setTimeout(onRetry, convexTokenRetryDelay(failures + 1))
  return () => clearTimeout(timer)
}

export function createNativeConvexTokenFetcher(
  userId: string | null,
  dependencies: {
    load: () => Promise<AuthSession | null>
    refresh: (session: AuthSession) => Promise<AuthSession>
    save: (session: AuthSession, previous: AuthSession) => Promise<void>
    isCurrent: () => boolean
    onFailure?: () => void
  },
) {
  const flights = new Map<boolean, Promise<string | null>>()
  return ({ forceRefreshToken }: { forceRefreshToken: boolean }): Promise<string | null> => {
    if (!userId || !dependencies.isCurrent()) return Promise.resolve(null)
    const pending = flights.get(forceRefreshToken)
    if (pending) return pending
    const run = async () => {
      let session = await dependencies.load()
      if (!dependencies.isCurrent() || session?.user.id !== userId) return null
      if (forceRefreshToken) {
        const refreshed = await dependencies.refresh(session)
        const current = await dependencies.load()
        if (!dependencies.isCurrent() || current?.user.id !== userId || refreshed.user.id !== userId) return null
        await dependencies.save(refreshed, session)
        session = refreshed
      }
      if (!dependencies.isCurrent() || (await dependencies.load())?.user.id !== userId) return null
      return session.accessToken.trim() || null
    }
    const request = run().catch(() => null).then((token) => {
      if (token === null && dependencies.isCurrent()) dependencies.onFailure?.()
      return token
    })
    flights.set(forceRefreshToken, request)
    void request.then(() => { if (flights.get(forceRefreshToken) === request) flights.delete(forceRefreshToken) })
    return request
  }
}
