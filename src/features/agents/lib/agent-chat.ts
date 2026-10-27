'use client'

import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { dispatchChatCreated } from '@/shared/chat/chat-title'
import { buildWorkspaceHref } from '@/shared/workspaces/routing'
import type { PanelScope } from '@/shared/workspaces/panel-scope'

/** Opens (or creates) the agent's main thread, then navigates to it. Resolves the conversation id (null when it cannot be determined). */
export async function startAgentChat(args: {
  workspaceId: string | null
  agentId?: string
  agentPrincipalId: string

  surface?: 'agents' | 'chat'
  scope?: PanelScope
  buildHref?: (workspaceId: string | null, href: string, scope?: PanelScope) => string
  push(href: string): void
}): Promise<string | null> {
  const surface = args.surface ?? 'chat'

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
  const destination = surface === 'agents' ? '/app/agents' : '/app/chat'
  const routeScope = surface === 'agents' ? args.scope ?? 'personal' : 'workspace'
  const params = new URLSearchParams({ id: conversationId })
  params.set('scope', routeScope)
  if (surface === 'agents') {
    if (args.agentId) params.set('agent', args.agentId)
  } else {
    params.set('view', 'dms')
  }
  const destinationWithQuery = `${destination}?${params.toString()}`
  args.push(args.buildHref
    ? args.buildHref(args.workspaceId, destinationWithQuery, routeScope)
    : buildWorkspaceHref(args.workspaceId, destinationWithQuery))
  return conversationId
}

/** Canonical workspace-scoped href for the agent editor pages. */
export function buildAgentEditorHref(workspaceId: string | null, agentId: string | 'new', ): string {
  if (!workspaceId) return `/app/agents/${agentId}`
  return `/app/w/${encodeURIComponent(workspaceId)}/agents/${agentId}`
}

/** Canonical workspace-scoped href for the agents directory. */
export function buildAgentsDirectoryHref(workspaceId: string | null, ): string {
  if (!workspaceId) return '/app/agents'
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
