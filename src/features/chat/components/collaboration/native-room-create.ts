'use client'

import type { ChannelCreateInput, DirectMessageCreateInput } from '@overlay/workspace-contracts'
import type { Id } from '../../../../../convex/_generated/dataModel'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { useNativeCollaboration } from './NativeCollaborationProvider'

export function useRoomCreation() {
  const native = useNativeCollaboration()
  return {
    async direct(workspaceId: string, args: DirectMessageCreateInput) {
      if (native.status === 'disabled') return overlayAppClient.conversations.createWorkspaceDirectMessage(workspaceId, args)
      const directMessage = await native.createDirectMessage({ ...args, workspaceId, sourceConversationId: args.sourceConversationId as Id<'conversations'> | undefined })
      return { directMessage }
    },
    async channel(workspaceId: string, args: ChannelCreateInput) {
      if (native.status === 'disabled') return overlayAppClient.conversations.createWorkspaceChannel(workspaceId, args)
      const channel = await native.createChannel({ ...args, workspaceId })
      return { channel }
    },
  }
}
