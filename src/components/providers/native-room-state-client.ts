'use client'

import { useNativeCollaboration } from './native-collaboration-context'
import { api } from '../../../convex/_generated/api'
import { useMemo } from 'react'
import { useRoomArchiveOverlays } from './native-room-archive-overlays'

export type RoomAction =
  | { kind: 'setReaction'; messageId: string; emoji: string; enabled: boolean }
  | { kind: 'setPinned'; messageId: string; pinned: boolean }
  | { kind: 'setSaved'; messageId: string; saved: boolean }
  | { kind: 'setThreadFollow'; threadRootMessageId: string; followed: boolean }
  | { kind: 'setNotificationLevel'; notificationLevel: 'all' | 'mentions' | 'muted' }
  | { kind: 'setRoomArchived'; archived: boolean; scope: 'self' | 'everyone' }
  | { kind: 'addParticipant' | 'removeParticipant'; principalId: string }

export function useNativeRoomStateClient() {
  const { client, workspaceId, status, isCurrentScope } = useNativeCollaboration()
  const { add, remove } = useRoomArchiveOverlays()
  return useMemo(() => ({ enabled: status !== 'disabled',
    isCurrentScope: () => Boolean(isCurrentScope?.()),
    async act(conversationId: string, action: RoomAction) {
      if (status !== 'ready' || !client || !workspaceId || !isCurrentScope?.()) throw new Error('Native room state unavailable')
      const { kind, ...payload } = action
      const token = action.kind === 'setRoomArchived' ? add(conversationId, action.archived) : undefined
      let committed = false
      try {
        const result = await client.mutation(api.collaboration.nativeRoomState[kind], { ...payload, conversationId, workspaceId: workspaceId } as never)
        if (!isCurrentScope()) throw new Error('Native room scope changed')
        committed = true
        return result
      } finally { if (token !== undefined) remove(conversationId, token, committed) }
    },
    async heartbeat(conversationId: string, payload: { status: 'online' | 'away' | 'offline'; sessionId?: string; typing?: boolean }) {
      if (status !== 'ready' || !client || !workspaceId || !isCurrentScope?.()) throw new Error('Native presence unavailable')
      return client.mutation(api.collaboration.nativePresence.heartbeat, { ...payload, sessionId: payload.sessionId ?? 'native',
        workspaceId: workspaceId, conversationId: conversationId as never })
    },
  }), [add, client, isCurrentScope, status, workspaceId, remove])
}
