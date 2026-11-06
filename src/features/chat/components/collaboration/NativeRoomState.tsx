'use client'

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { useQueries, useQuery } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'
import { useNativeCollaboration } from './NativeCollaborationProvider'
import { useNativeRoomStateClient, type RoomAction } from '@/components/providers/native-room-state-client'
import { useNativePresence } from './useNativePresence'
import { settleIntents } from '@/components/providers/native-intent-overlays'

export type RoomState = NonNullable<FunctionReturnType<typeof api.collaboration.nativeRoomState.getRoomState>>
type Reactions = NonNullable<FunctionReturnType<typeof api.collaboration.nativeRoomState.listReactions>>
export type RoomSnapshot = RoomState & { reactions: Reactions }
export type RoomOverlay = { id: string; at: number; action: RoomAction; settled?: boolean }

export function applyRoomOverlay(state: RoomSnapshot, entry: RoomOverlay): RoomSnapshot {
  const a = entry.action
  const common = { conversationId: state.conversationId, createdAt: entry.at }
  switch (a.kind) {
    case 'setReaction': {
      const old = state.reactions.find(row => row.messageId === a.messageId && row.emoji === a.emoji)
      const ids = new Set(old?.principalIds)
      if (a.enabled) ids.add(state.viewerPrincipalId); else ids.delete(state.viewerPrincipalId)
      const reactions = state.reactions.filter(row => row !== old)
      if (ids.size) reactions.push({ conversationId: state.conversationId, messageId: a.messageId as Id<'conversationMessages'>, emoji: a.emoji,
        principalIds: [...ids], count: ids.size, reactedByCurrentPrincipal: ids.has(state.viewerPrincipalId) })
      return { ...state, reactions }
    }
    case 'setPinned': return { ...state, pins: [...state.pins.filter(row => row.messageId !== a.messageId), ...(a.pinned ? [{ ...common, messageId: a.messageId as Id<'conversationMessages'>, pinnedByPrincipalId: state.viewerPrincipalId }] : [])] }
    case 'setSaved': return { ...state, savedMessages: [...state.savedMessages.filter(row => row.messageId !== a.messageId), ...(a.saved ? [{ ...common, messageId: a.messageId as Id<'conversationMessages'>, principalId: state.viewerPrincipalId }] : [])] }
    case 'setThreadFollow': return { ...state, follows: [...state.follows.filter(row => row.threadRootMessageId !== a.threadRootMessageId), ...(a.followed ? [{ conversationId: state.conversationId, threadRootMessageId: a.threadRootMessageId as Id<'conversationMessages'>, principalId: state.viewerPrincipalId, followedAt: entry.at }] : [])] }
    case 'setNotificationLevel': return { ...state, viewerState: { ...state.viewerState, notificationLevel: a.notificationLevel }, participants: state.participants.map(row => row.principalId === state.viewerPrincipalId ? { ...row, notificationLevel: a.notificationLevel } : row) }
    case 'setRoomArchived': {
      const archivedAt = a.archived ? entry.at : undefined
      return { ...state, viewerState: { ...state.viewerState, archivedAt }, participants: state.participants.map(row => a.scope === 'everyone' || row.principalId === state.viewerPrincipalId ? { ...row, archivedAt } : row) }
    }
    case 'removeParticipant': return { ...state, participants: state.participants.filter(row => row.principalId !== a.principalId) }
    case 'addParticipant': return state.participants.some(row => row.principalId === a.principalId) ? state : { ...state, participants: [...state.participants,
      { ...state.participants[0], email: undefined, photoUrl: undefined, lastReadAt: undefined, lastReadSequence: undefined, markedUnreadAt: undefined, removedAt: undefined, archivedAt: undefined,
        conversationId: state.conversationId, workspaceId: state.workspaceId, principalId: a.principalId, principalType: 'human', displayName: 'Adding participant…',
        role: 'member', status: 'active', notificationLevel: 'all', joinedAt: entry.at, updatedAt: entry.at }] }
  }
}

const EMPTY_QUERIES = {}

function reactionQueries(workspaceId: string, conversationId: string, messageIds: string[], enabled: boolean) {
  const groups: Record<string, { query: typeof api.collaboration.nativeRoomState.listReactions; args: { workspaceId: string; conversationId: Id<'conversations'>; messageIds: Id<'conversationMessages'>[] } }> = {}
  if (!enabled || !messageIds.length) return EMPTY_QUERIES
  const unique = [...new Set(messageIds)]
  for (let i = 0; i < unique.length; i += 100) groups[`batch${i}`] = { query: api.collaboration.nativeRoomState.listReactions,
    args: { workspaceId, conversationId: conversationId as Id<'conversations'>, messageIds: unique.slice(i, i + 100) as Id<'conversationMessages'>[] } }
  return groups
}

const RoomStateContext = createContext<ReturnType<typeof useRoomStateOwner> | null>(null)
export const useNativeRoomMetadata = () => useContext(RoomStateContext)

function useRoomStateOwner(workspaceId: string, conversationId: string, messageIds: string[]) {
  const native = useNativeCollaboration()
  const client = useNativeRoomStateClient()
  const data = useQuery(api.collaboration.nativeRoomState.getRoomState, { workspaceId, conversationId: conversationId as Id<'conversations'> })
  const allowed = Boolean(data && data.workspaceId === workspaceId && data.conversationId === conversationId && data.viewerUserId === native.viewerUserId)
  const messageIdsKey = JSON.stringify(messageIds)
  const queries = useMemo(() => reactionQueries(workspaceId, conversationId, JSON.parse(messageIdsKey) as string[], allowed), [workspaceId, conversationId, messageIdsKey, allowed])
  const results = Object.values(useQueries(queries)) as Array<Reactions | null | undefined | Error>
  const error = results.find(row => row instanceof Error)
  if (error instanceof Error) throw error
  const reactions = results.flatMap(row => Array.isArray(row) ? row : []).filter(row => row.conversationId === conversationId && messageIds.includes(row.messageId))
    .map(row => ({ ...row, reactedByCurrentPrincipal: row.principalIds.includes(data?.viewerPrincipalId ?? '') }))
  const presence = useNativePresence(workspaceId, conversationId, allowed)
  const [entries, setEntries] = useState<RoomOverlay[]>([])
  const canonical: RoomSnapshot | null = allowed && data && !results.includes(null) ? { ...data, reactions } : null
  const snapshot = canonical ? entries.reduce(applyRoomOverlay, canonical) : null
  const act = useCallback(async (action: RoomAction) => {
    const id = crypto.randomUUID()
    setEntries(current => [...current, { id, at: Date.now(), action }])
    let committed = false
    try { const result = await client.act(conversationId, action); committed = true; return result }
    finally { setEntries(current => action.kind === 'setRoomArchived'
      ? [...current.filter(row => row.action.kind !== 'setRoomArchived'), ...settleIntents(current.filter(row => row.action.kind === 'setRoomArchived'), id, committed)]
      : current.filter(row => row.id !== id)) }
  }, [client, conversationId])
  const heartbeat = useCallback((payload: Parameters<typeof client.heartbeat>[1]) => client.heartbeat(conversationId, payload), [client, conversationId])
  return { snapshot, presence: snapshot ? presence : [], act, heartbeat, revoked: data === null || results.includes(null) }
}

export function NativeRoomStateProvider({ children, workspaceId, conversationId, messageIds }: { children: ReactNode; workspaceId: string; conversationId: string; messageIds: string[] }) {
  const owner = useRoomStateOwner(workspaceId, conversationId, messageIds)
  if (owner.revoked) return <div role="status">This conversation is unavailable.</div>
  return <RoomStateContext.Provider value={owner}>{children}</RoomStateContext.Provider>
}
