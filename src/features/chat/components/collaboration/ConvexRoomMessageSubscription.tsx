'use client'

import { useEffect } from 'react'
import { useQuery } from '@/components/providers/convex-hooks'
import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'
import type { RoomMessageRecord } from './room-message-view'

export function ConvexRoomMessageSubscription({
  accessToken,
  actorUserId,
  conversationId,
  threadRootMessageId,
  workspaceId,
  onMessages,
}: {
  accessToken: string
  actorUserId: string
  conversationId: string
  threadRootMessageId: string | null
  workspaceId: string
  onMessages: (messages: RoomMessageRecord[]) => void
}) {
  const commonArgs = {
    accessToken,
    actorUserId,
    conversationId: conversationId as Id<'conversations'>,
    limit: 100,
    workspaceId,
  }
  const mainMessages = useQuery(api.collaboration.directMessages.watchRoomMessages, {
    ...commonArgs,
    mainOnly: true,
  }) as RoomMessageRecord[] | undefined
  const threadMessages = useQuery(
    api.collaboration.directMessages.watchRoomMessages,
    threadRootMessageId
      ? {
          ...commonArgs,
          threadRootMessageId: threadRootMessageId as Id<'conversationMessages'>,
        }
      : 'skip',
  ) as RoomMessageRecord[] | undefined

  useEffect(() => {
    if (!Array.isArray(mainMessages)) return
    onMessages([
      ...mainMessages,
      ...(Array.isArray(threadMessages) ? threadMessages : []),
    ])
  }, [mainMessages, onMessages, threadMessages])

  return null
}
