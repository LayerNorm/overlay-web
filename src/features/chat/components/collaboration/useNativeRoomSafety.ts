'use client'

import { useQuery } from 'convex/react'
import { makeFunctionReference } from 'convex/server'
import type { Id } from '../../../../../convex/_generated/dataModel'
import type { NativeThreadCompatibility } from '@/shared/agents/native-run-retirement'
import { useNativeThreadSafety } from '../chat/useNativeThreadSafety'
import { useNativeCollaboration } from './NativeCollaborationProvider'
import { useNativeRoomSession } from './NativeRoomScope'

export const roomExecutionQuery = makeFunctionReference<'query', {
  workspaceId: string; conversationId: Id<'conversations'>; threadRootMessageId?: Id<'conversationMessages'>
}, {
  workspaceId: string; conversationId: Id<'conversations'>; userId: string; threadRootMessageId?: Id<'conversationMessages'>
  compatibility: NativeThreadCompatibility
} | null>('collaboration/nativeRooms:getExecution')

export function useNativeRoomSafety({ conversationId, workspaceId, threadRootMessageId }: {
  conversationId: string | null; workspaceId: string | null; threadRootMessageId?: string
}) {
  const native = useNativeCollaboration()
  const session = useNativeRoomSession()
  const enabled = native.status !== 'disabled'
  const synchronized = native.status === 'ready' && workspaceId === native.workspaceId
    && session?.room?.conversationId === conversationId && session.room.viewerUserId === native.viewerUserId
  const value = useQuery(roomExecutionQuery, enabled && synchronized && workspaceId && conversationId
    ? { workspaceId, conversationId: conversationId as Id<'conversations'>, threadRootMessageId: threadRootMessageId as Id<'conversationMessages'> | undefined } : 'skip')
  return useNativeThreadSafety({ conversationId, workspaceId, threadRootMessageId,
    nativeMode: enabled, verifiedUserId: native.viewerUserId, scopeSynchronized: synchronized,
    nativeExecution: { status: !synchronized || value === undefined ? 'loading' : value === null ? 'unavailable' : 'ready', value: value ?? null },
  })
}
