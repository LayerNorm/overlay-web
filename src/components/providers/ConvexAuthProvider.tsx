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

const RETRY_BASE_MS = 1_000
const RETRY_MAX_MS = 30_000

/** Retry delay after `failures` consecutive token failures: 1s, 2s, 4s… capped at 30s. */
export function convexTokenRetryDelay(failures: number): number {
  return Math.min(RETRY_BASE_MS * 2 ** Math.max(0, failures - 1), RETRY_MAX_MS)
}

function useNativeConvexAuth() {
  const { user, isLoading, refreshSession } = useAuth()
  const userId = user?.id ?? null
  // Convex asks a fetcher for a token once; a failed request would leave every live query signed out (and every
  // page waiting on one) until a reload. A new fetcher makes Convex ask again, so a failure schedules one.
  const [retry, setRetry] = useState({ userId, failures: 0, waiting: false })
  const current = retry.userId === userId ? retry : { userId, failures: 0, waiting: false }
  const { failures, waiting } = current
  // One pending retry at a time; a failure while one is waiting changes nothing.
  useEffect(() => {
    if (!waiting) return
    const timer = setTimeout(() => setRetry((state) => ({ userId: state.userId, failures: state.failures + 1, waiting: false })), convexTokenRetryDelay(failures + 1))
    return () => clearTimeout(timer)
  }, [waiting, failures])
  const fetchAccessToken = useMemo(() => createNativeConvexTokenFetcher(userId, refreshSession, () => {
    setRetry((state) => {
      if (state.userId !== userId) return { userId, failures: 0, waiting: true }
      return state.waiting ? state : { ...state, waiting: true }
    })
  // A new fetcher after each failure is what makes Convex ask for a token again.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [userId, refreshSession, failures])
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
