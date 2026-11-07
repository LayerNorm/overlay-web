'use client'

import { useConvexAuth, useQuery } from 'convex/react'
import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'

/** Live writability of a room or one of its threads; undefined while loading, null without access. */
export function useRoomCompatibility(args: {
  workspaceId: string | null | undefined
  conversationId: string | null
  threadRootMessageId?: string | null
}) {
  const { isAuthenticated, isLoading } = useConvexAuth()
  return useQuery(
    api.collaboration.rooms.compatibility,
    args.workspaceId && args.conversationId && isAuthenticated && !isLoading
      ? {
          workspaceId: args.workspaceId,
          conversationId: args.conversationId as Id<'conversations'>,
          ...(args.threadRootMessageId
            ? { threadRootMessageId: args.threadRootMessageId as Id<'conversationMessages'> }
            : {}),
        }
      : 'skip',
  )
}
