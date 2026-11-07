'use client'

import { notifyDesktopSignedOut } from '@overlay/desktop-bridge'

import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from 'react'
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

/** The account's chosen name and photo, from the live account identity query. */
export type AccountIdentityOverlay = { userId: string; displayName: string; photoUrl: string | null }
const AccountIdentitySyncContext = createContext<((identity: AccountIdentityOverlay | null) => void) | null>(null)
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
  const lastCheckAtRef = useRef(0)
  const hadSession = useRef(Boolean(initialUser))
  // The latest live account name and photo; session checks return the sign-in provider's values, so this is
  // applied over every one of them.
  const identityRef = useRef<AccountIdentityOverlay | null>(null)

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

  const applyLiveIdentity = useCallback((identity: AccountIdentityOverlay | null) => {
    identityRef.current = identity
    if (identity) setUser((current) => current ? withAccountIdentity(current, identity) : current)
  }, [])

  const checkSession = useCallback(async (trigger: 'interval' | 'focus' | 'visibility' | 'manual' = 'manual') => {
    // Skip focus/visibility refreshes if we checked very recently.
    if ((trigger === 'focus' || trigger === 'visibility') && Date.now() - lastCheckAtRef.current < SESSION_MIN_STALE_BEFORE_FOCUS_MS) return
    lastCheckAtRef.current = Date.now()
    try {
      const result = await requestSessionState()
      if (result.status === 'authenticated') {
        hadSession.current = true
        setUser(withAccountIdentity(result.user, identityRef.current))
      } else if (result.status === 'unauthenticated') {
        if (hadSession.current) await notifyDesktopSignedOut()
        hadSession.current = false
        setUser(null)
      }
    } finally {
      setIsLoading(false)
    }
  }, [])

  const signOut = useCallback(async () => {
    try {
      await notifyDesktopSignedOut()
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
      <AccountIdentitySyncContext.Provider value={applyLiveIdentity}>
        {children}
      </AccountIdentitySyncContext.Provider>
    </AuthContext.Provider>
  )
}

function withAccountIdentity(user: AuthUser, identity: AccountIdentityOverlay | null): AuthUser {
  // Never another account's name: after a switch the old account's values are ignored until the new ones arrive.
  if (!identity || identity.userId !== user.id) return user
  return {
    ...user,
    ...(identity.displayName ? { firstName: identity.displayName, lastName: undefined } : {}),
    profilePictureUrl: identity.photoUrl ?? undefined,
  }
}

/** For the live account sync inside the Convex provider: applies the account's name and photo to the signed-in user. */
export function useAccountIdentitySync() {
  return useContext(AccountIdentitySyncContext)
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
