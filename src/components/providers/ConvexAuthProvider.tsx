'use client'

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { ConvexProvider } from 'convex/react'
import {
  convexReactClient,
  convexReactClientEnabled,
} from '@/components/providers/convex-react-client'
import { useAuth } from '@/contexts/AuthContext'
import { fetchConvexToken } from '@/components/providers/convex-token-broker'

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
  const { user, isLoading, refreshSession } = useAuth()
  const userId = user?.id ?? null
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const convexEnabled = requiresConvexClient && Boolean(convexReactClient)

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
      const token = await fetchConvexToken(refreshSession).catch(() => null)
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

  // These HS256 tokens are explicit query arguments checked by our handlers.
  // They are not native Convex identity tokens: setAuth would send them to the
  // platform verifier and block realtime subscriptions with an auth error.

  const value = useMemo(() => ({ accessToken }), [accessToken])
  const content = (
    <ConvexAuthContext.Provider value={value}>
      {children}
    </ConvexAuthContext.Provider>
  )

  if (!convexEnabled || !convexReactClient) return content

  return <ConvexProvider client={convexReactClient}>{content}</ConvexProvider>
}

export function useConvexAuthToken(): string | null {
  return useContext(ConvexAuthContext).accessToken
}
