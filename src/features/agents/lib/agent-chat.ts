'use client'

import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { dispatchChatCreated } from '@/shared/chat/chat-title'
import { buildWorkspaceHref } from '@/shared/workspaces/routing'

/** Opens (or creates) the agent's main thread, then navigates to it. Resolves the conversation id (null when it cannot be determined). */
export async function startAgentChat(args: {
  workspaceId: string | null
  agentId?: string
  agentPrincipalId: string
  showcase?: boolean
  surface?: 'agents' | 'chat'
  push(href: string): void
}): Promise<string | null> {
  const surface = args.surface ?? 'chat'
  if (args.showcase) {
    const basePath = surface === 'agents' ? '/app/agents' : '/app/chat'
    // `view=dms` belongs to the chats surface's subview vocabulary only; on
    // the agents surface the panel resolves `view` against its own tabs.
    const params = new URLSearchParams({ showcase: '1', id: args.agentPrincipalId })
    if (surface === 'agents') {
      if (args.agentId) params.set('agent', args.agentId)
    } else {
      params.set('view', 'dms')
    }
    args.push(`${basePath}?${params.toString()}`)
    return args.agentPrincipalId
  }
  if (!args.workspaceId) return null
  // Agents open into their main thread. The resolver adopts the legacy DM
  // when one exists, so pre-thread history is never lost.
  const { thread } = args.agentId
    ? await overlayAppClient.agents.resolveMainThread(args.workspaceId, args.agentId)
    : { thread: null }
  const conversationId = thread?.conversationId
    ?? (await overlayAppClient.conversations.createWorkspaceDirectMessage(args.workspaceId, {
      principalIds: [args.agentPrincipalId],
    })).directMessage.conversationId
  dispatchChatCreated({
    chat: {
      _id: conversationId,
      title: thread?.title ?? 'Agent thread',
      lastModified: Date.now(),
      conversationType: 'dm',
    },
  })
  const basePath = buildWorkspaceHref(args.workspaceId, surface === 'agents' ? '/app/agents' : '/app/chat')
  const params = new URLSearchParams({ id: conversationId })
  if (surface === 'agents') {
    if (args.agentId) params.set('agent', args.agentId)
  } else {
    params.set('view', 'dms')
  }
  args.push(`${basePath}?${params.toString()}`)
  return conversationId
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

/**
 * Posts the new-agent greeting as the agent itself. Idempotent per
 * conversation+agent (deterministic nonce), so retries never double-post.
 * Failures are swallowed — a missing greeting must never break creation.
 */
export async function sendAgentGreeting(args: {
  workspaceId: string
  conversationId: string
  agentId: string
}): Promise<void> {
  try {
    await fetch('/api/v1/conversations/agent-greeting', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        'x-overlay-workspace-id': args.workspaceId,
      },
      body: JSON.stringify({ conversationId: args.conversationId, agentId: args.agentId }),
    })
  } catch {
    // Greeting is decorative; creation already succeeded.
  }
}
