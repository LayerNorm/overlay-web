'use client'

import { useEffect } from 'react'
import { useQuery } from '@/components/providers/convex-hooks'
import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'
import type { RoomMessageRecord } from './room-message-view'

type WatchRoomMessagesResult = {
  ok: boolean
  messages: RoomMessageRecord[]
}

function asWatchResult(value: unknown): WatchRoomMessagesResult | undefined {
  if (value === undefined) return undefined
  // Backward-compatible: older Convex deploys returned a bare array.
  if (Array.isArray(value)) {
    return { ok: true, messages: value as RoomMessageRecord[] }
  }
  if (
    value
    && typeof value === 'object'
    && 'ok' in value
    && 'messages' in value
    && Array.isArray((value as WatchRoomMessagesResult).messages)
  ) {
    return value as WatchRoomMessagesResult
  }
  return undefined
}

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
  const mainResult = asWatchResult(useQuery(api.collaboration.directMessages.watchRoomMessages, {
    ...commonArgs,
    mainOnly: true,
  }))
  const threadResult = asWatchResult(useQuery(
    api.collaboration.directMessages.watchRoomMessages,
    threadRootMessageId
      ? {
          ...commonArgs,
          threadRootMessageId: threadRootMessageId as Id<'conversationMessages'>,
        }
      : 'skip',
  ))

  useEffect(() => {
    // Auth failures return ok:false — leave the last good transcript alone.
    if (!mainResult?.ok) return
    const threadMessages = threadResult?.ok ? threadResult.messages : []
    onMessages([
      ...mainResult.messages,
      ...threadMessages,
    ])
  }, [mainResult, onMessages, threadResult])

  return null
}
