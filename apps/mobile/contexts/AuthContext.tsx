import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState
} from 'react'
import { Linking } from 'react-native'
import {
  AuthEntitlements,
  AuthProfile,
  AuthSession,
  AuthUser,
  clearAuthSession,
  consumeTransferToken,
  extractTransferToken,
  getEntitlements,
  getUserProfile,
  loadAuthSession,
  refreshAuthSession,
  saveAuthSession,
  syncUserProfile
} from '../services/authService'

interface AuthContextValue {
  user: AuthUser | null
  session: AuthSession | null
  profile: AuthProfile | null
  entitlements: AuthEntitlements | null
  isLoading: boolean
  isAuthenticated: boolean
  authError: string | null
  refreshSession: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Authentication failed'
}

export function AuthProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [session, setSession] = useState<AuthSession | null>(null)
  const [profile, setProfile] = useState<AuthProfile | null>(null)
  const [entitlements, setEntitlements] = useState<AuthEntitlements | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)

  const applySignedOutState = useCallback(() => {
    setSession(null)
    setProfile(null)
    setEntitlements(null)
  }, [])

  const hydrateSession = useCallback(async (nextSession: AuthSession) => {
    setSession(nextSession)

    try {
      await syncUserProfile(nextSession)
    } catch {
      // Convex sync is additive. Keep the session even if the profile sync is unavailable.
    }

    try {
      const [nextProfile, nextEntitlements] = await Promise.all([
        getUserProfile(nextSession),
        getEntitlements(nextSession)
      ])

      setProfile(nextProfile)
      setEntitlements(nextEntitlements)
    } catch {
      setProfile(null)
      setEntitlements(null)
    }
  }, [])

  const restoreStoredSession = useCallback(async () => {
    const storedSession = await loadAuthSession()

    if (!storedSession) {
      applySignedOutState()
      return
    }

    let nextSession = storedSession

    try {
      nextSession = await refreshAuthSession(storedSession)
      await saveAuthSession(nextSession)
    } catch (error) {
      const message = getErrorMessage(error)
      if (message.toLowerCase().includes('invalid') || message.toLowerCase().includes('expired')) {
        await clearAuthSession()
        applySignedOutState()
        setAuthError(message)
        return
      }
    }

    await hydrateSession(nextSession)
  }, [applySignedOutState, hydrateSession])

  const consumeIncomingUrl = useCallback(
    async (url: string): Promise<boolean> => {
      const token = extractTransferToken(url)
      if (!token) {
        return false
      }

      setAuthError(null)
      const transferredSession = await consumeTransferToken(token)
      await saveAuthSession(transferredSession)
      await hydrateSession(transferredSession)
      return true
    },
    [hydrateSession]
  )

  const refreshSession = useCallback(async () => {
    setIsLoading(true)
    setAuthError(null)

    try {
      await restoreStoredSession()
    } catch (error) {
      applySignedOutState()
      setAuthError(getErrorMessage(error))
    } finally {
      setIsLoading(false)
    }
  }, [applySignedOutState, restoreStoredSession])

  const signOut = useCallback(async () => {
    await clearAuthSession()
    applySignedOutState()
    setAuthError(null)
  }, [applySignedOutState])

  useEffect(() => {
    let isMounted = true

    async function bootstrap(): Promise<void> {
      setIsLoading(true)
      setAuthError(null)

      try {
        const initialUrl = await Linking.getInitialURL()
        const didConsumeTransfer = initialUrl ? await consumeIncomingUrl(initialUrl) : false

        if (!didConsumeTransfer) {
          await restoreStoredSession()
        }
      } catch (error) {
        if (isMounted) {
          applySignedOutState()
          setAuthError(getErrorMessage(error))
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    bootstrap()

    const subscription = Linking.addEventListener('url', (event) => {
      setIsLoading(true)
      setAuthError(null)

      void consumeIncomingUrl(event.url)
        .catch((error) => {
          if (isMounted) {
            setAuthError(getErrorMessage(error))
          }
        })
        .finally(() => {
          if (isMounted) {
            setIsLoading(false)
          }
        })
    })

    return () => {
      isMounted = false
      subscription.remove()
    }
  }, [applySignedOutState, consumeIncomingUrl, restoreStoredSession])

  const user = useMemo<AuthUser | null>(() => {
    if (!session) {
      return null
    }

    if (!profile?.profile) {
      return session.user
    }

    return {
      ...session.user,
      email: profile.profile.email,
      firstName: profile.profile.firstName || session.user.firstName,
      lastName: profile.profile.lastName || session.user.lastName,
      profilePictureUrl: profile.profile.profilePictureUrl || session.user.profilePictureUrl
    }
  }, [profile, session])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      session,
      profile,
      entitlements,
      isLoading,
      isAuthenticated: !!user?.id,
      authError,
      refreshSession,
      signOut
    }),
    [authError, entitlements, isLoading, profile, refreshSession, session, signOut, user]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)

  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }

  return context
}
