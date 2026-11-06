'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useConvex, useConvexAuth, useMutation, usePaginatedQuery } from 'convex/react'
import { api } from '../../../../../convex/_generated/api'
import { useConvexAuthConfiguration } from '@/components/providers/ConvexAuthProvider'
import { PersonalChatErrorBoundary } from '@/components/providers/personal-chat-error-boundary'
import { useAuth } from '@/contexts/AuthContext'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { NativeCollaborationContext, emptyNativeCollaboration as empty, nativeCollaborationUnavailable as unavailable,
  type NativeCollaborationValue as Value } from '@/components/providers/native-collaboration-context'
export { useNativeCollaboration } from '@/components/providers/native-collaboration-context'
export type { NativeCollaborationStatus, NativeRoomList, NativeRoomSummary } from '@/components/providers/native-collaboration-context'

export function NativeCollaborationProvider({ children, backendReady = false }: { children: ReactNode; backendReady?: boolean }) {
  const configuration = useConvexAuthConfiguration()
  const workspace = useWorkspace()
  const { user } = useAuth()
  const workspaceId = workspace.switchingWorkspaceId ? null : workspace.activeWorkspaceId
  const scopeKey = JSON.stringify([user?.id ?? null, workspaceId])
  const configured = backendReady && configuration.nativeAuthConfigured
  const [owned, setOwned] = useState(configured)
  if (configured && !owned) setOwned(true)
  const fallback = { ...empty, scopeKey, workspaceId, viewerUserId: user?.id ?? null, status: 'unavailable' as const }
  if (!configured || !configuration.hasConvexClient) {
    return <NativeCollaborationContext.Provider value={{ ...fallback, status: owned ? 'unavailable' : 'disabled' }}>{children}</NativeCollaborationContext.Provider>
  }
  return <PersonalChatErrorBoundary key={scopeKey} resetKey={scopeKey} context={NativeCollaborationContext} fallbackValue={fallback} fallbackChildren={children}>
    <NativeCollaborationLive workspaceId={workspaceId} scopeKey={scopeKey} viewerUserId={user?.id ?? null}>{children}</NativeCollaborationLive>
  </PersonalChatErrorBoundary>
}

function useRoomList(workspaceId: string | null, canQuery: boolean, kind: 'direct' | 'channel', archived: boolean) {
  const page = usePaginatedQuery(api.collaboration.nativeRooms.listRooms,
    canQuery && workspaceId ? { workspaceId, kind, archived } : 'skip', { initialNumItems: 50 })
  return {
    rows: canQuery ? page.results.filter(row => row.workspaceId === workspaceId && row.kind === kind && (row.archivedAt !== undefined) === archived) : [],
    hasMore: page.status === 'CanLoadMore', loadingMore: page.status === 'LoadingMore',
    loading: page.status === 'LoadingFirstPage', loadMore() { if (page.status === 'CanLoadMore') page.loadMore(50) },
  }
}

function NativeCollaborationLive({ children, workspaceId, scopeKey, viewerUserId }: {
  children: ReactNode; workspaceId: string | null; scopeKey: string; viewerUserId: string | null
}) {
  const current = useRef(true)
  useEffect(() => { current.current = true; return () => { current.current = false } }, [])
  const auth = useConvexAuth()
  const canQuery = Boolean(viewerUserId) && auth.isAuthenticated && !auth.isLoading && Boolean(workspaceId)
  const direct = useRoomList(workspaceId, canQuery, 'direct', false)
  const channels = useRoomList(workspaceId, canQuery, 'channel', false)
  const archivedDirect = useRoomList(workspaceId, canQuery, 'direct', true)
  const archivedChannels = useRoomList(workspaceId, canQuery, 'channel', true)
  const createDirect = useMutation(api.collaboration.nativeRooms.createDirectMessage)
  const createChannel = useMutation(api.collaboration.nativeRooms.createChannel)
  const convex = useConvex()
  const status = auth.isLoading || !workspaceId ? 'loading' : !viewerUserId || !auth.isAuthenticated ? 'unavailable'
    : [direct, channels, archivedDirect, archivedChannels].some(list => list.loading) ? 'loading' : 'ready'
  const value: Value = { status, workspaceId, scopeKey, viewerUserId, direct, channels, archivedDirect, archivedChannels,
    async createDirectMessage(args) {
      if (status !== 'ready' || args.workspaceId !== workspaceId) return unavailable()
      const result = await createDirect(args)
      const room = await convex.query(api.collaboration.nativeRooms.getRoom, { workspaceId: args.workspaceId, conversationId: result.conversationId })
      if (!room || !current.current) return unavailable()
      return { conversationId: result.conversationId, title: room.title, agentId: room.agentId }
    },
    async createChannel(args) {
      if (status !== 'ready' || args.workspaceId !== workspaceId) return unavailable()
      const result = await createChannel(args)
      if (!current.current) return unavailable()
      return { conversationId: result.conversationId, name: args.name }
    },
  }
  return <NativeCollaborationContext.Provider value={value}>{children}</NativeCollaborationContext.Provider>
}
