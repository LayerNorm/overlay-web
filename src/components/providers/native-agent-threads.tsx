'use client'

import { createContext, useCallback, useContext, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { usePaginatedQuery } from 'convex/react'
import { useSearchParams } from 'next/navigation'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { useNativeCollaboration } from './native-collaboration-context'

type Overlay = { token: string; archived: boolean }
type Overlays = Record<string, Overlay[]>
type OverlayState = { rows: Overlays; add(id: string, archived: boolean): string; remove(id: string, token: string): void;
  track(token: string): () => void; isPending(token: string): boolean }
const OverlayContext = createContext<OverlayState>({ rows: {},
  add() { throw new Error('Native threads unavailable') }, remove() {}, track: () => () => {}, isPending: () => false })

export function useNativeThreadPending() {
  const native = useNativeCollaboration()
  const params = useSearchParams()
  if (native.status === 'unavailable') return 'failed'
  if (native.status === 'loading') return 'loading'
  return native.status === 'disabled' ? null : params?.get('nativePending') ?? (params?.has('nativeError') ? 'failed' : null)
}

export function NativeThreadOverlayProvider({ children }: { children: ReactNode }) {
  const [rows, setRows] = useState<Overlays>({})
  const pending = useRef(new Set<string>())
  const track = useCallback((token: string) => { pending.current.add(token); return () => { pending.current.delete(token) } }, [])
  const isPending = useCallback((token: string) => pending.current.has(token), [])
  const add = useCallback((id: string, archived: boolean) => {
    const token = crypto.randomUUID()
    setRows(current => ({ ...current, [id]: [...(current[id] ?? []), { token, archived }] }))
    return token
  }, [])
  const remove = useCallback((id: string, token: string) => {
    setRows(current => ({ ...current, [id]: (current[id] ?? []).filter(row => row.token !== token) }))
  }, [])
  return <OverlayContext.Provider value={{ rows, add, remove, track, isPending }}>{children}</OverlayContext.Provider>
}

export function useNativeThreadClient() {
  const native = useNativeCollaboration()
  const { add, remove, track, isPending } = useContext(OverlayContext)
  const { client, status, workspaceId, scopeKey, isCurrentScope } = native
  return useMemo(() => {
    const assert = () => {
      if (!client || status !== 'ready' || !workspaceId || !isCurrentScope?.()) throw new Error('Native agent threads unavailable')
      return { client, workspaceId }
    }
    return { enabled: status !== 'disabled', status, workspaceId, scopeKey, track, isPending,
      async resolve(agentId: string) {
        const ready = assert()
        const result = await ready.client.mutation(api.agents.nativeThreads.resolveMainThread, { workspaceId: ready.workspaceId, agentId })
        assert()
        return result
      },
      async create(agentId: string, clientRequestId: string, title?: string) {
        const ready = assert()
        const result = await ready.client.mutation(api.agents.nativeThreads.createThread, { workspaceId: ready.workspaceId, agentId, clientRequestId, title })
        assert()
        return result
      },
      async archive(agentId: string, conversationId: string, archived: boolean) {
        const ready = assert()
        const token = add(conversationId, archived)
        try {
          await ready.client.mutation(api.agents.nativeThreads.setThreadArchived, { workspaceId: ready.workspaceId, agentId, conversationId: conversationId as Id<'conversations'>, archived })
          assert()
        } finally { remove(conversationId, token) }
      },
      async delete(agentId: string, conversationId: string) {
        const ready = assert()
        await ready.client.mutation(api.agents.nativeThreads.deleteThread, { workspaceId: ready.workspaceId, agentId, conversationId: conversationId as Id<'conversations'> })
        assert()
      },
    }
  }, [add, client, isCurrentScope, isPending, remove, scopeKey, status, track, workspaceId])
}

export function useNativeThreadScope({ workspaceId, agentId, conversationId }: { workspaceId: string | null; agentId: string | null; conversationId: string | null }) {
  const native = useNativeCollaboration()
  const watch = useMemo(() => native.scopeKey && native.status === 'ready' && native.client && workspaceId && workspaceId === native.workspaceId && agentId && conversationId
    ? native.client.watchQuery(api.agents.nativeThreads.getThread, { workspaceId, agentId, conversationId: conversationId as Id<'conversations'> }) : null,
  [agentId, conversationId, native.client, native.scopeKey, native.status, native.workspaceId, workspaceId])
  const subscribe = useCallback((callback: () => void) => watch?.onUpdate(callback) ?? (() => {}), [watch])
  const snapshot = useCallback(() => watch?.localQueryResult(), [watch])
  const row = useSyncExternalStore(subscribe, snapshot, () => undefined)
  const allowed = Boolean(row && row.workspaceId === workspaceId && row.agentId === agentId && row.conversationId === conversationId && row.viewerUserId === native.viewerUserId)
  const pending = Boolean(conversationId && (native.status === 'loading' || (watch && row === undefined)))
  return { enabled: native.status !== 'disabled', allowed, pending,
    error: !conversationId || pending || allowed ? null : 'This thread is not available for this agent.' }
}

export function useNativeThreadList(agentId: string, archived = false) {
  const native = useNativeCollaboration()
  const overlays = useContext(OverlayContext)
  const page = usePaginatedQuery(api.agents.nativeThreads.listThreads, native.status === 'ready' && native.workspaceId
    ? { workspaceId: native.workspaceId, agentId, archived } : 'skip', { initialNumItems: 50 })
  const rows = page.results.filter(row => row.workspaceId === native.workspaceId && row.viewerUserId === native.viewerUserId && row.agentId === agentId)
    .filter(row => (overlays.rows[row.conversationId]?.at(-1)?.archived ?? (row.archivedAt !== undefined)) === archived)
  return { rows, loading: page.status === 'LoadingFirstPage', hasMore: page.status === 'CanLoadMore', loadingMore: page.status === 'LoadingMore',
    loadMore() { if (page.status === 'CanLoadMore') page.loadMore(50) } }
}
