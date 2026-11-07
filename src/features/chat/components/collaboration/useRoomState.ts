'use client'

import { useConvexAuth, useMutation, useQuery } from 'convex/react'
import { useMemo } from 'react'
import type { OptimisticLocalStore } from 'convex/browser'
import type { FunctionReturnType } from 'convex/server'
import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'

export type RoomState = NonNullable<FunctionReturnType<typeof api.collaboration.rooms.state>>
type RoomArgs = { workspaceId: string; conversationId: Id<'conversations'> }

/**
 * Applies a local change to the live room state. Convex discards it when the server answers, so a
 * rejected action rolls back and a concurrent change from another client is never overwritten.
 */
function patchRoomState(store: OptimisticLocalStore, args: RoomArgs, patch: (state: RoomState) => RoomState) {
  const key = { workspaceId: args.workspaceId, conversationId: args.conversationId }
  const current = store.getQuery(api.collaboration.rooms.state, key)
  if (current) store.setQuery(api.collaboration.rooms.state, key, patch(current))
}

/** Participants, reactions, pins, saves, followed threads and presence for one room, live. */
export function useRoomState(workspaceId: string | null | undefined, conversationId: string) {
  const { isAuthenticated, isLoading } = useConvexAuth()
  const args = useMemo<RoomArgs | null>(() => workspaceId && isAuthenticated && !isLoading
    ? { workspaceId, conversationId: conversationId as Id<'conversations'> }
    : null, [workspaceId, conversationId, isAuthenticated, isLoading])
  const state = useQuery(api.collaboration.rooms.state, args ?? 'skip')

  const setReaction = useMutation(api.collaboration.rooms.setReaction).withOptimisticUpdate((store, change) => {
    patchRoomState(store, change, (current) => {
      const me = current.currentPrincipalId
      const others = current.reactions.filter((row) => !(row.messageId === change.messageId && row.emoji === change.emoji))
      const existing = current.reactions.find((row) => row.messageId === change.messageId && row.emoji === change.emoji)
      const principalIds = (existing?.principalIds ?? []).filter((id) => id !== me)
      if (change.enabled) principalIds.push(me)
      const next = principalIds.length > 0
        ? [{
            conversationId: change.conversationId,
            messageId: change.messageId,
            emoji: change.emoji,
            principalIds,
            count: principalIds.length,
            reactedByCurrentPrincipal: change.enabled,
          }]
        : []
      return { ...current, reactions: [...others, ...next] }
    })
  })

  const setPinned = useMutation(api.collaboration.rooms.setPinned).withOptimisticUpdate((store, change) => {
    patchRoomState(store, change, (current) => ({
      ...current,
      pins: change.pinned
        ? [{ conversationId: change.conversationId, messageId: change.messageId, pinnedByPrincipalId: current.currentPrincipalId, createdAt: Date.now() },
            ...current.pins.filter((pin) => pin.messageId !== change.messageId)]
        : current.pins.filter((pin) => pin.messageId !== change.messageId),
    }))
  })

  const setSaved = useMutation(api.collaboration.rooms.setSaved).withOptimisticUpdate((store, change) => {
    patchRoomState(store, change, (current) => ({
      ...current,
      saved: change.saved
        ? [{ conversationId: change.conversationId, messageId: change.messageId, principalId: current.currentPrincipalId, createdAt: Date.now() },
            ...current.saved.filter((row) => row.messageId !== change.messageId)]
        : current.saved.filter((row) => row.messageId !== change.messageId),
    }))
  })

  const setThreadFollow = useMutation(api.collaboration.rooms.setThreadFollow).withOptimisticUpdate((store, change) => {
    patchRoomState(store, change, (current) => ({
      ...current,
      follows: change.followed
        ? [{ conversationId: change.conversationId, threadRootMessageId: change.threadRootMessageId, principalId: current.currentPrincipalId, followedAt: Date.now() },
            ...current.follows.filter((row) => row.threadRootMessageId !== change.threadRootMessageId)]
        : current.follows.filter((row) => row.threadRootMessageId !== change.threadRootMessageId),
    }))
  })

  const updateMyState = useMutation(api.collaboration.rooms.updateMyState)
  const heartbeat = useMutation(api.collaboration.rooms.heartbeat)

  return { args, state, setReaction, setPinned, setSaved, setThreadFollow, updateMyState, heartbeat }
}

export type RoomStateApi = ReturnType<typeof useRoomState>
