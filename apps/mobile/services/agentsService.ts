/**
 * Agents service facade — wraps the typed `mobileOverlayAppClient` agents,
 * agent-environments, bindings, and computers surfaces plus the DM +
 * greeting calls needed for chat-with-agent.
 *
 * Every call takes the active workspace id explicitly; the typed client maps
 * it onto `x-overlay-workspace-id`. An empty string is acceptable — the
 * server resolves the user's stored active workspace when no usable header
 * is present (see `resolveActiveWorkspace`).
 */
import type { AgentEnvironmentResource } from '@overlay/api-client'
import type {
  AgentBinding,
  AgentFilesystemGrant,
  BuiltInUserOwnedAcpAdapterId,
  Computer,
  WorkspaceAgentCreateInput,
  WorkspaceAgentDirectoryItem,
  WorkspaceAgentListResponse,
  WorkspaceAgentUpdateInput,
} from '@overlay/workspace-contracts'
import { appJson } from './appApi'
import { mobileOverlayAppClient } from './overlayClient'

export type { AgentEnvironmentResource }
export type AgentDirectoryItem = WorkspaceAgentDirectoryItem
export type AgentEnvironmentItem = AgentEnvironmentResource

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

export async function listAgents(workspaceId: string): Promise<WorkspaceAgentListResponse> {
  return mobileOverlayAppClient.agents.list(workspaceId)
}

export async function getAgent(
  workspaceId: string,
  agentId: string,
): Promise<WorkspaceAgentDirectoryItem> {
  const { agent } = await mobileOverlayAppClient.agents.get(workspaceId, agentId)
  return agent
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
// Environments
// ---------------------------------------------------------------------------

export async function listAgentEnvironments(
  workspaceId: string,
): Promise<AgentEnvironmentResource[]> {
  const { environments } = await mobileOverlayAppClient.agentEnvironments.list(workspaceId)
  return environments
}

export type AgentEnrollmentSession = {
  enrollmentSessionId: string
  code: string
  command: string
  expiresAt: number
}

export async function createAgentEnrollment(
  workspaceId: string,
  adapterId?: BuiltInUserOwnedAcpAdapterId,
): Promise<AgentEnrollmentSession> {
  return mobileOverlayAppClient.agentEnvironments.createEnrollment(
    workspaceId,
    adapterId ? { adapterId } : undefined,
  )
}

export async function approveAgentEnvironment(
  workspaceId: string,
  environmentId: string,
  filesystemGrant: AgentFilesystemGrant,
): Promise<AgentEnvironmentResource> {
  const { environment } = await mobileOverlayAppClient.agentEnvironments.approve(
    workspaceId,
    environmentId,
    filesystemGrant,
  )
  return environment
}

export async function updateEnvironmentRoots(
  workspaceId: string,
  environmentId: string,
  filesystemGrant: AgentFilesystemGrant,
): Promise<AgentEnvironmentResource> {
  const { environment } = await mobileOverlayAppClient.agentEnvironments.updateRoots(
    workspaceId,
    environmentId,
    filesystemGrant,
  )
  return environment
}

export async function revokeAgentEnvironment(
  workspaceId: string,
  environmentId: string,
): Promise<void> {
  await mobileOverlayAppClient.agentEnvironments.revoke(workspaceId, environmentId)
}

// ---------------------------------------------------------------------------
// Bindings
// ---------------------------------------------------------------------------

export async function listAgentBindings(
  workspaceId: string,
  agentId?: string,
): Promise<AgentBinding[]> {
  const { bindings } = await mobileOverlayAppClient.agentEnvironments.listBindings(workspaceId, agentId)
  return bindings
}

export async function upsertAgentBinding(
  workspaceId: string,
  input: { agentId: string; environmentId: string; adapterId: string; workingDirectory: string },
): Promise<AgentBinding> {
  const { binding } = await mobileOverlayAppClient.agentEnvironments.upsertBinding(workspaceId, input)
  return binding
}

export async function disableAgentBindings(workspaceId: string, agentId: string): Promise<void> {
  await mobileOverlayAppClient.agentEnvironments.disableBindings(workspaceId, agentId)
}

// ---------------------------------------------------------------------------
// Agent computers (computer tool group → persistent cloud desktop)
// ---------------------------------------------------------------------------

export async function listAgentComputers(workspaceId: string): Promise<Computer[]> {
  const { computers } = await mobileOverlayAppClient.computers.list(workspaceId)
  return computers
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
