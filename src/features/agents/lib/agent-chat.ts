'use client'

import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { dispatchChatCreated } from '@/shared/chat/chat-title'
import { buildWorkspaceHref } from '@/features/workspaces/lib/workspace-routing'

/** Opens (or creates) a one-to-one DM with an agent, then navigates to it. */
export async function startAgentChat(args: {
  workspaceId: string | null
  agentPrincipalId: string
  showcase?: boolean
  push(href: string): void
}): Promise<void> {
  if (args.showcase) {
    args.push(`/app/chat?showcase=1&view=dms&id=${encodeURIComponent(args.agentPrincipalId)}`)
    return
  }
  if (!args.workspaceId) return
  const { directMessage } = await overlayAppClient.conversations.createWorkspaceDirectMessage(args.workspaceId, {
    principalIds: [args.agentPrincipalId],
  })
  dispatchChatCreated({
    chat: {
      _id: directMessage.conversationId,
      title: directMessage.title,
      lastModified: Date.now(),
      conversationType: 'dm',
    },
  })
  args.push(`${buildWorkspaceHref(args.workspaceId, '/app/chat')}?view=dms&id=${encodeURIComponent(directMessage.conversationId)}`)
}

/** Canonical workspace-scoped href for the agent editor pages. */
export function buildAgentEditorHref(workspaceId: string | null, agentId: string | 'new', showcase = false): string {
  if (showcase || !workspaceId) return `/app/agents/${agentId}?showcase=1`
  return `/app/w/${encodeURIComponent(workspaceId)}/agents/${agentId}`
}

/** Canonical workspace-scoped href for the agents directory. */
export function buildAgentsDirectoryHref(workspaceId: string | null, showcase = false): string {
  if (showcase || !workspaceId) return '/app/agents?showcase=1'
  return `/app/w/${encodeURIComponent(workspaceId)}/agents`
}
