'use client'

import { useWorkspace } from '@/contexts/WorkspaceContext'
import { captureReplyDestination, resolveReplyDestination } from '@/components/desktop/reply-notification-route'
import { useDesktopBridge } from '@/components/desktop/DesktopProvider'
import React, { createContext, useContext, useReducer, useMemo, useCallback, useEffect, useRef } from 'react'

interface StreamingSession {
  id: string
  mode: 'act'
  title: string
  startedAt: number
  messageCountAtStart: number
  status: 'streaming' | 'done'
  notification: { base: string; route: string | null } | null
}

interface AsyncSessionsState {
  sessions: Record<string, StreamingSession>
  unreadCounts: Record<string, number>
  activeViewerIds: { conversation: string | null }
}

type Action =
  | { type: 'START_SESSION'; id: string; mode: 'act'; title: string; messageCountAtStart: number; notification: StreamingSession['notification'] }
  | { type: 'COMPLETE_SESSION'; id: string; isActive: boolean }
  | { type: 'RESOLVE_DESTINATION'; id: string; conversationId: string }
  | { type: 'MARK_READ'; id: string }
  | { type: 'SET_ACTIVE_VIEWER'; id: string | null }

function reducer(state: AsyncSessionsState, action: Action): AsyncSessionsState {
  switch (action.type) {
    case 'START_SESSION': {
      return {
        ...state,
        sessions: {
          ...state.sessions,
          [action.id]: {
            id: action.id,
            mode: action.mode,
            title: action.title,
            startedAt: Date.now(),
            messageCountAtStart: action.messageCountAtStart,
            status: 'streaming',
            notification: action.notification,
          },
        },
      }
    }
    case 'COMPLETE_SESSION': {
      const session = state.sessions[action.id]
      if (!session || session.status === 'done') return state
      const newUnread = action.isActive
        ? state.unreadCounts
        : { ...state.unreadCounts, [action.id]: (state.unreadCounts[action.id] ?? 0) + 1 }
      return {
        ...state,
        sessions: { ...state.sessions, [action.id]: { ...session, status: 'done' } },
        unreadCounts: newUnread,
      }
    }
    case 'RESOLVE_DESTINATION': {
      const session = state.sessions[action.id]
      if (!session?.notification) return state
      const route = resolveReplyDestination(session.notification.base, action.conversationId)
      if (!route || route === session.notification.route) return state
      return { ...state, sessions: { ...state.sessions, [action.id]: {
        ...session, notification: { ...session.notification, route },
      } } }
    }
    case 'MARK_READ': {
      if (!state.unreadCounts[action.id]) return state
      const { [action.id]: _, ...rest } = state.unreadCounts
      void _
      return { ...state, unreadCounts: rest }
    }
    case 'SET_ACTIVE_VIEWER': {
      return {
        ...state,
        activeViewerIds: { conversation: action.id },
      }
    }
    default:
      return state
  }
}

interface AsyncSessionsContextValue {
  startSession(id: string, mode: 'act', title: string, messageCountAtStart: number): void
  completeSession(id: string, isActive: boolean): void
  resolveSession(id: string, conversationId: string): void
  markRead(id: string): void
  setActiveViewer(id: string | null): void
  getUnread(id: string): number
  sessions: Record<string, StreamingSession>
  activeViewerIds: { conversation: string | null }
  totalUnread: number
}

const AsyncSessionsContext = createContext<AsyncSessionsContextValue | null>(null)

const INITIAL_STATE: AsyncSessionsState = {
  sessions: {},
  unreadCounts: {},
  activeViewerIds: { conversation: null },
}

export function AsyncSessionsProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE)
  const desktop = useDesktopBridge()
  const { activeWorkspaceId } = useWorkspace()
  const previous = useRef<Record<string, StreamingSession>>({})
  useEffect(() => {
    if (desktop?.info.capabilities.includes('notifications') && !document.hasFocus()) {
      for (const session of Object.values(state.sessions)) {
        const prior = previous.current[session.id]
        if (session.status !== 'done' || !session.notification?.route || !prior ||
          (prior.status !== 'streaming' && prior.notification?.route)) continue
        void desktop.bridge.call('notifications.show', { title: 'Overlay reply', body: session.title.slice(0, 200), route: session.notification.route }).catch(() => {})
      }
    }
    previous.current = state.sessions
  }, [desktop, state.sessions])

  const startSession = useCallback((id: string, mode: 'act', title: string, messageCountAtStart: number) => {
    dispatch({ type: 'START_SESSION', id, mode, title, messageCountAtStart,
      notification: activeWorkspaceId ? captureReplyDestination(activeWorkspaceId, window.location.href, id) : null })
  }, [activeWorkspaceId])

  const resolveSession = useCallback((id: string, conversationId: string) => {
    dispatch({ type: 'RESOLVE_DESTINATION', id, conversationId })
  }, [])

  const completeSession = useCallback((id: string, isActive: boolean) => {
    dispatch({ type: 'COMPLETE_SESSION', id, isActive })
  }, [])

  const markRead = useCallback((id: string) => {
    dispatch({ type: 'MARK_READ', id })
  }, [])

  const setActiveViewer = useCallback((id: string | null) => {
    dispatch({ type: 'SET_ACTIVE_VIEWER', id })
  }, [])

  const value = useMemo<AsyncSessionsContextValue>(() => ({
    startSession,
    completeSession,
    resolveSession,
    markRead,
    setActiveViewer,
    getUnread: (id: string) => state.unreadCounts[id] ?? 0,
    sessions: state.sessions,
    activeViewerIds: state.activeViewerIds,
    totalUnread: Object.values(state.unreadCounts).reduce((sum, n) => sum + n, 0),
  }), [state, startSession, completeSession, resolveSession, markRead, setActiveViewer])

  return (
    <AsyncSessionsContext.Provider value={value}>
      {children}
    </AsyncSessionsContext.Provider>
  )
}

export function useAsyncSessions(): AsyncSessionsContextValue {
  const ctx = useContext(AsyncSessionsContext)
  if (!ctx) throw new Error('useAsyncSessions must be used within AsyncSessionsProvider')
  return ctx
}
