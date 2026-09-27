'use client'

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'

type NavigationProgressScope = 'primary' | 'secondary'

interface NavigationProgressState {
  active: boolean
  scope: NavigationProgressScope
  token: number
}

interface NavigationProgressContextValue {
  begin(scope: NavigationProgressScope): number
  done(token?: number): void
  state: NavigationProgressState
}

const NavigationProgressContext = createContext<NavigationProgressContextValue | null>(null)

const INITIAL_STATE: NavigationProgressState = {
  active: false,
  scope: 'primary',
  token: 0,
}

export function NavigationProgressProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [state, setState] = useState<NavigationProgressState>(INITIAL_STATE)
  const pathnameRef = useRef<string | null>(null)
  const startedAtRef = useRef<number>(0)
  const doneTimeoutRef = useRef<number | null>(null)
  const tokenCounterRef = useRef(0)

  const begin = useCallback((scope: NavigationProgressScope) => {
    if (doneTimeoutRef.current != null) {
      window.clearTimeout(doneTimeoutRef.current)
      doneTimeoutRef.current = null
    }
    startedAtRef.current = performance.now()
    tokenCounterRef.current += 1
    const token = tokenCounterRef.current
    setState({ active: true, scope, token })
    return token
  }, [])

  const done = useCallback((token?: number) => {
    const finish = () => {
      setState((prev) => {
        if (!prev.active) return prev
        if (token != null && prev.token !== token) return prev
        return { ...prev, active: false }
      })
    }

    const elapsed = performance.now() - startedAtRef.current
    const minimumVisibleMs = 180
    if (elapsed < minimumVisibleMs) {
      const waitMs = minimumVisibleMs - elapsed
      if (doneTimeoutRef.current != null) {
        window.clearTimeout(doneTimeoutRef.current)
      }
      doneTimeoutRef.current = window.setTimeout(() => {
        doneTimeoutRef.current = null
        finish()
      }, waitMs)
      return
    }

    finish()
  }, [])

  useEffect(() => {
    return () => {
      if (doneTimeoutRef.current != null) {
        window.clearTimeout(doneTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (pathnameRef.current == null) {
      pathnameRef.current = pathname
      return
    }

    if (pathnameRef.current === pathname) return
    pathnameRef.current = pathname

    if (!state.active || state.scope !== 'primary') return

    const token = state.token
    const timeoutId = window.setTimeout(() => done(token), 420)
    return () => window.clearTimeout(timeoutId)
  }, [pathname, state.active, state.scope, state.token, done])

  const value = useMemo<NavigationProgressContextValue>(() => ({
    begin,
    done,
    state,
  }), [begin, done, state])

  return (
    <NavigationProgressContext.Provider value={value}>
      {children}
    </NavigationProgressContext.Provider>
  )
}

export function useNavigationProgress(): NavigationProgressContextValue {
  const ctx = useContext(NavigationProgressContext)
  if (!ctx) throw new Error('useNavigationProgress must be used within NavigationProgressProvider')
  return ctx
}

export function NavigationProgressBar() {
  const { state } = useNavigationProgress()

  return (
    <div
      className={`pointer-events-none fixed top-16 right-0 z-[80] h-[3px] overflow-hidden transition-opacity duration-200 ${
        state.active ? 'opacity-100' : 'opacity-0'
      } ${state.scope === 'primary' ? 'left-0' : 'left-56'}`}
      aria-hidden="true"
    >
      <div className="absolute inset-0 bg-[#ef4444]/10" />
      <div
        key={state.token}
        className="navigation-progress-indicator absolute inset-y-0 rounded-full bg-[#ef4444]"
      />
    </div>
  )
}
