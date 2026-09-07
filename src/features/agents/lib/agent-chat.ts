'use client'

import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { dispatchChatCreated } from '@/shared/chat/chat-title'
import { buildWorkspaceHref } from '@/features/workspaces/lib/workspace-routing'

/** Opens (or creates) a one-to-one DM with an agent, then navigates to it. */
export async function startAgentChat(args: {
  workspaceId: string | null
  agentId?: string
  agentPrincipalId: string
  showcase?: boolean
  surface?: 'agents' | 'chat'
  push(href: string): void
}): Promise<void> {
  const surface = args.surface ?? 'chat'
  if (args.showcase) {
    const basePath = surface === 'agents' ? '/app/agents' : '/app/chat'
    const params = new URLSearchParams({ showcase: '1', view: 'dms', id: args.agentPrincipalId })
    if (surface === 'agents' && args.agentId) params.set('agent', args.agentId)
    args.push(`${basePath}?${params.toString()}`)
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
  const basePath = buildWorkspaceHref(args.workspaceId, surface === 'agents' ? '/app/agents' : '/app/chat')
  const params = new URLSearchParams({ view: 'dms', id: directMessage.conversationId })
  if (surface === 'agents' && args.agentId) params.set('agent', args.agentId)
  args.push(`${basePath}?${params.toString()}`)
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
