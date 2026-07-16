'use client'

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { ConvexProvider } from 'convex/react'
import {
  convexReactClient,
  convexReactClientEnabled,
} from '@/components/providers/convex-react-client'
import { useAuth } from '@/contexts/AuthContext'

type ConvexAuthContextValue = {
  accessToken: string | null
}

const ConvexAuthContext = createContext<ConvexAuthContextValue>({ accessToken: null })

async function fetchConvexToken(): Promise<string | null> {
  const response = await fetch('/api/auth/convex-token', {
    credentials: 'same-origin',
    cache: 'no-store',
  })
  if (!response.ok) return null
  const data = await response.json() as { token?: string }
  return data.token?.trim() || null
}

export function ConvexAuthProvider({
  children,
  requiresConvexClient = convexReactClientEnabled,
}: {
  children: React.ReactNode
  requiresConvexClient?: boolean
}) {
  const { user, isLoading } = useAuth()
  const userId = user?.id ?? null
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const convexEnabled = requiresConvexClient && Boolean(convexReactClient)

  useEffect(() => {
    let alive = true
    if (!convexEnabled || isLoading || !userId) {
      void Promise.resolve().then(() => {
        if (alive) setAccessToken(null)
      })
      return
    }
    const refresh = async () => {
      const token = await fetchConvexToken().catch(() => null)
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
  }, [convexEnabled, isLoading, userId])

  useEffect(() => {
    if (!convexEnabled || !convexReactClient) return
    convexReactClient.setAuth(async () => {
      if (!convexEnabled || isLoading || !userId) return null
      return await fetchConvexToken()
    })
  }, [convexEnabled, isLoading, userId])

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
