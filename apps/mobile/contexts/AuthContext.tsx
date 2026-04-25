import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { Linking } from 'react-native'
import {
  type AuthSession,
  type AuthUser,
  clearAuthSession,
  consumeTransferToken,
  extractTransferToken,
  loadAuthSession,
  refreshAuthSession,
  saveAuthSession,
} from '../services/authService'

interface AuthContextValue {
  user: AuthUser | null
  session: AuthSession | null
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

export function AuthProvider({
  children,
}: {
  children: React.ReactNode
}): React.ReactElement {
  const [session, setSession] = useState<AuthSession | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)

  const applySignedOutState = useCallback(() => {
    setSession(null)
  }, [])

  const hydrateSession = useCallback(async (nextSession: AuthSession) => {
    setSession(nextSession)
  }, [])

  const restoreStoredSession = useCallback(async () => {
    console.log('[AuthContext] restoreStoredSession: start')
    const storedSession = await loadAuthSession()

    if (!storedSession) {
      console.log('[AuthContext] restoreStoredSession: no stored session, signing out')
      applySignedOutState()
      return
    }

    console.log('[AuthContext] restoreStoredSession: hydrating stored session for user', storedSession.user?.id)
    await hydrateSession(storedSession)

    void refreshAuthSession(storedSession)
      .then(async (nextSession) => {
        await saveAuthSession(nextSession)
        await hydrateSession(nextSession)
        console.log('[AuthContext] restoreStoredSession: background refresh saved')
      })
      .catch(async (error) => {
        const message = getErrorMessage(error)
        console.warn('[AuthContext] restoreStoredSession: background refresh failed -', message)
        if (message.toLowerCase().includes('invalid') || message.toLowerCase().includes('expired')) {
          console.log('[AuthContext] restoreStoredSession: clearing invalid/expired session')
          await clearAuthSession()
          applySignedOutState()
          setAuthError(message)
        }
      })

  }, [applySignedOutState, hydrateSession])

  const validateStoredSession = useCallback(async () => {
    const storedSession = await loadAuthSession()
    if (!storedSession) {
      applySignedOutState()
      return
    }

    try {
      const nextSession = await refreshAuthSession(storedSession)
      await saveAuthSession(nextSession)
      await hydrateSession(nextSession)
    } catch (error) {
      const message = getErrorMessage(error)
      if (message.toLowerCase().includes('invalid') || message.toLowerCase().includes('expired')) {
        await clearAuthSession()
        applySignedOutState()
        setAuthError(message)
      }
    }
  }, [applySignedOutState, hydrateSession])

  const consumeIncomingUrl = useCallback(
    async (url: string): Promise<boolean> => {
      console.log('[AuthContext] consumeIncomingUrl: received URL =', url)
      const token = extractTransferToken(url)
      if (!token) {
        console.log('[AuthContext] consumeIncomingUrl: no transfer token found, ignoring')
        return false
      }

      console.log('[AuthContext] consumeIncomingUrl: transfer token extracted, consuming...')
      setAuthError(null)
      const transferredSession = await consumeTransferToken(token)
      await saveAuthSession(transferredSession)
      await hydrateSession(transferredSession)
      console.log('[AuthContext] consumeIncomingUrl: session established for user', transferredSession.user?.id)
      return true
    },
    [hydrateSession],
  )

  const refreshSession = useCallback(async () => {
    setIsLoading(true)
    setAuthError(null)

    try {
      await validateStoredSession()
    } catch (error) {
      applySignedOutState()
      setAuthError(getErrorMessage(error))
    } finally {
      setIsLoading(false)
    }
  }, [applySignedOutState, validateStoredSession])

  const signOut = useCallback(async () => {
    await clearAuthSession()
    applySignedOutState()
    setAuthError(null)
  }, [applySignedOutState])

  useEffect(() => {
    let isMounted = true

    async function bootstrap(): Promise<void> {
      console.log('[AuthContext] bootstrap: start')
      setIsLoading(true)
      setAuthError(null)

      try {
        const initialUrl = await Linking.getInitialURL()
        console.log('[AuthContext] bootstrap: initialUrl =', initialUrl)
        const didConsumeTransfer = initialUrl ? await consumeIncomingUrl(initialUrl) : false
        console.log('[AuthContext] bootstrap: didConsumeTransfer =', didConsumeTransfer)

        if (!didConsumeTransfer) {
          await restoreStoredSession()
        }
      } catch (error) {
        console.error('[AuthContext] bootstrap: error -', getErrorMessage(error), error)
        if (isMounted) {
          applySignedOutState()
          setAuthError(getErrorMessage(error))
        }
      } finally {
        if (isMounted) {
          console.log('[AuthContext] bootstrap: done, isAuthenticated will update via session state')
          setIsLoading(false)
        }
      }
    }

    void bootstrap()

    const subscription = Linking.addEventListener('url', (event) => {
      console.log('[AuthContext] Linking event: url =', event.url)
      setIsLoading(true)
      setAuthError(null)

      void consumeIncomingUrl(event.url)
        .catch((error) => {
          console.error('[AuthContext] Linking event: consumeIncomingUrl error -', getErrorMessage(error), error)
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

  const user = useMemo<AuthUser | null>(() => session?.user ?? null, [session])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      session,
      isLoading,
      isAuthenticated: !!user?.id,
      authError,
      refreshSession,
      signOut,
    }),
    [authError, isLoading, refreshSession, session, signOut, user],
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
