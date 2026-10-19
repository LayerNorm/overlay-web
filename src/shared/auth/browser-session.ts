export interface BrowserAuthUser {
  id: string
  email: string
  firstName?: string
  lastName?: string
  profilePictureUrl?: string
  emailVerified?: boolean
}

export type SessionCheckResult =
  | { status: 'authenticated'; user: BrowserAuthUser }
  | { status: 'unauthenticated' }
  | { status: 'transient-error' }

const SESSION_REFRESH_LOCK_NAME = 'overlay:auth-session-refresh'
let sessionCheckInFlight: Promise<SessionCheckResult> | null = null
let sessionRevision = 0

export function getBrowserSessionRevision(): number {
  return sessionRevision
}

async function fetchSessionState(): Promise<SessionCheckResult> {
  const response = await fetch('/api/auth/session', {
    credentials: 'same-origin',
    cache: 'no-store',
    signal: AbortSignal.timeout(30_000),
  })
  const contentType = response.headers.get('content-type') || ''
  if (!response.ok || !contentType.includes('application/json')) {
    return { status: 'transient-error' }
  }

  const data = await response.json() as {
    authenticated?: boolean
    user?: BrowserAuthUser
  }
  if (data.authenticated && data.user) {
    sessionRevision += 1
    return { status: 'authenticated', user: data.user }
  }
  return { status: 'unauthenticated' }
}

async function runWithSessionRefreshLock(
  run: () => Promise<SessionCheckResult>,
): Promise<SessionCheckResult> {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return await navigator.locks.request(
      SESSION_REFRESH_LOCK_NAME,
      async () => await run(),
    )
  }
  return await run()
}

export function requestSessionState(): Promise<SessionCheckResult> {
  if (sessionCheckInFlight) return sessionCheckInFlight

  const run = () => fetchSessionState()
  const request = runWithSessionRefreshLock(run)
    .catch(() => ({ status: 'transient-error' }) as const)

  sessionCheckInFlight = request
  void request.then(() => {
    if (sessionCheckInFlight === request) sessionCheckInFlight = null
  })
  return request
}
