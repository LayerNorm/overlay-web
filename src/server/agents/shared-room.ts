import 'server-only'

import { ConvexHarnessRepository } from '@/server/harness/ConvexHarnessRepository'
import { logger } from '@/server/observability/logger'
import type { ConversationCollaborationRepository } from '@/server/conversations/ConversationCollaborationRepository'
import { isSharedRoom } from '@/shared/agents/room-access'

/**
 * Whether an agent turn in this conversation is in a room others can read (internal/plans/TOOL_SCOPING_PLAN.md, T4). Decided
 * on the server from the conversation itself, never from anything the model or a connected agent supplies. If the
 * conversation cannot be read the answer is yes: the safe side is to withhold the person's private reach.
 */
export async function resolveSharedRoom(args: {
  actorUserId: string
  conversationId: string
  workspaceId: string
  collaboration?: Pick<ConversationCollaborationRepository, 'getAccessibleConversation' | 'listParticipants'>
  roomRestrictions?: Pick<ConvexHarnessRepository, 'resolveConversationRoomRestrictions'>
}): Promise<boolean> {
  try {
    if (args.collaboration) {
      const lookup = { actorUserId: args.actorUserId, conversationId: args.conversationId, workspaceId: args.workspaceId }
      const [conversation, participants] = await Promise.all([
        args.collaboration.getAccessibleConversation(lookup),
        args.collaboration.listParticipants(lookup),
      ])
      if (!conversation) return true
      return isSharedRoom({
        conversationType: conversation.conversationType ?? 'personal',
        channelVisibility: (conversation as { channelVisibility?: string | null }).channelVisibility,
        humanParticipants: participants.filter((participant) => participant.principalType === 'human').length,
      })
    }
    const restrictions = await (args.roomRestrictions ?? new ConvexHarnessRepository()).resolveConversationRoomRestrictions({
        actorUserId: args.actorUserId,
        conversationId: args.conversationId,
        workspaceId: args.workspaceId,
      })
    return restrictions.inheritedSharedRoom
  } catch (error) {
    logger.warn('[workspace-agent] could not tell whether the room is shared; treating it as shared', { error })
    return true
  }
}

/**
 * Whether what an agent learns in this conversation is workspace knowledge (`memoryOwnerForPlace`): a room others can
 * read, a thread asked from one, or a workspace automation's thread. Decided by Convex, the same check reply extraction
 * uses. If it cannot be read the answer is no: a private memory is the safe side.
 */
export async function resolveWorkspaceMemoryContext(args: {
  actorUserId: string
  conversationId: string
  workspaceId: string
  roomRestrictions?: Pick<ConvexHarnessRepository, 'resolveConversationRoomRestrictions'>
}): Promise<boolean> {
  try {
    const restrictions = await (args.roomRestrictions ?? new ConvexHarnessRepository()).resolveConversationRoomRestrictions({
      actorUserId: args.actorUserId,
      conversationId: args.conversationId,
      workspaceId: args.workspaceId,
    })
    return restrictions.workspaceMemory
  } catch (error) {
    logger.warn('[workspace-agent] could not tell where memories belong; keeping them private', { error })
    return false
  }
}
