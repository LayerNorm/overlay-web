'use client'

import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from 'react'
import { KNOWLEDGE_RECONCILE_EVENT } from '@overlay/app-core'
import { trackSessionRefresh } from '@/shared/observability/client-metrics'
import { requestSessionState, type BrowserAuthUser } from '@/shared/auth/browser-session'

export type AuthUser = BrowserAuthUser

interface AuthContextType {
  user: AuthUser | null
  isLoading: boolean
  isAuthenticated: boolean
  signOut: () => Promise<void>
  refreshSession: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)
const SESSION_CHECK_INTERVAL_MS = 4 * 60 * 1000
// Minimum time after a successful session check before a focus/visibility
// refresh is allowed.  Prevents redundant checks when the user rapidly
// switches tabs.
const SESSION_MIN_STALE_BEFORE_FOCUS_MS = 30 * 1000

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

  const [prevInitial, setPrevInitial] = useState({ user: initialUser, resolved: initialSessionResolved })
  if (initialUser !== prevInitial.user || initialSessionResolved !== prevInitial.resolved) {
    setPrevInitial({ user: initialUser, resolved: initialSessionResolved })
    if (initialUser) {
      setUser(initialUser)
    }
    if (initialSessionResolved) {
      setIsLoading(false)
    }
  }

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

  const authValue = useMemo(() => ({
    user,
    isLoading,
    isAuthenticated: Boolean(user),
    signOut,
    refreshSession,
  }), [user, isLoading, signOut, refreshSession])

  return (
    <AuthContext.Provider value={authValue}>
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
