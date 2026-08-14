'use client'

import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import { KNOWLEDGE_RECONCILE_EVENT } from '@overlay/app-core'
import { trackSessionRefresh } from '@/shared/observability/client-metrics'

export interface AuthUser {
  id: string
  email: string
  firstName?: string
  lastName?: string
  profilePictureUrl?: string
  emailVerified?: boolean
}

interface AuthContextType {
  user: AuthUser | null
  isLoading: boolean
  isAuthenticated: boolean
  signOut: () => Promise<void>
  refreshSession: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)
const SESSION_CHECK_INTERVAL_MS = 4 * 60 * 1000
const SESSION_REFRESH_LOCK_NAME = 'overlay:auth-session-refresh'
// Minimum time after a successful session check before a focus/visibility
// refresh is allowed.  Prevents redundant checks when the user rapidly
// switches tabs.
const SESSION_MIN_STALE_BEFORE_FOCUS_MS = 30 * 1000

type SessionCheckResult =
  | { status: 'authenticated'; user: AuthUser }
  | { status: 'unauthenticated' }
  | { status: 'transient-error' }

let sessionCheckInFlight: Promise<SessionCheckResult> | null = null

async function fetchSessionState(): Promise<SessionCheckResult> {
  const response = await fetch('/api/auth/session', {
    credentials: 'same-origin',
    cache: 'no-store',
  })
  const contentType = response.headers.get('content-type') || ''
  if (!response.ok || !contentType.includes('application/json')) {
    return { status: 'transient-error' }
  }

  const data = await response.json() as {
    authenticated?: boolean
    user?: AuthUser
  }
  return data.authenticated && data.user
    ? { status: 'authenticated', user: data.user }
    : { status: 'unauthenticated' }
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

function requestSessionState(): Promise<SessionCheckResult> {
  if (sessionCheckInFlight) return sessionCheckInFlight

  const run = () => fetchSessionState().catch((error) => {
    console.error('[Auth] Session check failed:', error)
    return { status: 'transient-error' } as const
  })
  const request = runWithSessionRefreshLock(run)

  sessionCheckInFlight = request
  void request.finally(() => {
    if (sessionCheckInFlight === request) sessionCheckInFlight = null
  })
  return request
}

type AuthProviderProps = {
  children: ReactNode
  initialUser?: AuthUser | null
  initialSessionResolved?: boolean
}

export function AuthProvider({
  children,
  initialUser = null,
  initialSessionResolved = false,
}: AuthProviderProps) {
  const [user, setUser] = useState<AuthUser | null>(initialUser)
  const [isLoading, setIsLoading] = useState(!initialSessionResolved)
  const reconciledUserId = useRef(initialUser?.id ?? null)
  const lastCheckAtRef = useRef(0)

  useEffect(() => {
    if (initialUser) {
      setUser(initialUser)
    }
    if (initialSessionResolved) {
      setIsLoading(false)
    }
  }, [initialUser, initialSessionResolved])

  useEffect(() => {
    if (isLoading) return
    const nextUserId = user?.id ?? null
    if (reconciledUserId.current === nextUserId) return
    reconciledUserId.current = nextUserId
    window.dispatchEvent(new CustomEvent(KNOWLEDGE_RECONCILE_EVENT, {
      detail: { reason: 'authentication-changed' },
    }))
  }, [isLoading, user?.id])

  const checkSession = useCallback(async (trigger: 'interval' | 'focus' | 'visibility' | 'manual' = 'manual') => {
    // Skip focus/visibility refreshes if we checked very recently.
    if ((trigger === 'focus' || trigger === 'visibility') && Date.now() - lastCheckAtRef.current < SESSION_MIN_STALE_BEFORE_FOCUS_MS) return
    const startTime = performance.now()
    lastCheckAtRef.current = Date.now()
    try {
      const result = await requestSessionState()
      const success = result.status === 'authenticated' || result.status === 'unauthenticated'
      trackSessionRefresh({
        trigger,
        durationMs: Math.round(performance.now() - startTime),
        success,
      })
      if (result.status === 'authenticated') {
        setUser(result.user)
      } else if (result.status === 'unauthenticated') {
        setUser(null)
      }
    } finally {
      setIsLoading(false)
    }
  }, [])

  const signOut = useCallback(async () => {
    try {
      try {
        const { default: posthog } = await import('posthog-js')
        posthog.capture('user_signed_out')
      } catch {
        // ignore
      }
      await fetch('/api/auth/sign-out', { method: 'POST' })
      try {
        const { default: posthog } = await import('posthog-js')
        posthog.reset()
      } catch {
        // ignore
      }
      setUser(null)
      window.location.href = '/'
    } catch (error) {
      console.error('[Auth] Sign out failed:', error)
    }
  }, [])

  const refreshSession = useCallback(async () => {
    await checkSession('manual')
  }, [checkSession])

  useEffect(() => {
    // Skip the initial mount check if the server already resolved the session.
    if (initialSessionResolved && initialUser) {
      lastCheckAtRef.current = Date.now()
    } else {
      void checkSession('manual')
    }
    const intervalId = window.setInterval(() => {
      void checkSession('interval')
    }, SESSION_CHECK_INTERVAL_MS)
    const handleFocus = () => {
      void checkSession('focus')
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void checkSession('visibility')
    }
    window.addEventListener('focus', handleFocus)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener('focus', handleFocus)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [checkSession, initialSessionResolved, initialUser])

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        signOut,
        refreshSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function AuthBoundary(props: AuthProviderProps) {
  const context = useContext(AuthContext)
  if (context !== undefined) return props.children
  return <AuthProvider {...props} />
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
