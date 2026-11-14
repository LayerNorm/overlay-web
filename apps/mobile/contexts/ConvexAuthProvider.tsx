import React, { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { ConvexProviderWithAuth, ConvexReactClient, useConvexAuth } from 'convex/react'
import { Text, TouchableOpacity, View } from 'react-native'
import { useAuth } from './AuthContext'
import { loadAuthSession, refreshAuthSession, saveRefreshedAuthSession } from '../services/authService'
import { createNativeConvexTokenFetcher, scheduleConvexTokenRetry } from '../services/nativeConvexTokenBroker'
import { getNativePolicyBlocked, setMobileConvexClient, subscribeNativePolicy } from '../services/convexClient'
import { useTheme } from '../hooks/useTheme'

const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL?.trim()
const NativeDataReadyContext = createContext(false)
export const useNativeDataReady = () => useContext(NativeDataReadyContext)

function NativeDataReady({ children }: { children: React.ReactNode }) {
  const { isLoading, isAuthenticated } = useConvexAuth()
  return <NativeDataReadyContext.Provider value={!isLoading && isAuthenticated}>{children}</NativeDataReadyContext.Provider>
}

function useNativeConvexAuth() {
  const { user, isLoading } = useAuth()
  const userId = user?.id ?? null
  const currentIdentity = useRef(userId)
  currentIdentity.current = userId
  const [retry, setRetry] = useState({ failures: 0, waiting: false })
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])
  useEffect(() => {
    if (!retry.waiting) return
    return scheduleConvexTokenRetry(retry.failures, () => setRetry(state => ({ failures: state.failures + 1, waiting: false })))
  }, [retry])
  const fetchAccessToken = useMemo(() => createNativeConvexTokenFetcher(userId, {
    load: loadAuthSession,
    refresh: refreshAuthSession,
    save: saveRefreshedAuthSession,
    isCurrent: () => alive.current && currentIdentity.current === userId,
    onFailure: () => setRetry(state => state.waiting ? state : { ...state, waiting: true }),
  }), [userId, retry.failures])
  return useMemo(() => ({ isLoading, isAuthenticated: Boolean(userId), fetchAccessToken }), [isLoading, userId, fetchAccessToken])
}

function NativeAvailability({ children }: { children: React.ReactNode }) {
  const blocked = useSyncExternalStore(subscribeNativePolicy, getNativePolicyBlocked, getNativePolicyBlocked)
  const { user, signOut } = useAuth()
  const { theme: colors } = useTheme()
  if (user && (!convexUrl || blocked)) {
    return <View style={{ flex: 1, justifyContent: 'center', padding: 32, backgroundColor: colors.background }}>
      <Text style={{ color: colors.text, fontSize: 20, marginBottom: 12 }}>Workspace unavailable</Text>
      <Text style={{ color: colors.textSecondary, marginBottom: 24 }}>{blocked ? 'Mobile access is not enabled for this workspace. You can continue on the web.' : 'This app needs a workspace connection. Set EXPO_PUBLIC_CONVEX_URL to your workspace backend.'}</Text>
      <TouchableOpacity accessibilityRole="button" onPress={() => void signOut()}><Text style={{ color: colors.text }}>Sign out</Text></TouchableOpacity>
    </View>
  }
  return <>{children}</>
}

function IdentityScope({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => convexUrl ? new ConvexReactClient(convexUrl, { unsavedChangesWarning: false }) : null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    setMobileConvexClient(client)
    setReady(true)
    return () => {
      setMobileConvexClient(null)
      closeTimer.current = setTimeout(() => { void client?.close() }, 0)
    }
  }, [client])
  if (!ready) return null
  const content = <NativeAvailability>{children}</NativeAvailability>
  return client ? <ConvexProviderWithAuth client={client} useAuth={useNativeConvexAuth}><NativeDataReady>{content}</NativeDataReady></ConvexProviderWithAuth> : content
}

export function ConvexAuthProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  return <IdentityScope key={user?.id ?? 'anonymous'}>{children}</IdentityScope>
}
