'use client'

import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { dispatchChatCreated } from '@/shared/chat/chat-title'
import { buildWorkspaceHref } from '@/shared/workspaces/routing'
import type { PanelScope } from '@/shared/workspaces/panel-scope'
import { savePendingCollaborationMessage } from '@/shared/chat/pending-collaboration-message'

type AgentThreadArgs = { workspaceId: string; agentId: string }
type AgentThreadResolution = { conversationId: string; title: string }
type AgentThreadResolver = (args: AgentThreadArgs) => Promise<AgentThreadResolution>

function isMissingConvexFunction(error: unknown, functionPath: string): boolean {
  const message = error instanceof Error ? error.message : String(error)
  const prefix = /(?:Could not find (?:public )?function for|No function found for)\s+/i.exec(message)
  if (!prefix) return false
  const requested = message.slice(prefix.index + prefix[0].length).trimStart()
  const quote = requested[0]
  if (quote === "'" || quote === '"') {
    const end = requested.indexOf(quote, 1)
    return end > 0 && requested.slice(1, end) === functionPath
  }
  const path = /^\S+/.exec(requested)?.[0]
  return path === functionPath || path === `${functionPath}.`
}

export async function resolveLatestActivityWithMainFallback(
  args: AgentThreadArgs,
  resolveLatestActivity: AgentThreadResolver,
  resolveMain: AgentThreadResolver,
): Promise<AgentThreadResolution> {
  try {
    return await resolveLatestActivity(args)
  } catch (error) {
    if (!isMissingConvexFunction(error, 'agents/threads:resolveLatestActivity')) throw error
    return await resolveMain(args)
  }
}

/** Resolves an agent thread with the supplied policy, then navigates to it. */
export async function startAgentChat(args: {
  workspaceId: string | null
  agentId?: string
  agentPrincipalId: string
  initialMessage?: string

  surface?: 'agents' | 'chat'
  scope?: PanelScope
  buildHref?: (workspaceId: string | null, href: string, scope?: PanelScope) => string
  /** Required with `agentId`: the mutation that selects a thread for this entry path. */
  resolveAgentThread?: AgentThreadResolver
  push(href: string): void
}): Promise<string | null> {
  const surface = args.surface ?? 'chat'

  if (!args.workspaceId) return null
  if (args.agentId && !args.resolveAgentThread) throw new Error('Agent threads are unavailable')
  const thread = args.agentId
    ? await args.resolveAgentThread!({ workspaceId: args.workspaceId, agentId: args.agentId })
    : null
  const conversationId = thread?.conversationId
    ?? (await overlayAppClient.conversations.createWorkspaceDirectMessage(args.workspaceId, {
      principalIds: [args.agentPrincipalId],
    })).directMessage.conversationId
  if (args.initialMessage?.trim()) {
    savePendingCollaborationMessage({
      conversationId,
      content: args.initialMessage,
      expectedAgentPrincipalId: args.agentPrincipalId,
    })
  }
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
