/** Convex reads and web HTTP commands for workspace agents. */
import type {
  Computer,
  WorkspaceAgentCreateInput,
  WorkspaceAgentDirectoryItem,
  WorkspaceAgentListResponse,
  WorkspaceAgentUpdateInput,
} from '@overlay/workspace-contracts'
import { appJson } from './appApi'
import { mobileOverlayAppClient } from './overlayClient'
import { api, queryConvex } from './convexClient'
import { normalizeCreatureShape } from '../lib/agentCreature'

export type AgentDirectoryItem = WorkspaceAgentDirectoryItem

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

export async function listAgents(workspaceId: string): Promise<WorkspaceAgentListResponse> {
  const result = await queryConvex(api.agents.directory.list, { workspaceId })
  if (!result) throw new Error('Agents are unavailable in this workspace.')
  return { ...result, agents: result.agents.map(agent => ({ ...agent, avatarShape: normalizeCreatureShape(agent.avatarShape) })) }
}

export async function getAgent(
  workspaceId: string,
  agentId: string,
): Promise<WorkspaceAgentDirectoryItem & { canEdit: boolean }> {
  const agent = await queryConvex(api.agents.directory.get, { workspaceId, agentId })
  if (!agent) throw new Error('Agent is unavailable in this workspace.')
  return { ...agent, avatarShape: normalizeCreatureShape(agent.avatarShape) }
}

export async function createAgent(
  workspaceId: string,
  input: WorkspaceAgentCreateInput,
): Promise<WorkspaceAgentDirectoryItem> {
  const { agent } = await mobileOverlayAppClient.agents.create(workspaceId, input)
  return agent
}

export async function updateAgent(
  workspaceId: string,
  agentId: string,
  input: WorkspaceAgentUpdateInput,
): Promise<WorkspaceAgentDirectoryItem> {
  const { agent } = await mobileOverlayAppClient.agents.update(workspaceId, agentId, input)
  return agent
}

export async function archiveAgent(workspaceId: string, agentId: string): Promise<void> {
  await mobileOverlayAppClient.agents.archive(workspaceId, agentId)
}

// ---------------------------------------------------------------------------
// Agent computers (computer tool group → persistent cloud desktop)
// ---------------------------------------------------------------------------

export async function listAgentComputers(workspaceId: string): Promise<Computer[]> {
  return await queryConvex(api.computers.browse.list, { workspaceId }) ?? []
}

export async function provisionAgentComputer(
  workspaceId: string,
  agentId: string,
  name: string,
): Promise<Computer> {
  const { computer } = await mobileOverlayAppClient.computers.provision(workspaceId, {
    ownerType: 'agent',
    ownerId: agentId,
    size: 'default',
    name,
  })
  return computer
}

export async function destroyAgentComputer(workspaceId: string, computerId: string): Promise<void> {
  await mobileOverlayAppClient.computers.destroy(workspaceId, computerId)
}

// ---------------------------------------------------------------------------
// Chat with agent
// ---------------------------------------------------------------------------

/**
 * Opens (or creates) the one-to-one DM with an agent principal, then posts
 * the agent greeting when the DM is brand new. Returns the conversation id
 * so the caller can route into the native chat screen. Mirrors web
 * `startAgentChat` + `sendAgentGreeting`.
 */
export async function openAgentChat(
  workspaceId: string,
  agent: Pick<WorkspaceAgentDirectoryItem, 'id' | 'principalId'>,
): Promise<string> {
  const { directMessage } = await mobileOverlayAppClient.conversations.createWorkspaceDirectMessage(
    workspaceId,
    { principalIds: [agent.principalId] },
  )
  if (directMessage.created) {
    await sendAgentGreeting({
      workspaceId,
      conversationId: directMessage.conversationId,
      agentId: agent.id,
    })
  }
  return directMessage.conversationId
}

/**
 * Posts the new-agent greeting as the agent itself. Idempotent per
 * conversation+agent (deterministic nonce server-side), so retries never
 * double-post. Failures are swallowed — a missing greeting must never break
 * agent creation.
 */
export async function sendAgentGreeting(args: {
  workspaceId: string
  conversationId: string
  agentId: string
}): Promise<void> {
  try {
    await appJson('/api/v1/conversations/agent-greeting', {
      method: 'POST',
      json: { conversationId: args.conversationId, agentId: args.agentId },
      workspaceId: args.workspaceId,
    })
  } catch {
    // Greeting is decorative; creation already succeeded.
  }
}
