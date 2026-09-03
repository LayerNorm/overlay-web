import 'server-only'

import { randomUUID } from 'node:crypto'
import type {
  WorkspaceAgentCreateInput,
  WorkspaceAgentDirectoryItem,
  WorkspaceAgentUpdateInput,
  WorkspaceAgentVisibility,
  WorkspaceMembershipRole,
} from '@overlay/workspace-contracts'
import { DEFAULT_MODEL_ID, FREE_TIER_AUTO_MODEL_ID } from '@/shared/ai/gateway/model-types'
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
    const agents = await this.repository.list({ workspaceId: access.workspace.id })
    const visible = agents.filter((agent) => canSeeAgent(agent, access.principal.id))
    // Attribute tiles to their creator. Resolved best-effort: an unknown
    // principal simply yields no owner line.
    const creators = await Promise.all(
      visible.map((agent) => this.workspaces.resolvePrincipal(agent.createdByPrincipalId)),
    )
    return {
      agents: visible.map((agent, index) => {
        const displayName = creators[index]?.displayName
        return displayName ? { ...agent, createdByDisplayName: displayName } : agent
      }),
      canCreate: canCreateAgent(access.membership.role),
    }
  }

  async get(args: { actorUserId: string; workspaceId: string; agentId: string }) {
    const access = await this.workspaces.resolveActiveWorkspace(args.actorUserId, args.workspaceId)
    await this.ensureDefaultAgent({ workspaceId: access.workspace.id, creatorPrincipalId: access.principal.id })
    const agent = await this.repository.get({ workspaceId: access.workspace.id, agentId: args.agentId })
    // Invisible agents report as not found so their existence does not leak to
    // other members.
    if (!agent || agent.archivedAt || !canSeeAgent(agent, access.principal.id)) {
      throw new WorkspaceAgentServiceError('not_found', 'Agent not found')
    }
    return agent
  }

  async ensureDefaultAgent(args: { workspaceId: string; creatorPrincipalId: string }) {
    const existing = await this.repository.list({ workspaceId: args.workspaceId })
    const currentDefault = existing.find((a) => a.isDefault || a.name.toLowerCase() === 'overlay')
    if (currentDefault) {
      // Default agents created before agents had a real tool surface were
      // pinned to the free router, which auto-selects a model that struggles to
      // drive a multi-step tool loop. Lift those onto the standard default; an
      // agent a human deliberately moved to some other model is left alone, and
      // the invocation still falls back to the free router when the payer is
      // not entitled to this one.
      if (currentDefault.modelId === FREE_TIER_AUTO_MODEL_ID) {
        await this.repository.update({
          agentId: currentDefault.id,
          workspaceId: args.workspaceId,
          modelId: DEFAULT_MODEL_ID,
          now: this.now(),
        }).catch((_error) => null)
      }
      return
    }
    const agentId = `default-overlay-${args.workspaceId}`
    const principalId = `default-overlay-principal-${args.workspaceId}`
    try {
      await this.repository.create({
        agentId,
        principalId,
        workspaceId: args.workspaceId,
        name: 'Overlay',
        description: 'Master workspace agent with full access to workspace context, memory, files, notes, automations, and all tools.',
        instructions: 'You are Overlay, the master workspace agent. You have full access to workspace context, files, notes, memories, automations, skills, and tools. Execute user tasks thoroughly and precisely using your available tools:\n- Recall before you answer: search your memory whenever the question touches the user, the workspace, past decisions, or how they like things done. Never say you know nothing without searching first.\n- Search and read workspace knowledge, files, and notes\n- Save and update memories when important user preferences or durable facts are shared\n- Create and edit notes or documents\n- Use web search, connected apps, and browser tools when live or external information is needed\n- Run code in sandboxes when computation or execution is required\n- Help create automations and skills for repeatable workflows\nAlways choose the most direct and effective tools to complete the user\'s request.',
        harness: 'overlay',
        modelId: DEFAULT_MODEL_ID,
        avatarColor: '#18181b',
        allowedToolIds: [],
        teamIds: [],
        isDefault: true,
        visibility: 'workspace',
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
        visibility: normalizeVisibility(args.input.visibility),
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
      ...(args.input.visibility === undefined ? {} : { visibility: args.input.visibility }),
      ...(teamIds === undefined ? {} : { teamIds }),
      updatedByPrincipalId: access.principal.id,
      now: this.now(),
    })
    if (!updated) throw new WorkspaceAgentServiceError('not_found', 'Agent not found')
    return updated
  }

  async archive(args: { actorUserId: string; workspaceId: string; agentId: string }) {
    const { access, agent } = await this.requireArchiver(args)
    if (agent.isDefault || agent.name.toLowerCase() === 'overlay') {
      throw new WorkspaceAgentServiceError('forbidden', 'The default Overlay agent cannot be deleted or archived')
    }
    if (!await this.repository.archive({
      workspaceId: access.workspace.id,
      agentId: agent.id,
      now: this.now(),
    })) throw new WorkspaceAgentServiceError('not_found', 'Agent not found')
  }

  /**
   * DM-creation guard: every requested agent principal must resolve to an
   * agent visible to the actor. Human principals, unknown principals, and
   * principals from other workspaces are left for the conversation layer's
   * own validation — this gate only adds the visibility check. Invisible
   * agents report as `not_found` so callers can map the failure to 404
   * without disclosing existence.
   */
  async assertDirectMessageTargets(args: {
    actorUserId: string
    workspaceId: string
    principalIds: string[]
  }): Promise<void> {
    const access = await this.workspaces.resolveActiveWorkspace(args.actorUserId, args.workspaceId)
    const uniquePrincipalIds = [...new Set(args.principalIds.map((principalId) => principalId.trim()).filter(Boolean))]
    const principals = await Promise.all(uniquePrincipalIds.map((principalId) => this.workspaces.resolvePrincipal(principalId)))
    const agentIds = principals.flatMap((principal) => (
      principal && principal.type === 'agent' && principal.agentId ? [principal.agentId] : []
    ))
    await Promise.all(agentIds.map((agentId) => this.get({
      actorUserId: args.actorUserId,
      workspaceId: access.workspace.id,
      agentId,
    })))
  }

  private async requireEditor(args: { actorUserId: string; workspaceId: string; agentId: string }) {
    const access = await this.workspaces.resolveActiveWorkspace(args.actorUserId, args.workspaceId)
    const agent = await this.repository.get({ workspaceId: access.workspace.id, agentId: args.agentId })
    // The visibility gate comes first: actors who cannot see the agent get
    // `not_found` here (never `forbidden`), so edit attempts cannot be used as
    // an existence oracle for creator-only agents. Managers reach creator-only
    // agents only through `archive()` via `requireArchiver`.
    if (!agent || agent.archivedAt || !canSeeAgent(agent, access.principal.id)) {
      throw new WorkspaceAgentServiceError('not_found', 'Agent not found')
    }
    const isManager = access.membership.role === 'owner' || access.membership.role === 'admin'
    if (!isManager && agent.createdByPrincipalId !== access.principal.id) {
      throw new WorkspaceAgentServiceError('forbidden', 'Only the creator or a workspace manager can edit this agent')
    }
    return { access, agent }
  }

  /**
   * Archive allows the manager safety valve on creator-only agents, so it
   * authorizes without the read-side visibility gate: creator or manager may
   * act; anyone else gets `not_found` when the agent is invisible to them and
   * `forbidden` when it is visible but not theirs to manage.
   */
  private async requireArchiver(args: { actorUserId: string; workspaceId: string; agentId: string }) {
    const access = await this.workspaces.resolveActiveWorkspace(args.actorUserId, args.workspaceId)
    const agent = await this.repository.get({ workspaceId: access.workspace.id, agentId: args.agentId })
    if (!agent || agent.archivedAt) throw new WorkspaceAgentServiceError('not_found', 'Agent not found')
    const isManager = access.membership.role === 'owner' || access.membership.role === 'admin'
    const isCreator = agent.createdByPrincipalId === access.principal.id
    if (!isManager && !isCreator) {
      if (!canSeeAgent(agent, access.principal.id)) {
        throw new WorkspaceAgentServiceError('not_found', 'Agent not found')
      }
      throw new WorkspaceAgentServiceError('forbidden', 'Only the creator or a workspace manager can archive this agent')
    }
    return { access, agent }
  }
}

export function canCreateAgent(role: WorkspaceMembershipRole) {
  return role !== 'guest'
}

/** Creator-only agents are visible to their creator alone. */
export function canSeeAgent(agent: Pick<WorkspaceAgentDirectoryItem, 'visibility' | 'createdByPrincipalId'>, principalId: string) {
  return agent.visibility !== 'creator' || agent.createdByPrincipalId === principalId
}

function normalizeVisibility(value: WorkspaceAgentVisibility | undefined): WorkspaceAgentVisibility {
  return value === 'creator' ? 'creator' : 'workspace'
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
