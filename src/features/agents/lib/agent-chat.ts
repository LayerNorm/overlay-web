'use client'

import type { WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { dispatchChatCreated } from '@/shared/chat/chat-title'
import { buildWorkspaceHref } from '@/shared/workspaces/routing'
import { buildWorkspaceAgentInput } from './agent-editor-input'
import { DEFAULT_AGENT_TOOL_GROUP_IDS } from '@/shared/agents/tool-groups'
import { DEFAULT_MODEL_ID } from '@/shared/ai/gateway/model-types'
import { AVATAR_COLORS } from '../components/AgentEditorForm'

/** Opens (or creates) a one-to-one DM with an agent, then navigates to it. Resolves the DM conversation id (null when it cannot be determined). */
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
    const params = new URLSearchParams({ showcase: '1', view: 'dms', id: args.agentPrincipalId })
    if (surface === 'agents' && args.agentId) params.set('agent', args.agentId)
    args.push(`${basePath}?${params.toString()}`)
    return args.agentPrincipalId
  }
  if (!args.workspaceId) return null
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
  return directMessage.conversationId
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

/**
 * Create-first "New agent": creates a real agent with defaults (unique
 * "Untitled agent" name), refreshes the roster, opens its conversation, and
 * returns it so the caller can open the edit panel pointed at it. Returns
 * 'no-permission' when guests cannot create (caller shows the blank form).
 */
export async function createAgentAndOpenChat(args: {
  workspaceId: string
  push(href: string): void
  onDirectoryChanged(workspaceId: string): void
  onOpened(agentId: string): void
}): Promise<{ status: 'created' | 'no-permission'; agent?: WorkspaceAgentDirectoryItem }> {
  const directory = await overlayAppClient.agents.list(args.workspaceId)
  if (!directory.canCreate) return { status: 'no-permission' }
  const taken = new Set(directory.agents.map((agent) => agent.name.toLowerCase()))
  let name = 'Untitled agent'
  for (let n = 2; taken.has(name.toLowerCase()) && n < 50; n += 1) name = `Untitled agent ${n}`
  const created = await overlayAppClient.agents.create(args.workspaceId, {
    ...buildWorkspaceAgentInput({
      name,
      description: '',
      instructions: 'You are a helpful assistant.',
      agentType: 'overlay',
      harnessLabel: '',
      adapterId: '',
      modelId: DEFAULT_MODEL_ID,
      avatarColor: AVATAR_COLORS[0]!,
      avatarShape: 'circle',
      enabledToolGroups: new Set(DEFAULT_AGENT_TOOL_GROUP_IDS),
      visibility: 'workspace',
    }),
    teamIds: [],
  })
  args.onDirectoryChanged(args.workspaceId)
  args.onOpened(created.agent.id)
  const conversationId = await startAgentChat({
    workspaceId: args.workspaceId,
    agentId: created.agent.id,
    agentPrincipalId: created.agent.principalId,
    surface: 'agents',
    push: args.push,
  })
  if (conversationId) {
    await sendAgentGreeting({ workspaceId: args.workspaceId, conversationId, agentId: created.agent.id })
  }
  return { status: 'created', agent: created.agent }
}
