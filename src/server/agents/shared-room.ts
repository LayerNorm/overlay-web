import 'server-only'

import { getOverlayServerContext } from '@/server/bootstrap'
import { logger } from '@/server/observability/logger'
import type { ConversationCollaborationRepository } from '@/server/conversations/ConversationCollaborationRepository'
import { isSharedRoom } from '@/shared/agents/room-access'

/**
 * Whether an agent turn in this conversation is in a room others can read (docs/plans/TOOL_SCOPING_PLAN.md, T4). Decided
 * on the server from the conversation itself, never from anything the model or a connected agent supplies. If the
 * conversation cannot be read the answer is yes: the safe side is to withhold the person's private reach.
 */
export async function resolveSharedRoom(args: {
  actorUserId: string
  conversationId: string
  workspaceId: string
  collaboration?: Pick<ConversationCollaborationRepository, 'getAccessibleConversation' | 'listParticipants'>
}): Promise<boolean> {
  try {
    const collaboration = args.collaboration ?? getOverlayServerContext().appData.repositories.conversationCollaboration
    const lookup = { actorUserId: args.actorUserId, conversationId: args.conversationId, workspaceId: args.workspaceId }
    const [conversation, participants] = await Promise.all([
      collaboration.getAccessibleConversation(lookup),
      collaboration.listParticipants(lookup),
    ])
    if (!conversation) return true
    return isSharedRoom({
      conversationType: conversation.conversationType ?? 'personal',
      channelVisibility: (conversation as { channelVisibility?: string | null }).channelVisibility,
      humanParticipants: participants.filter((participant) => participant.principalType === 'human').length,
    })
  } catch (error) {
    logger.warn('[workspace-agent] could not tell whether the room is shared; treating it as shared', { error })
    return true
  }
}
