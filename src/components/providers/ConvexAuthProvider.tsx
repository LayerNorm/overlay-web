'use client'

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { ConvexProvider } from 'convex/react'
import { convexReactClient } from '@/components/providers/convex-react-client'
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

export function ConvexAuthProvider({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth()
  const userId = user?.id ?? null
  const [accessToken, setAccessToken] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    if (isLoading || !userId) {
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
  }, [isLoading, userId])

  useEffect(() => {
    convexReactClient.setAuth(async () => {
      if (isLoading || !userId) return null
      return await fetchConvexToken()
    })
  }, [isLoading, userId])

  const value = useMemo(() => ({ accessToken }), [accessToken])

  return (
    <ConvexProvider client={convexReactClient}>
      <ConvexAuthContext.Provider value={value}>
        {children}
      </ConvexAuthContext.Provider>
    </ConvexProvider>
  )
}

export function useConvexAuthToken(): string | null {
  return useContext(ConvexAuthContext).accessToken
}
