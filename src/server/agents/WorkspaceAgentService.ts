import 'server-only'

import { randomUUID } from 'node:crypto'
import type {
  WorkspaceAgentCreateInput,
  WorkspaceAgentDirectoryItem,
  WorkspaceAgentUpdateInput,
  WorkspaceMembershipRole,
} from '@overlay/workspace-contracts'
import type { WorkspaceService } from '@/server/workspaces/WorkspaceService'
import type { WorkspaceAgentRepository } from './WorkspaceAgentRepository'

export class WorkspaceAgentServiceError extends Error {
  constructor(
    public readonly code: 'forbidden' | 'not_found' | 'validation' | 'conflict',
    message: string,
  ) {
    super(message)
    this.name = 'WorkspaceAgentServiceError'
  }
}

export class WorkspaceAgentService {
  constructor(
    private readonly repository: WorkspaceAgentRepository,
    private readonly workspaces: WorkspaceService,
    private readonly id: () => string = randomUUID,
    private readonly now: () => number = Date.now,
  ) {}

  async list(args: { actorUserId: string; workspaceId: string }) {
    const access = await this.workspaces.resolveActiveWorkspace(args.actorUserId, args.workspaceId)
    await this.ensureDefaultAgent({ workspaceId: access.workspace.id, creatorPrincipalId: access.principal.id })
    return {
      agents: await this.repository.list({ workspaceId: access.workspace.id }),
      canCreate: canCreateAgent(access.membership.role),
    }
  }

  async get(args: { actorUserId: string; workspaceId: string; agentId: string }) {
    const access = await this.workspaces.resolveActiveWorkspace(args.actorUserId, args.workspaceId)
    await this.ensureDefaultAgent({ workspaceId: access.workspace.id, creatorPrincipalId: access.principal.id })
    const agent = await this.repository.get({ workspaceId: access.workspace.id, agentId: args.agentId })
    if (!agent || agent.archivedAt) throw new WorkspaceAgentServiceError('not_found', 'Agent not found')
    return agent
  }

  async ensureDefaultAgent(args: { workspaceId: string; creatorPrincipalId: string }) {
    const existing = await this.repository.list({ workspaceId: args.workspaceId })
    const hasDefault = existing.some((a) => a.isDefault || a.name.toLowerCase() === 'overlay')
    if (hasDefault) return
    const agentId = `default-overlay-${args.workspaceId}`
    const principalId = `default-overlay-principal-${args.workspaceId}`
    try {
      await this.repository.create({
        agentId,
        principalId,
        workspaceId: args.workspaceId,
        name: 'Overlay',
        description: 'Master workspace agent with full access to workspace context, memory, files, notes, automations, and all tools.',
        instructions: 'You are Overlay, the master workspace agent. You have full access to workspace context, files, notes, memories, automations, skills, and tools. Execute user tasks thoroughly and precisely using your available tools:\n- Search and read workspace knowledge, files, and notes\n- Save and update memories when important user preferences or durable facts are shared\n- Create and edit notes or documents\n- Use web search and browser tools when live or external information is needed\n- Run code in sandboxes when computation or execution is required\n- Help create automations and skills for repeatable workflows\nAlways choose the most direct and effective tools to complete the user\'s request.',
        harness: 'overlay',
        modelId: 'openrouter/free',
        avatarColor: '#18181b',
        allowedToolIds: [],
        teamIds: [],
        isDefault: true,
        createdByPrincipalId: args.creatorPrincipalId,
        now: this.now(),
      })
    } catch (_error) {
      // Ignore if already created concurrently
    }
  }

  async create(args: {
    actorUserId: string
    workspaceId: string
    input: WorkspaceAgentCreateInput
  }): Promise<WorkspaceAgentDirectoryItem> {
    const access = await this.workspaces.resolveActiveWorkspace(args.actorUserId, args.workspaceId)
    if (!canCreateAgent(access.membership.role)) {
      throw new WorkspaceAgentServiceError('forbidden', 'Guests cannot create agents')
    }
    // Workspace policy can restrict agent creation to owners and admins, and can
    // restrict which runtimes are allowed to exist at all.
    await this.workspaces.assertMemberMayCreate({
      actorUserId: args.actorUserId,
      workspaceId: access.workspace.id,
      capability: 'agent',
    })
    const name = required(args.input.name, 'Agent name', 80)
    const instructions = required(args.input.instructions, 'Agent instructions', 20_000)
    const modelId = required(args.input.modelId, 'Model', 200)
    const harness = args.input.harness ?? 'overlay'
    if (harness !== 'overlay' && harness !== 'claude-code') {
      throw new WorkspaceAgentServiceError('validation', 'Unsupported agent harness')
    }
    await this.workspaces.assertAgentHarnessAllowed({
      actorUserId: args.actorUserId,
      workspaceId: access.workspace.id,
      harness,
    })
    const teams = await this.workspaces.listTeams({
      actorUserId: args.actorUserId,
      workspaceId: access.workspace.id,
    })
    const availableTeamIds = new Set(teams.map(({ team }) => team.id))
    const teamIds = unique(args.input.teamIds ?? [])
    if (teamIds.some((teamId) => !availableTeamIds.has(teamId))) {
      throw new WorkspaceAgentServiceError('validation', 'One or more teams do not exist in this workspace')
    }
    const agentId = this.id()
    try {
      return await this.repository.create({
        agentId,
        principalId: this.id(),
        workspaceId: access.workspace.id,
        name,
        description: optional(args.input.description, 240),
        instructions,
        harness,
        modelId,
        avatarColor: color(args.input.avatarColor),
        allowedToolIds: unique(args.input.allowedToolIds ?? []),
        teamIds,
        createdByPrincipalId: access.principal.id,
        now: this.now(),
      })
    } catch (error) {
      if (String(error).includes('ALREADY') || String(error).includes('unique')) {
        throw new WorkspaceAgentServiceError('conflict', 'An active agent already uses this name')
      }
      throw error
    }
  }

  async update(args: {
    actorUserId: string
    workspaceId: string
    agentId: string
    input: WorkspaceAgentUpdateInput
  }) {
    const { access, agent } = await this.requireEditor(args)
    if (args.input.harness !== undefined
      && args.input.harness !== 'overlay'
      && args.input.harness !== 'claude-code') {
      throw new WorkspaceAgentServiceError('validation', 'Unsupported agent harness')
    }
    let teamIds: string[] | undefined
    if (args.input.teamIds !== undefined) {
      teamIds = unique(args.input.teamIds)
      const teams = await this.workspaces.listTeams({
        actorUserId: args.actorUserId,
        workspaceId: access.workspace.id,
      })
      const available = new Set(teams.map(({ team }) => team.id))
      if (teamIds.some((teamId) => !available.has(teamId))) {
        throw new WorkspaceAgentServiceError('validation', 'One or more teams do not exist in this workspace')
      }
    }
    const updated = await this.repository.update({
      agentId: agent.id,
      workspaceId: access.workspace.id,
      ...(args.input.name === undefined ? {} : { name: required(args.input.name, 'Agent name', 80) }),
      ...(args.input.description === undefined ? {} : { description: optional(args.input.description, 240) }),
      ...(args.input.instructions === undefined
        ? {}
        : { instructions: required(args.input.instructions, 'Agent instructions', 20_000) }),
      ...(args.input.modelId === undefined ? {} : { modelId: required(args.input.modelId, 'Model', 200) }),
      ...(args.input.harness === undefined ? {} : { harness: args.input.harness }),
      ...(args.input.avatarColor === undefined ? {} : { avatarColor: color(args.input.avatarColor) }),
      ...(args.input.allowedToolIds === undefined ? {} : { allowedToolIds: unique(args.input.allowedToolIds) }),
      ...(teamIds === undefined ? {} : { teamIds }),
      updatedByPrincipalId: access.principal.id,
      now: this.now(),
    })
    if (!updated) throw new WorkspaceAgentServiceError('not_found', 'Agent not found')
    return updated
  }

  async archive(args: { actorUserId: string; workspaceId: string; agentId: string }) {
    const { access, agent } = await this.requireEditor(args)
    if (agent.isDefault || agent.name.toLowerCase() === 'overlay') {
      throw new WorkspaceAgentServiceError('forbidden', 'The default Overlay agent cannot be deleted or archived')
    }
    if (!await this.repository.archive({
      workspaceId: access.workspace.id,
      agentId: agent.id,
      now: this.now(),
    })) throw new WorkspaceAgentServiceError('not_found', 'Agent not found')
  }

  private async requireEditor(args: { actorUserId: string; workspaceId: string; agentId: string }) {
    const access = await this.workspaces.resolveActiveWorkspace(args.actorUserId, args.workspaceId)
    const agent = await this.repository.get({ workspaceId: access.workspace.id, agentId: args.agentId })
    if (!agent || agent.archivedAt) throw new WorkspaceAgentServiceError('not_found', 'Agent not found')
    const isManager = access.membership.role === 'owner' || access.membership.role === 'admin'
    if (!isManager && agent.createdByPrincipalId !== access.principal.id) {
      throw new WorkspaceAgentServiceError('forbidden', 'Only the creator or a workspace manager can edit this agent')
    }
    return { access, agent }
  }
}

export function canCreateAgent(role: WorkspaceMembershipRole) {
  return role !== 'guest'
}

function required(value: string, label: string, max: number) {
  const normalized = value.trim()
  if (!normalized) throw new WorkspaceAgentServiceError('validation', `${label} is required`)
  if (normalized.length > max) throw new WorkspaceAgentServiceError('validation', `${label} is too long`)
  return normalized
}

function optional(value: string | undefined, max: number) {
  const normalized = value?.trim()
  if (!normalized) return undefined
  if (normalized.length > max) throw new WorkspaceAgentServiceError('validation', 'Description is too long')
  return normalized
}

function color(value?: string) {
  const normalized = value?.trim()
  if (!normalized) return undefined
  if (!/^#[0-9a-f]{6}$/i.test(normalized)) {
    throw new WorkspaceAgentServiceError('validation', 'Avatar color must be a six-digit hex color')
  }
  return normalized.toLowerCase()
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}
