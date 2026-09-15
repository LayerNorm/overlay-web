import 'server-only'

import { randomUUID } from 'node:crypto'
import type {
  SurfaceBinding,
  SurfaceChannelOption,
  SurfaceConnection,
  SurfaceConnectionStatus,
  SurfacePlatform,
  WorkspaceAgentDirectoryItem,
  WorkspaceMembershipRole,
  WorkspacePrincipal,
} from '@overlay/workspace-contracts'
import type { WorkspaceAgentRepository } from '@/server/agents/WorkspaceAgentRepository'
import { canCreateAgent, canSeeAgent } from '@/server/agents/WorkspaceAgentService'
import type { SurfaceRepository } from './SurfaceRepository'

export class SurfaceServiceError extends Error {
  constructor(
    public readonly code: 'forbidden' | 'not_found' | 'validation' | 'conflict' | 'unavailable',
    message: string,
    public readonly status = code === 'forbidden' ? 403
      : code === 'not_found' ? 404
      : code === 'conflict' ? 409
      : code === 'unavailable' ? 503
      : 400,
  ) {
    super(message)
    this.name = 'SurfaceServiceError'
  }
}

export type SurfaceActor = {
  userId: string
  principalId: string
  workspaceRole: WorkspaceMembershipRole
}

export type { SurfaceChannelOption } from '@overlay/workspace-contracts'

/**
 * Platform channel directory — resolves the channels a bound agent can answer
 * in. Implemented per platform (Slack conversations.list via the Chat SDK
 * adapter); injected so the service stays platform-neutral.
 */
export type SurfaceChannelLister = (
  connection: SurfaceConnection,
) => Promise<SurfaceChannelOption[]>

/**
 * The result of routing one inbound platform message to its agent: the live
 * connection + binding, the bound agent, and the creator identity the turn
 * runs under.
 */
export type ResolvedInboundBinding = {
  connection: SurfaceConnection
  binding: SurfaceBinding
  agent: WorkspaceAgentDirectoryItem
  creatorUserId: string
  creatorPrincipalId: string
}

export class SurfaceService {
  private readonly repository: SurfaceRepository
  private readonly agents: WorkspaceAgentRepository
  private readonly channelLister: SurfaceChannelLister
  private readonly resolvePrincipal: (principalId: string) => Promise<WorkspacePrincipal | null>
  private readonly id: () => string
  private readonly now: () => number

  constructor(options: {
    repository: SurfaceRepository
    agents: WorkspaceAgentRepository
    channelLister: SurfaceChannelLister
    resolvePrincipal?: (principalId: string) => Promise<WorkspacePrincipal | null>
    id?: () => string
    now?: () => number
  }) {
    this.repository = options.repository
    this.agents = options.agents
    this.channelLister = options.channelLister
    this.resolvePrincipal = options.resolvePrincipal ?? (async () => null)
    this.id = options.id ?? randomUUID
    this.now = options.now ?? Date.now
  }

  async listConnections(args: {
    workspaceId: string
  }): Promise<SurfaceConnection[]> {
    return await this.repository.listConnections(args.workspaceId)
  }

  async listBindings(args: {
    actor: SurfaceActor
    workspaceId: string
    agentId: string
  }): Promise<SurfaceBinding[]> {
    await this.requireVisibleAgent(args)
    const bindings = await this.repository.listBindingsByAgent(args.agentId)
    // Bindings carry no workspaceId; scope them through their connection.
    const connectionIds = new Set(
      (await this.repository.listConnections(args.workspaceId)).map((c) => c.id),
    )
    return bindings.filter((b) => connectionIds.has(b.connectionId))
  }

  async listChannels(args: {
    workspaceId: string
    connectionId: string
  }): Promise<SurfaceChannelOption[]> {
    const connection = await this.requireWorkspaceConnection(args)
    return await this.channelLister(connection)
  }

  async createBinding(args: {
    actor: SurfaceActor
    workspaceId: string
    agentId: string
    connectionId: string
    channelId: string
    channelName?: string | null
  }): Promise<SurfaceBinding> {
    await this.requireBindableAgent(args)
    const connection = await this.requireWorkspaceConnection(args)
    if (connection.status !== 'active') {
      throw new SurfaceServiceError('conflict', 'Reconnect the surface before adding channels')
    }
    const channelId = args.channelId.trim()
    if (!channelId) {
      throw new SurfaceServiceError('validation', 'channelId is required')
    }
    const existing = await this.repository.findBindingByChannel(connection.id, channelId)
    if (existing && existing.status === 'active') {
      throw new SurfaceServiceError(
        'conflict',
        existing.agentId === args.agentId
          ? 'This channel is already connected to the agent'
          : 'This channel is already connected to another agent',
      )
    }
    const now = this.now()
    return await this.repository.createBinding({
      id: `surface_binding_${this.id()}`,
      connectionId: connection.id,
      agentId: args.agentId,
      channelId,
      channelName: args.channelName?.trim() || null,
      status: 'active',
      createdByUserId: args.actor.userId,
      createdAt: now,
      updatedAt: now,
    })
  }

  async removeBinding(args: {
    actor: SurfaceActor
    workspaceId: string
    bindingId: string
  }): Promise<SurfaceBinding> {
    const binding = await this.repository.getBinding(args.bindingId)
    if (!binding) throw new SurfaceServiceError('not_found', 'Surface binding not found')
    const connection = await this.repository.getConnection(binding.connectionId)
    if (!connection || connection.workspaceId !== args.workspaceId) {
      throw new SurfaceServiceError('not_found', 'Surface binding not found')
    }
    // Removing needs the same authority as binding: the agent must be one the
    // actor could connect in the first place.
    await this.requireBindableAgent({
      actor: args.actor,
      workspaceId: args.workspaceId,
      agentId: binding.agentId,
    })
    return await this.repository.updateBinding(binding.id, {
      status: 'removed',
      updatedAt: this.now(),
    })
  }

  /**
   * Registers a platform install after OAuth. Called from the callback route —
   * authorization there is the sealed OAuth state bound to the installing user.
   * A (platform, team) already owned by another Overlay workspace is rejected so
   * webhook routing can never fork between two customers.
   */
  async registerConnection(args: {
    workspaceId: string
    platform: SurfacePlatform
    externalTeamId: string
    externalTeamName?: string | null
    externalEnterpriseId?: string | null
    botUserId?: string | null
    installedByUserId: string
  }): Promise<SurfaceConnection> {
    const existing = await this.repository.findConnectionByTeam(args.platform, args.externalTeamId)
    if (existing && existing.workspaceId !== args.workspaceId) {
      throw new SurfaceServiceError(
        'conflict',
        'This Slack workspace is already connected to another Overlay workspace',
      )
    }
    const now = this.now()
    return await this.repository.upsertConnection({
      id: existing?.id ?? `surface_connection_${this.id()}`,
      workspaceId: args.workspaceId,
      platform: args.platform,
      externalTeamId: args.externalTeamId,
      externalTeamName: args.externalTeamName ?? null,
      externalEnterpriseId: args.externalEnterpriseId ?? null,
      botUserId: args.botUserId ?? null,
      status: 'active',
      installedByUserId: existing?.installedByUserId ?? args.installedByUserId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    })
  }

  /**
   * Marks a connection non-active when the platform reports the install is
   * gone (app_uninstalled → 'uninstalled', bot tokens_revoked → 'degraded')
   * or an outbound call discovers a revoked token. Tries the team id first,
   * then the enterprise id — org-level installs store it as externalTeamId.
   * Idempotent: already non-active connections are left alone. Returns true
   * when a connection transitioned.
   */
  async degradeConnectionByTeam(args: {
    platform: SurfacePlatform
    teamId?: string | null
    enterpriseId?: string | null
    status: Exclude<SurfaceConnectionStatus, 'active'>
  }): Promise<boolean> {
    const connection =
      (args.teamId
        ? await this.repository.findConnectionByTeam(args.platform, args.teamId)
        : null) ??
      (args.enterpriseId
        ? await this.repository.findConnectionByTeam(args.platform, args.enterpriseId)
        : null)
    if (!connection || connection.status !== 'active') return false
    await this.repository.updateConnection(connection.id, {
      status: args.status,
      updatedAt: this.now(),
    })
    return true
  }

  /**
   * Webhook routing: platform team + channel → live connection → active
   * binding → bound agent → creator identity. Returns null for every miss so
   * inbound handlers can no-op quietly (removed bindings, uninstalled
   * workspaces, archived agents all behave identically).
   */
  async resolveInboundBinding(args: {
    platform: SurfacePlatform
    externalTeamId: string
    channelId: string
  }): Promise<ResolvedInboundBinding | null> {
    const connection = await this.repository.findConnectionByTeam(
      args.platform,
      args.externalTeamId,
    )
    if (!connection || connection.status !== 'active') return null
    const binding = await this.repository.findBindingByChannel(connection.id, args.channelId)
    if (!binding || binding.status !== 'active') return null
    const agent = await this.agents.get({
      agentId: binding.agentId,
      workspaceId: connection.workspaceId,
    })
    if (!agent || agent.archivedAt) return null
    const principal = await this.resolvePrincipal(agent.createdByPrincipalId)
    if (!principal?.userId) return null
    return {
      connection,
      binding,
      agent,
      creatorUserId: principal.userId,
      creatorPrincipalId: principal.id,
    }
  }

  /**
   * Binding gate: the actor must be able to see the agent (existence check is
   * inside), must not be a guest, and creator-only agents can only be connected
   * by their creator.
   */
  async requireBindableAgent(args: {
    actor: SurfaceActor
    workspaceId: string
    agentId: string
  }): Promise<void> {
    const agent = await this.requireVisibleAgent(args)
    if (!canCreateAgent(args.actor.workspaceRole)) {
      throw new SurfaceServiceError('forbidden', 'Guests cannot connect agents to surfaces')
    }
    if (agent.visibility === 'creator' && agent.createdByPrincipalId !== args.actor.principalId) {
      throw new SurfaceServiceError(
        'forbidden',
        'Only the creator can connect a personal agent to a surface',
      )
    }
  }

  /**
   * Non-throwing bind gate for UI affordances — the editor needs to know
   * whether to render connect/binding controls without turning a permission
   * miss into a request failure. Invisible agents read as non-bindable.
   */
  async canBindAgent(args: {
    actor: SurfaceActor
    workspaceId: string
    agentId: string
  }): Promise<boolean> {
    try {
      await this.requireBindableAgent(args)
      return true
    } catch (_error) {
      return false
    }
  }

  private async requireVisibleAgent(args: {
    actor: SurfaceActor
    workspaceId: string
    agentId: string
  }) {
    const agent = await this.agents.get({ agentId: args.agentId, workspaceId: args.workspaceId })
    if (!agent || agent.archivedAt || !canSeeAgent(agent, args.actor.principalId)) {
      throw new SurfaceServiceError('not_found', 'Agent not found')
    }
    return agent
  }

  private async requireWorkspaceConnection(args: {
    workspaceId: string
    connectionId: string
  }): Promise<SurfaceConnection> {
    const connection = await this.repository.getConnection(args.connectionId)
    if (!connection || connection.workspaceId !== args.workspaceId) {
      throw new SurfaceServiceError('not_found', 'Surface connection not found')
    }
    return connection
  }
}
