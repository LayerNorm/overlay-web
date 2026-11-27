import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { AppState, Linking } from 'react-native'
import {
  type AuthSession,
  type AuthUser,
  clearAuthSession,
  clearAuthSessionIfCurrent,
  completeNativeAuthCallback,
  consumeTransferToken,
  extractTransferToken,
  loadAuthSession,
  refreshAuthSession,
  saveAuthSession,
  saveNativeAuthSession,
  saveRefreshedAuthSessionIfCurrent,
} from '../services/authService'
import { clearBootstrapCache } from '../services/bootstrapService'
import { unregisterPushRegistration } from '../services/pushRegistrationService'
import { getAccountDeletionState, isAccountDeletionCallback } from '../services/accountDeletionService'
import { clearUiSettingsCache } from '../services/settingsService'
import { clearVoiceAuthSessionFromAppGroup, disableBackgroundVoice } from '../services/voiceService'

interface AuthContextValue {
  user: AuthUser | null
  session: AuthSession | null
  isLoading: boolean
  isAuthenticated: boolean
  authError: string | null
  refreshSession: () => Promise<void>
  completeNativeSignIn: (session: AuthSession) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Authentication failed'
}

function isInvalidOrExpiredSessionError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase()
  return message.includes('invalid') || message.includes('expired')
}

export function AuthProvider({
  children,
}: {
  children: React.ReactNode
}): React.ReactElement {
  const [session, setSession] = useState<AuthSession | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)
  const sessionRef = useRef<AuthSession | null>(null)
  const authGenerationRef = useRef(0)
  const loadingOperationRef = useRef(0)
  const explicitRefreshRef = useRef<Promise<void> | null>(null)
  const appStateRefreshRef = useRef<{
    generation: number
    ownerId: string | null
    request: Promise<void>
  } | null>(null)

  const applySignedOutState = useCallback(() => {
    sessionRef.current = null
    setSession(null)
  }, [])

  const hydrateSession = useCallback(async (nextSession: AuthSession) => {
    sessionRef.current = nextSession
    setSession(nextSession)
  }, [])

  const restoreStoredSession = useCallback(async (generation: number) => {
    console.log('[AuthContext] restoreStoredSession: start')
    const storedSession = await loadAuthSession()
    if (generation !== authGenerationRef.current) return

    if (!storedSession) {
      console.log('[AuthContext] restoreStoredSession: no stored session, signing out')
      applySignedOutState()
      return
    }

    try {
      const nextSession = await refreshAuthSession(storedSession)
      if (generation !== authGenerationRef.current) return
      const currentSession = await saveRefreshedAuthSessionIfCurrent(nextSession, storedSession)
      if (generation !== authGenerationRef.current) return
      if (currentSession?.user.id === storedSession.user.id) await hydrateSession(currentSession)
    } catch (error) {
      const message = getErrorMessage(error)
      if (generation !== authGenerationRef.current) return
      if (isInvalidOrExpiredSessionError(error)) {
        const cleared = await clearAuthSessionIfCurrent(storedSession)
        if (generation !== authGenerationRef.current) return
        if (cleared) {
          applySignedOutState()
          setAuthError(message)
          return
        }
      }

      const currentSession = await loadAuthSession()
      if (
        generation === authGenerationRef.current &&
        currentSession?.user.id === storedSession.user.id
      ) {
        await hydrateSession(currentSession)
      }
    }
  }, [applySignedOutState, hydrateSession])

  const validateStoredSession = useCallback(async (generation: number) => {
    const storedSession = await loadAuthSession()
    if (generation !== authGenerationRef.current) return
    if (!storedSession) {
      applySignedOutState()
      return
    }

    try {
      const nextSession = await refreshAuthSession(storedSession)
      if (generation !== authGenerationRef.current) return
      const currentSession = await saveRefreshedAuthSessionIfCurrent(nextSession, storedSession)
      if (generation !== authGenerationRef.current) return
      if (currentSession?.user.id === storedSession.user.id) await hydrateSession(currentSession)
    } catch (error) {
      const message = getErrorMessage(error)
      if (generation !== authGenerationRef.current) return
      if (isInvalidOrExpiredSessionError(error)) {
        const cleared = await clearAuthSessionIfCurrent(storedSession)
        if (generation !== authGenerationRef.current) return
        if (cleared) {
          applySignedOutState()
          setAuthError(message)
          return
        }
      }

      const currentSession = await loadAuthSession()
      if (
        generation === authGenerationRef.current &&
        currentSession?.user.id === storedSession.user.id
      ) await hydrateSession(currentSession)
    }
  }, [applySignedOutState, hydrateSession])

  const consumeIncomingUrl = useCallback(
    async (url: string): Promise<boolean> => {
      if (getAccountDeletionState().busy || isAccountDeletionCallback(url)) return false
      let generation = authGenerationRef.current
      try {
        console.log('[AuthContext] consumeIncomingUrl: received callback')
        const token = extractTransferToken(url)
        if (!token) {
          const nativeSession = await completeNativeAuthCallback(url)
          if (!nativeSession) {
            console.log('[AuthContext] consumeIncomingUrl: no auth payload found, ignoring')
            return false
          }
          if (generation !== authGenerationRef.current) return true

          generation = ++authGenerationRef.current
          const savedSession = await saveNativeAuthSession(nativeSession)
          if (generation !== authGenerationRef.current) return true
          await hydrateSession(savedSession)
          console.log('[AuthContext] consumeIncomingUrl: native session established for user', nativeSession.user?.id)
          return true
        }

        generation = ++authGenerationRef.current
        console.log('[AuthContext] consumeIncomingUrl: transfer token extracted, consuming...')
        setAuthError(null)
        const transferredSession = await consumeTransferToken(token)
        if (generation !== authGenerationRef.current) return true
        await saveAuthSession(transferredSession)
        if (generation !== authGenerationRef.current) return true
        await hydrateSession(transferredSession)
        console.log('[AuthContext] consumeIncomingUrl: session established for user', transferredSession.user?.id)
        return true
      } catch (error) {
        if (generation !== authGenerationRef.current) return true
        setAuthError(getErrorMessage(error))
        throw error
      }
    },
    [hydrateSession],
  )

  const refreshSession = useCallback(() => {
    if (explicitRefreshRef.current) return explicitRefreshRef.current

    const generation = authGenerationRef.current
    const loadingOperation = ++loadingOperationRef.current
    const request = (async () => {
      setIsLoading(true)
      setAuthError(null)

      try {
        await validateStoredSession(generation)
      } catch (error) {
        if (generation === authGenerationRef.current) {
          applySignedOutState()
          setAuthError(getErrorMessage(error))
        }
      } finally {
        if (loadingOperation === loadingOperationRef.current) setIsLoading(false)
      }
    })()
    explicitRefreshRef.current = request
    void request.finally(() => {
      if (explicitRefreshRef.current === request) explicitRefreshRef.current = null
    }).catch(() => undefined)
    return request
  }, [applySignedOutState, validateStoredSession])

  const refreshEstablishedSession = useCallback(async () => {
    const generation = authGenerationRef.current
    const ownerId = sessionRef.current?.user.id
    if (!ownerId) return

    const storedSession = await loadAuthSession()
    if (
      generation !== authGenerationRef.current ||
      sessionRef.current?.user.id !== ownerId
    ) return
    if (!storedSession || storedSession.user.id !== ownerId) {
      applySignedOutState()
      return
    }

    try {
      const nextSession = await refreshAuthSession(storedSession)
      if (generation !== authGenerationRef.current || sessionRef.current?.user.id !== ownerId) return
      const currentSession = await saveRefreshedAuthSessionIfCurrent(nextSession, storedSession)
      if (generation !== authGenerationRef.current || sessionRef.current?.user.id !== ownerId) return
      if (currentSession?.user.id === ownerId) {
        await hydrateSession(currentSession)
      } else {
        applySignedOutState()
      }
    } catch (error) {
      if (generation !== authGenerationRef.current || sessionRef.current?.user.id !== ownerId) return
      const message = getErrorMessage(error)
      if (isInvalidOrExpiredSessionError(error)) {
        const cleared = await clearAuthSessionIfCurrent(storedSession)
        if (generation !== authGenerationRef.current || sessionRef.current?.user.id !== ownerId) return
        if (cleared) {
          applySignedOutState()
          setAuthError(message)
          return
        }
      }

      const currentSession = await loadAuthSession()
      if (generation !== authGenerationRef.current || sessionRef.current?.user.id !== ownerId) return
      if (currentSession?.user.id === ownerId) await hydrateSession(currentSession)
      else applySignedOutState()
    }
  }, [applySignedOutState, hydrateSession])

  const refreshFromAppState = useCallback((isAuthLoading: boolean) => {
    const generation = authGenerationRef.current
    const ownerId = sessionRef.current?.user.id ?? null
    const currentFlight = appStateRefreshRef.current
    if (currentFlight?.generation === generation && currentFlight.ownerId === ownerId) return currentFlight.request

    let request: Promise<void>
    if (sessionRef.current) request = refreshEstablishedSession()
    else if (isAuthLoading) request = Promise.resolve()
    else request = refreshSession()
    const flight = { generation, ownerId, request }
    appStateRefreshRef.current = flight
    void request.finally(() => {
      if (appStateRefreshRef.current === flight) appStateRefreshRef.current = null
    }).catch(() => undefined)
    return request
  }, [refreshEstablishedSession, refreshSession])

  const signOut = useCallback(async () => {
    const generation = ++authGenerationRef.current
    const loadingOperation = ++loadingOperationRef.current
    setIsLoading(true)
    try {
      const current = await loadAuthSession()
      if (generation !== authGenerationRef.current) return
      if (current) await unregisterPushRegistration(current.user.id)
      if (generation !== authGenerationRef.current) return
      await clearAuthSession()
      if (generation !== authGenerationRef.current) return
      await Promise.allSettled([
        clearBootstrapCache(),
        clearUiSettingsCache(),
        disableBackgroundVoice(),
        clearVoiceAuthSessionFromAppGroup(),
      ])
      if (generation !== authGenerationRef.current) return
      applySignedOutState()
      setAuthError(null)
    } finally {
      if (loadingOperation === loadingOperationRef.current) setIsLoading(false)
    }
  }, [applySignedOutState])

  const completeNativeSignIn = useCallback(
    async (nextSession: AuthSession) => {
      if (getAccountDeletionState().busy) throw new Error('Finish the account action before signing in.')
      const generation = ++authGenerationRef.current
      const loadingOperation = ++loadingOperationRef.current
      setIsLoading(true)
      try {
        const savedSession = await saveNativeAuthSession(nextSession)
        if (generation !== authGenerationRef.current) return
        await hydrateSession(savedSession)
        setAuthError(null)
      } finally {
        if (loadingOperation === loadingOperationRef.current) setIsLoading(false)
      }
    },
    [hydrateSession],
  )

  useEffect(() => {
    let isMounted = true

    async function bootstrap(): Promise<void> {
      const generation = authGenerationRef.current
      const loadingOperation = ++loadingOperationRef.current
      console.log('[AuthContext] bootstrap: start')
      setIsLoading(true)
      setAuthError(null)

      try {
        const initialUrl = await Linking.getInitialURL()
        if (!isMounted || generation !== authGenerationRef.current) return
        console.log('[AuthContext] bootstrap: initial callback present =', Boolean(initialUrl))
        const didConsumeTransfer = initialUrl ? await consumeIncomingUrl(initialUrl) : false
        console.log('[AuthContext] bootstrap: didConsumeTransfer =', didConsumeTransfer)

        if (!didConsumeTransfer) {
          await restoreStoredSession(generation)
        }
      } catch (error) {
        console.error('[AuthContext] bootstrap: error -', getErrorMessage(error), error)
        if (isMounted && generation === authGenerationRef.current) {
          applySignedOutState()
          setAuthError(getErrorMessage(error))
        }
      } finally {
        if (isMounted && loadingOperation === loadingOperationRef.current) {
          console.log('[AuthContext] bootstrap: done, isAuthenticated will update via session state')
          setIsLoading(false)
        }
      }
    }

    void bootstrap()

    const subscription = Linking.addEventListener('url', (event) => {
      if (getAccountDeletionState().busy || isAccountDeletionCallback(event.url)) return
      console.log('[AuthContext] Linking event: received callback')
      const loadingOperation = ++loadingOperationRef.current
      setIsLoading(true)
      setAuthError(null)

      void consumeIncomingUrl(event.url)
        .catch((error) => {
          console.error('[AuthContext] Linking event: consumeIncomingUrl error -', getErrorMessage(error), error)
        })
        .finally(() => {
          if (isMounted && loadingOperation === loadingOperationRef.current) {
            setIsLoading(false)
          }
        })
    })

    return () => {
      isMounted = false
      authGenerationRef.current++
      loadingOperationRef.current++
      subscription.remove()
    }
  }, [applySignedOutState, consumeIncomingUrl, restoreStoredSession])

  // Refresh the session when the app comes back from background so that
  // expired access tokens are rotated without interrupting an established session.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'active') {
        console.log('[AuthContext] App became active, refreshing session')
        void refreshFromAppState(isLoading)
      }
    })
    return () => subscription.remove()
  }, [isLoading, refreshFromAppState])

  const user = useMemo<AuthUser | null>(() => session?.user ?? null, [session])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      session,
      isLoading,
      isAuthenticated: !!user?.id,
      authError,
      refreshSession,
      completeNativeSignIn,
      signOut,
    }),
    [authError, completeNativeSignIn, isLoading, refreshSession, session, signOut, user],
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
