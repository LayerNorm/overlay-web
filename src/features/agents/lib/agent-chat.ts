'use client'

import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { dispatchChatCreated } from '@/shared/chat/chat-title'
import { buildWorkspaceHref } from '@/shared/workspaces/routing'
import type { PanelScope } from '@/shared/workspaces/panel-scope'
import { savePendingCollaborationMessage } from '@/shared/chat/pending-collaboration-message'
import { useCallback } from 'react'
import { useNativeThreadClient } from '@/components/providers/native-agent-threads'

export function useStartAgentChat() {
  const nativeThreads = useNativeThreadClient()
  return useCallback((args: Parameters<typeof startAgentChat>[0]) => startAgentChat({ ...args,
    agentId: args.agentId ?? (nativeThreads.enabled ? args.nativeAgentId : undefined),
    surface: args.surface ?? (nativeThreads.enabled ? 'agents' : 'chat'), nativeThreads }), [nativeThreads])
}

/** Opens (or creates) the agent's main thread, then navigates to it. Resolves the conversation id (null when it cannot be determined). */
export async function startAgentChat(args: {
  workspaceId: string | null
  agentId?: string
  nativeAgentId?: string
  agentPrincipalId: string
  initialMessage?: string
  nativeThreads?: { enabled: boolean; resolve(agentId: string): Promise<{ conversationId: string; title: string }>;
    create?(agentId: string, requestId: string): Promise<{ conversationId: string; title: string }>; track?(token: string): () => void }
  nativeRequestId?: string
  recoverPending?: boolean
  feedback?: boolean

  surface?: 'agents' | 'chat'
  scope?: PanelScope
  buildHref?: (workspaceId: string | null, href: string, scope?: PanelScope) => string
  push(href: string): void
  replace?(href: string): void
}): Promise<string | null> {
  if (!args.workspaceId) return null
  const navigation = nativeAgentFeedback(args)
  // Agents open into their main thread. The resolver adopts the legacy DM
  // when one exists, so pre-thread history is never lost.
  let thread
  try {
    thread = await resolveAgentChatThread({ ...args, workspaceId: args.workspaceId })
  } catch (error) {
    navigation?.finish()
    if (navigation?.owns() || (args.nativeThreads?.enabled && args.recoverPending)) (args.replace ?? args.push)(agentChatHref(args, { failed: true }))
    throw error
  }
  const conversationId = thread?.conversationId
    ?? (await overlayAppClient.conversations.createWorkspaceDirectMessage(args.workspaceId, {
      principalIds: [args.agentPrincipalId],
    })).directMessage.conversationId
  navigation?.finish()
  if (navigation && !navigation.owns()) return conversationId
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
  const navigate = navigation ? args.replace ?? args.push : args.push
  navigate(agentChatHref(args, { conversationId }))
  return conversationId
}

async function resolveAgentChatThread(args: Parameters<typeof startAgentChat>[0] & { workspaceId: string }) {
  if (args.nativeThreads?.enabled) {
    if (!args.agentId) throw new Error('An agent is required for native threads')
    if (args.nativeRequestId) {
      if (!args.nativeThreads.create) throw new Error('Native thread creation unavailable')
      return args.nativeThreads.create(args.agentId, args.nativeRequestId)
    }
    return args.nativeThreads.resolve(args.agentId)
  }
  return args.agentId ? (await overlayAppClient.agents.resolveMainThread(args.workspaceId, args.agentId)).thread : null
}

function nativeAgentFeedback(args: Parameters<typeof startAgentChat>[0]) {
  if (!args.nativeThreads?.enabled || args.feedback === false || !args.agentId || args.surface !== 'agents') return null
  const key = () => typeof window === 'undefined' ? '' : window.location.pathname + window.location.search
  const origin = key()
  const token = `resolve:${crypto.randomUUID()}`
  const pending = agentChatHref(args, { pending: token })
  const finish = args.nativeThreads.track?.(token) ?? (() => {})
  args.push(pending)
  return { finish, owns: () => typeof window === 'undefined' || key() === origin || key() === pending }
}

function agentChatHref(args: Parameters<typeof startAgentChat>[0], target: { conversationId?: string; pending?: string; failed?: boolean }) {
  if (!args.workspaceId) throw new Error('Workspace required')
  const surface = args.surface ?? 'chat'
  const destination = surface === 'agents' ? '/app/agents' : '/app/chat'
  const routeScope = surface === 'agents' ? args.scope ?? 'personal' : 'workspace'
  const params = new URLSearchParams()
  if (target.conversationId) params.set('id', target.conversationId)
  if (target.pending) params.set('nativePending', target.pending)
  if (target.failed) params.set('nativeError', '1')
  params.set('scope', routeScope)
  if (surface === 'agents') {
    if (args.agentId) params.set('agent', args.agentId)
  } else {
    params.set('view', 'dms')
  }
  const destinationWithQuery = `${destination}?${params.toString()}`
  return args.buildHref
    ? args.buildHref(args.workspaceId, destinationWithQuery, routeScope)
    : buildWorkspaceHref(args.workspaceId, destinationWithQuery)
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
