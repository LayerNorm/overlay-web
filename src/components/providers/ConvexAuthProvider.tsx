'use client'

import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { ConvexProviderWithAuth } from 'convex/react'
import {
  createConvexReactClient,
  convexReactClientEnabled,
} from '@/components/providers/convex-react-client'
import { useAuth } from '@/contexts/AuthContext'
import { fetchConvexToken } from '@/components/providers/convex-token-broker'
import { createNativeConvexTokenFetcher } from './native-convex-token-broker'

type ConvexAuthContextValue = {
  accessToken: string | null
}

const ConvexAuthContext = createContext<ConvexAuthContextValue>({ accessToken: null })

export function ConvexAuthProvider({
  children,
  requiresConvexClient = convexReactClientEnabled,
}: {
  children: React.ReactNode
  requiresConvexClient?: boolean
}) {
  const { user } = useAuth()
  if (!requiresConvexClient || !convexReactClientEnabled) return children
  // Remount query caches and transient children before another identity can render.
  return <ConvexIdentityScope key={user ? `user:${user.id}` : 'anonymous'}>{children}</ConvexIdentityScope>
}

function useNativeConvexAuth() {
  const { user, isLoading, refreshSession } = useAuth()
  const userId = user?.id ?? null
  const fetchAccessToken = useMemo(() => createNativeConvexTokenFetcher(userId, refreshSession), [userId, refreshSession])
  return useMemo(() => ({ isLoading, isAuthenticated: Boolean(userId), fetchAccessToken }), [isLoading, userId, fetchAccessToken])
}

function ConvexIdentityScope({ children }: { children: React.ReactNode }) {
  const { user, isLoading, refreshSession } = useAuth()
  const userId = user?.id ?? null
  const [client] = useState(createConvexReactClient)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const convexEnabled = Boolean(client)

  useEffect(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    return () => {
      // Strict Mode replays effects; only close if the identity scope stays unmounted.
      closeTimer.current = setTimeout(() => { void client?.close() }, 0)
    }
  }, [client])

  // Single token refresh path: fetch via the shared broker and update state.
  // The broker deduplicates in-flight requests so the interval refresh and
  // other callers share the same fetch.
  useEffect(() => {
    let alive = true
    if (!convexEnabled || isLoading || !userId) {
      void Promise.resolve().then(() => {
        if (alive) setAccessToken(null)
      })
      return
    }
    const refresh = async () => {
      const token = await fetchConvexToken(refreshSession, userId).catch(() => null)
      if (alive) setAccessToken(token)
      return token
    }
    void refresh()
    const interval = window.setInterval(() => {
      void refresh()
    }, 4 * 60 * 1000)
    return () => {
      alive = false
      window.clearInterval(interval)
    }
  }, [convexEnabled, isLoading, userId, refreshSession])

  // Unmigrated rooms still use HS256 arguments; native auth receives only the
  // upstream asymmetric identity token through its separate broker.

  const value = useMemo(() => ({ accessToken }), [accessToken])
  const content = (
    <ConvexAuthContext.Provider value={value}>
      {children}
    </ConvexAuthContext.Provider>
  )

  if (!client) return content

  return <ConvexProviderWithAuth client={client} useAuth={useNativeConvexAuth}>{content}</ConvexProviderWithAuth>
}

export function useConvexAuthToken(): string | null {
  return useContext(ConvexAuthContext).accessToken
}
