'use client'

import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { ConvexProviderWithAuth } from 'convex/react'
import {
  createConvexReactClient,
  convexReactClientEnabled,
} from '@/components/providers/convex-react-client'
import { useAuth } from '@/contexts/AuthContext'
import { createNativeConvexTokenFetcher } from './native-convex-token-broker'

const ConvexClientContext = createContext(false)

export function ConvexAuthProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  if (!convexReactClientEnabled) {
    return (
      <ConvexClientContext.Provider value={false}>
        {children}
      </ConvexClientContext.Provider>
    )
  }
  // Remount query caches and transient children before another identity can render.
  return (
    <ConvexIdentityScope key={user ? `user:${user.id}` : 'anonymous'}>
      {children}
    </ConvexIdentityScope>
  )
}

function useNativeConvexAuth() {
  const { user, isLoading, refreshSession } = useAuth()
  const userId = user?.id ?? null
  const fetchAccessToken = useMemo(() => createNativeConvexTokenFetcher(userId, refreshSession), [userId, refreshSession])
  return useMemo(() => ({ isLoading, isAuthenticated: Boolean(userId), fetchAccessToken }), [isLoading, userId, fetchAccessToken])
}

function ConvexIdentityScope({ children }: { children: React.ReactNode }) {
  const [client] = useState(createConvexReactClient)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    return () => {
      // Strict Mode replays effects; only close if the identity scope stays unmounted.
      closeTimer.current = setTimeout(() => { void client?.close() }, 0)
    }
  }, [client])

  const content = (
    <ConvexClientContext.Provider value={Boolean(client)}>
      {children}
    </ConvexClientContext.Provider>
  )
  if (!client) return content
  return <ConvexProviderWithAuth client={client} useAuth={useNativeConvexAuth}>{content}</ConvexProviderWithAuth>
}

export function useHasConvexClient(): boolean {
  return useContext(ConvexClientContext)
}
