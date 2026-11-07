import { v } from 'convex/values'
import type { Doc } from '../_generated/dataModel'
import { mutation, query } from '../_generated/server'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { requireServerSecret } from '../lib/auth'
import { DEFAULT_MODEL_ID } from '@/shared/ai/gateway/model-types'
import { DEFAULT_AGENT_TOOL_GROUP_IDS, toolIdsForEnabledGroups } from '@/shared/agents/tool-groups'
import { WORKSPACE_AGENT_CREATURE_SHAPES } from '@overlay/workspace-contracts'

const harness = v.union(
  v.literal('overlay'),
  v.literal('claude-code'),
  v.literal('codex'),
  v.literal('opencode'),
  v.literal('pi'),
  v.literal('hermes'),
)
const writableHarness = v.union(v.literal('overlay'), v.literal('claude-code'), v.literal('codex'))
const agentVisibility = v.union(v.literal('creator'), v.literal('workspace'))
const agentRole = v.union(v.literal('workspace_chief'), v.literal('personal_chief'), v.literal('agent'))
const chiefScope = v.union(v.literal('personal'), v.literal('workspace'))
const agentValidator = v.object({
  agentId: v.string(),
  workspaceId: v.string(),
  principalId: v.string(),
  name: v.string(),
  description: v.optional(v.string()),
  instructions: v.string(),
  harness,
  modelId: v.string(),
  reasoning: v.optional(v.union(
    v.literal('provider-default'),
    v.literal('none'),
    v.literal('minimal'),
    v.literal('low'),
    v.literal('medium'),
    v.literal('high'),
    v.literal('xhigh'),
  )),
  permissionMode: v.optional(v.string()),
  effort: v.optional(v.string()),
  avatarColor: v.optional(v.string()),
  avatarShape: v.optional(v.string()),
  allowedToolIds: v.array(v.string()),
  invocationPolicy: v.literal('mention'),
  visibility: agentVisibility,
  createdByPrincipalId: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
  archivedAt: v.optional(v.number()),
  teamIds: v.array(v.string()),
  roomCount: v.number(),
  isDefault: v.optional(v.boolean()),
  agentRole: v.optional(agentRole),
  chiefOwnerUserId: v.optional(v.string()),
  chiefScope: v.optional(chiefScope),
})

export const createByServer = mutation({
  args: {
    serverSecret: v.string(), agentId: v.string(), principalId: v.string(), workspaceId: v.string(),
    name: v.string(), description: v.optional(v.string()), instructions: v.string(), harness: writableHarness,
    permissionMode: v.optional(v.string()), effort: v.optional(v.string()),
    reasoning: v.optional(v.union(
      v.literal('provider-default'),
      v.literal('none'),
      v.literal('minimal'),
      v.literal('low'),
      v.literal('medium'),
      v.literal('high'),
      v.literal('xhigh'),
    )),
    modelId: v.string(), avatarColor: v.optional(v.string()), avatarShape: v.optional(v.string()),
    allowedToolIds: v.array(v.string()),
    teamIds: v.array(v.string()), visibility: v.optional(agentVisibility),
    createdByPrincipalId: v.string(), now: v.number(),
    isDefault: v.optional(v.boolean()),
  },
  returns: agentValidator,
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    await requireActiveWorkspace(ctx, args.workspaceId)
    await requirePrincipal(ctx, args.workspaceId, args.createdByPrincipalId)
    if (!args.name.trim() || !args.instructions.trim() || !args.modelId.trim()) {
      throw new Error('WORKSPACE_AGENT_INVALID')
    }
    const duplicate = (
      await ctx.db
        .query('workspaceAgentDefinitions')
        .withIndex('by_workspaceId', (q) =>
          q.eq('workspaceId', args.workspaceId),
        )
        .collect()
    ).find(
      (item) =>
        item.name.toLowerCase() === args.name.trim().toLowerCase() &&
        !item.archivedAt,
    )
    if (duplicate && !duplicate.archivedAt)
      throw new Error('WORKSPACE_AGENT_ALREADY_EXISTS')
    if (
      await ctx.db
        .query('workspaceAgentDefinitions')
        .withIndex('by_agentId', (q) => q.eq('agentId', args.agentId))
        .unique()
    ) {
      throw new Error('WORKSPACE_AGENT_ALREADY_EXISTS')
    }
    await ctx.db.insert('workspacePrincipals', {
      principalId: args.principalId, workspaceId: args.workspaceId, type: 'agent', agentId: args.agentId,
      displayName: args.name.trim(), createdByPrincipalId: args.createdByPrincipalId,
      createdAt: args.now, updatedAt: args.now,
    })
    await ctx.db.insert('workspaceMemberships', {
      membershipId: `${args.agentId}:membership`, workspaceId: args.workspaceId,
      principalId: args.principalId, role: 'member', status: 'active',
      invitedByPrincipalId: args.createdByPrincipalId, joinedAt: args.now, updatedAt: args.now,
    })
    const definitionId = await ctx.db.insert('workspaceAgentDefinitions', {
      agentId: args.agentId, workspaceId: args.workspaceId, principalId: args.principalId,
      name: args.name.trim(), description: cleanOptional(args.description),
      instructions: args.instructions.trim(), harness: args.harness, modelId: args.modelId.trim(),
      ...(args.permissionMode === undefined ? {} : { permissionMode: args.permissionMode.trim() }),
      ...(args.effort === undefined ? {} : { effort: args.effort.trim() }),
      ...(args.reasoning === undefined ? {} : { reasoning: args.reasoning }),
      avatarColor: cleanOptional(args.avatarColor), avatarShape: cleanOptional(args.avatarShape),
      allowedToolIds: unique(args.allowedToolIds),
      invocationPolicy: 'mention', visibility: args.visibility ?? 'workspace',
      createdByPrincipalId: args.createdByPrincipalId,
      teamIds: unique(args.teamIds), roomCount: 0,
      createdAt: args.now, updatedAt: args.now,
      ...(args.isDefault === undefined ? {} : { isDefault: args.isDefault }),
    })
    const newTeams = await Promise.all(unique(args.teamIds).map((teamId) =>
      ctx.db.query('workspaceTeams').withIndex('by_teamId', (q) => q.eq('teamId', teamId)).unique()))
    const joinableTeamIds = unique(args.teamIds).filter((teamId, i) => {
      const team = newTeams[i]
      return team && team.workspaceId === args.workspaceId && !team.archivedAt
    })
    await Promise.all(joinableTeamIds.map((teamId) =>
      ctx.db.insert('workspaceTeamMemberships', {
        teamMembershipId: `${teamId}:${args.principalId}`, workspaceId: args.workspaceId,
        teamId, principalId: args.principalId, principalType: 'agent',
        addedByPrincipalId: args.createdByPrincipalId, createdAt: args.now,
      })))
    // Creator-only agents join no channels implicitly: only their creator can
    // place them anywhere, and only the creator can invoke them.
    if ((args.visibility ?? 'workspace') !== 'creator') {
      const channels = await ctx.db
        .query('conversations')
        .withIndex('by_workspaceId_conversationType_lastModified', (q) =>
          q
            .eq('workspaceId', args.workspaceId)
            .eq('conversationType', 'channel'),
        )
        .collect()
      await Promise.all(channels
        .filter((channel) => !channel.deletedAt && channel.channelVisibility === 'public')
        .map((channel) => ctx.db.insert('conversationParticipants', {
          conversationId: channel._id, workspaceId: args.workspaceId, principalId: args.principalId,
          principalType: 'agent', role: 'member', status: 'active', notificationLevel: 'mentions',
          joinedAt: args.now, updatedAt: args.now,
        })))
    }
    await ctx.db.insert('workspaceResourceScopes', {
      workspaceId: args.workspaceId, resourceType: 'agent', resourceId: args.agentId,
      createdAt: args.now, updatedAt: args.now,
    })
    return await directoryValue(ctx, (await ctx.db.get(definitionId))!)
  },
})

export const getByServer = query({
  args: { serverSecret: v.string(), agentId: v.string(), workspaceId: v.string() },
  returns: v.union(agentValidator, v.null()),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const row = await ctx.db
      .query('workspaceAgentDefinitions')
      .withIndex('by_agentId', (q) => q.eq('agentId', args.agentId))
      .unique()
    return row && row.workspaceId === args.workspaceId && !row.deletedAt
      && (row.agentRole !== 'personal_chief' || !row.chiefOwnerUserId || await isActiveNonGuestHumanOwner(ctx, row.workspaceId, row.chiefOwnerUserId))
      ? await directoryValue(ctx, row)
      : null
  },
})

export const listByServer = query({
  args: { serverSecret: v.string(), workspaceId: v.string(), includeArchived: v.optional(v.boolean()) },
  returns: v.array(agentValidator),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const rows = await ctx.db
      .query('workspaceAgentDefinitions')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', args.workspaceId))
      .collect()
    const activeOwnerIds = new Set(
      (await ctx.db.query('workspaceMemberships')
        .withIndex('by_workspaceId', (q) => q.eq('workspaceId', args.workspaceId)).collect())
        .filter((membership) => membership.status === 'active' && membership.role !== 'guest')
        .map((membership) => membership.principalId),
    )
    const activeHumanOwnerIds = new Set(
      (await ctx.db.query('workspacePrincipals')
        .withIndex('by_workspaceId', (q) => q.eq('workspaceId', args.workspaceId)).collect())
        .filter((principal) => principal.type === 'human' && principal.userId
          && !principal.archivedAt && activeOwnerIds.has(principal.principalId))
        .map((principal) => principal.userId!),
    )
    const visible = rows
      .filter((row) => !row.deletedAt && (args.includeArchived || !row.archivedAt))
      .filter((row) => row.agentRole !== 'personal_chief' || !row.chiefOwnerUserId || activeHumanOwnerIds.has(row.chiefOwnerUserId))
      .sort(
        (a, b) =>
          a.name.localeCompare(b.name) || a.agentId.localeCompare(b.agentId),
      )
    return await Promise.all(visible.map((row) => directoryValue(ctx, row)))
  },
})

/**
 * Atomically provisions the two chief scopes for a workspace. Convex retries
 * concurrent mutations, while deterministic IDs and role checks make retries
 * idempotent even when an older row is being adopted.
 */
export const ensureChiefsByServer = mutation({
  args: {
    serverSecret: v.string(),
    workspaceId: v.string(),
    actorUserId: v.string(),
    actorPrincipalId: v.string(),
    now: v.number(),
  },
  returns: v.array(agentValidator),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    return await ensureWorkspaceChiefs(ctx, args)
  },
})

/** Idempotently provisions a workspace's chief agents for an active, non-guest human member. */
export async function ensureWorkspaceChiefs(
  ctx: MutationCtx,
  args: { workspaceId: string; actorUserId: string; actorPrincipalId: string; now: number },
) {
    const workspace = await requireActiveWorkspace(ctx, args.workspaceId)
    const actor = await requireActiveHumanMembership(ctx, args.workspaceId, args.actorUserId, args.actorPrincipalId)
    if (actor.membership.role === 'guest') throw new Error('WORKSPACE_AGENT_EDIT_FORBIDDEN')
    const definitions = await ctx.db.query('workspaceAgentDefinitions')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', args.workspaceId)).collect()
    const live = definitions.filter((row) => !row.deletedAt)
    const legacy = findAdoptableLegacyDefault(live, args.workspaceId)

    const workspaceChiefRows = live.filter((row) => row.agentRole === 'workspace_chief')
    if (workspaceChiefRows.length > 1) throw new Error('CHIEF_ROLE_NOT_UNIQUE')
    let workspaceChief = workspaceChiefRows[0]
    if (workspaceChief && (workspaceChief.chiefScope !== 'workspace'
      || (workspaceChief.visibility ?? 'workspace') !== 'workspace'
      || workspaceChief.harness !== 'overlay'
      || workspaceChief.archivedAt)) throw new Error('CHIEF_BINDING_INVARIANT')
    if (!workspaceChief) {
      const candidate = workspace.kind === 'organization' ? legacy : undefined
      if (candidate?.archivedAt) throw new Error('CHIEF_BINDING_INVARIANT')
      workspaceChief = candidate
        ? await adoptChief(ctx, candidate, 'workspace_chief', 'workspace', undefined, args.now)
        : await insertChief(ctx, {
            workspace,
            agentId: `workspace-chief-${args.workspaceId}`,
            principalId: `workspace-chief-principal-${args.workspaceId}`,
            role: 'workspace_chief',
            scope: 'workspace',
            ownerUserId: undefined,
            createdByPrincipalId: actor.principal.principalId,
            visibility: 'workspace',
            name: 'Overlay',
            description: 'Workspace chief of staff.',
            instructions: 'You are the workspace chief of staff. Help coordinate work across this workspace.',
            allowedToolIds: [],
            isDefault: true,
            now: args.now,
          })
    }

    const eligible = await eligiblePersonalOwners(ctx, workspace, args.actorUserId, args.actorPrincipalId)
    const ensured: Doc<'workspaceAgentDefinitions'>[] = [workspaceChief]
    for (const owner of eligible) {
      const existingRows = live.filter((row) =>
        row.agentRole === 'personal_chief'
        && row.chiefOwnerUserId === owner.userId)
      if (existingRows.some((row) => row.chiefScope !== 'personal' && row.chiefScope !== 'workspace')) {
        throw new Error('CHIEF_BINDING_INVARIANT')
      }
      const existingPrivateRows = existingRows.filter((row) => row.chiefScope === 'personal')
      const existingWorkspaceRows = existingRows.filter((row) => row.chiefScope === 'workspace')
      if (existingPrivateRows.length > 1 || existingWorkspaceRows.length > 1) {
        throw new Error('CHIEF_ROLE_NOT_UNIQUE')
      }
      const existingPrivate = existingPrivateRows[0]
      const existingWorkspace = existingWorkspaceRows[0]
      if (existingPrivate && (existingPrivate.harness !== 'overlay' || existingPrivate.archivedAt)) {
        throw new Error('CHIEF_BINDING_INVARIANT')
      }
      if (existingWorkspace && ((existingWorkspace.visibility ?? 'workspace') !== 'workspace'
        || existingWorkspace.harness !== 'overlay' || existingWorkspace.archivedAt)) {
        throw new Error('CHIEF_BINDING_INVARIANT')
      }
      const oldDefault = workspace.kind === 'personal' && owner.userId === workspace.personalOwnerUserId
        ? legacy
        : undefined
      if (oldDefault?.archivedAt) throw new Error('CHIEF_BINDING_INVARIANT')
      const personal = existingPrivate
        ?? (oldDefault && oldDefault.agentRole === undefined
          ? await adoptChief(ctx, oldDefault, 'personal_chief', 'personal', owner.userId, args.now)
          : await createPersonalChief(ctx, workspace, owner, 'personal', args.now))
      const privateBinding = personal.visibility === 'creator'
        ? personal
        : (await ctx.db.patch(personal._id, { visibility: 'creator', updatedAt: args.now }),
          { ...personal, visibility: 'creator' as const, updatedAt: args.now })
      const workspaceBinding = existingWorkspace
        ?? await createPersonalChief(ctx, workspace, owner, 'workspace', args.now)
      ensured.push(privateBinding, workspaceBinding)
    }
    return await Promise.all(ensured.map((row) => directoryValue(ctx, row)))
}

export const updateChiefIdentityByServer = mutation({
  args: {
    serverSecret: v.string(),
    ownerUserId: v.string(),
    updatedByPrincipalId: v.string(),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    avatarColor: v.optional(v.string()),
    avatarShape: v.optional(v.string()),
    now: v.number(),
  },
  returns: v.object({
    userId: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    avatarColor: v.string(),
    avatarShape: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const principal = await ctx.db.query('workspacePrincipals')
      .withIndex('by_principalId', (q) => q.eq('principalId', args.updatedByPrincipalId)).unique()
    if (!principal || principal.type !== 'human' || principal.userId !== args.ownerUserId || principal.archivedAt) {
      throw new Error('CHIEF_IDENTITY_OWNER_REQUIRED')
    }
    await requireActiveWorkspace(ctx, principal.workspaceId)
    const membership = await ctx.db.query('workspaceMemberships')
      .withIndex('by_workspaceId_principalId', (q) =>
        q.eq('workspaceId', principal.workspaceId).eq('principalId', principal.principalId)).unique()
    if (!membership || membership.status !== 'active' || membership.role === 'guest') {
      throw new Error('CHIEF_IDENTITY_OWNER_REQUIRED')
    }
    return await applyChiefIdentityPatch(ctx, args)
  },
})

async function applyChiefIdentityPatch(
  ctx: MutationCtx,
  args: {
    ownerUserId: string
    name?: string
    description?: string
    avatarColor?: string
    avatarShape?: string
    now: number
  },
) {
  const existing = await ctx.db.query('personalChiefIdentities')
    .withIndex('by_userId', (q) => q.eq('userId', args.ownerUserId)).unique()
  const chief = await ctx.db.query('workspaceAgentDefinitions')
    .withIndex('by_chiefOwnerUserId', (q) => q.eq('chiefOwnerUserId', args.ownerUserId)).collect()
    .then((rows) => rows.find((row) => row.agentRole === 'personal_chief' && !row.deletedAt))
  if (!chief && !existing) throw new Error('CHIEF_IDENTITY_NOT_FOUND')
  const identity = existing ?? await ctx.db.insert('personalChiefIdentities', {
    userId: args.ownerUserId,
    name: chief!.name,
    description: chief!.description,
    avatarColor: chief!.avatarColor ?? '#8b5cf6',
    avatarShape: chief!.avatarShape ?? 'squircle',
    createdAt: args.now,
    updatedAt: args.now,
  }).then((id) => ctx.db.get(id))
  if (!identity) throw new Error('CHIEF_IDENTITY_NOT_FOUND')
  const name = args.name === undefined ? undefined : required(args.name, 'CHIEF_IDENTITY_NAME')
  if (name && name.length > 80) throw new Error('CHIEF_IDENTITY_NAME_INVALID')
  const description = args.description === undefined ? undefined : cleanOptional(args.description)
  if (description && description.length > 240) throw new Error('CHIEF_IDENTITY_DESCRIPTION_INVALID')
  const avatarColor = args.avatarColor === undefined
    ? undefined
    : required(args.avatarColor, 'CHIEF_IDENTITY_AVATAR_COLOR').toLowerCase()
  if (avatarColor && !/^#[0-9a-f]{6}$/i.test(avatarColor)) throw new Error('CHIEF_IDENTITY_AVATAR_COLOR_INVALID')
  const avatarShape = args.avatarShape === undefined ? undefined : required(args.avatarShape, 'CHIEF_IDENTITY_AVATAR_SHAPE')
  if (avatarShape && !(WORKSPACE_AGENT_CREATURE_SHAPES as readonly string[]).includes(avatarShape)) {
    throw new Error('CHIEF_IDENTITY_AVATAR_SHAPE_INVALID')
  }
  const patch = {
    ...(name === undefined ? {} : { name }),
    ...(args.description === undefined ? {} : { description }),
    ...(avatarColor === undefined ? {} : { avatarColor }),
    ...(avatarShape === undefined ? {} : { avatarShape }),
    updatedAt: args.now,
  }
  await ctx.db.patch(identity._id, patch)
  const next = { ...identity, ...patch }
  const rows = await ctx.db.query('workspaceAgentDefinitions')
    .withIndex('by_chiefOwnerUserId', (q) => q.eq('chiefOwnerUserId', args.ownerUserId)).collect()
  await Promise.all(rows.filter((row) => row.agentRole === 'personal_chief').map(async (row) => {
    const agentPrincipal = await ctx.db.query('workspacePrincipals')
      .withIndex('by_principalId', (q) => q.eq('principalId', row.principalId)).unique()
    if (agentPrincipal) {
      await ctx.db.patch(agentPrincipal._id, {
        displayName: next.name,
        avatarColor: next.avatarColor,
        avatarShape: next.avatarShape,
        updatedAt: args.now,
      })
    }
  }))
  return {
    userId: next.userId,
    name: next.name,
    description: next.description,
    avatarColor: next.avatarColor,
    avatarShape: next.avatarShape,
    createdAt: next.createdAt,
    updatedAt: next.updatedAt,
  }
}

export const updateByServer = mutation({
  args: {
    serverSecret: v.string(), agentId: v.string(), workspaceId: v.string(),
    name: v.optional(v.string()), description: v.optional(v.string()), instructions: v.optional(v.string()),
    permissionMode: v.optional(v.string()), effort: v.optional(v.string()),
    reasoning: v.optional(v.union(
      v.literal('provider-default'),
      v.literal('none'),
      v.literal('minimal'),
      v.literal('low'),
      v.literal('medium'),
      v.literal('high'),
      v.literal('xhigh'),
    )),
    harness: v.optional(writableHarness), modelId: v.optional(v.string()), avatarColor: v.optional(v.string()),
    avatarShape: v.optional(v.string()),
    allowedToolIds: v.optional(v.array(v.string())), now: v.number(),
    teamIds: v.optional(v.array(v.string())), visibility: v.optional(agentVisibility),
    updatedByPrincipalId: v.optional(v.string()),
  },
  returns: v.union(agentValidator, v.null()),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const row = await ctx.db
      .query('workspaceAgentDefinitions')
      .withIndex('by_agentId', (q) => q.eq('agentId', args.agentId))
      .unique()
    if (!row || row.workspaceId !== args.workspaceId || row.archivedAt)
      return null
    if (row.agentRole === 'personal_chief' || row.agentRole === 'workspace_chief') {
      if (!args.updatedByPrincipalId) throw new Error('CHIEF_OWNER_REQUIRED')
      if (row.agentRole === 'personal_chief') {
        const actor = await requireActiveHumanMembership(ctx, args.workspaceId, row.chiefOwnerUserId ?? '', args.updatedByPrincipalId)
        if (actor.membership.role === 'guest') throw new Error('CHIEF_OWNER_REQUIRED')
      } else {
        const actor = await requireActiveHumanMembershipForPrincipal(ctx, args.workspaceId, args.updatedByPrincipalId)
        if (actor.membership.role === 'guest') throw new Error('WORKSPACE_AGENT_EDIT_FORBIDDEN')
        if (actor.membership.role !== 'owner' && actor.membership.role !== 'admin'
          && row.createdByPrincipalId !== args.updatedByPrincipalId) {
          throw new Error('WORKSPACE_AGENT_EDIT_FORBIDDEN')
        }
      }
      if (args.visibility !== undefined && args.visibility !== (row.chiefScope === 'personal' ? 'creator' : 'workspace')) {
        throw new Error('CHIEF_BINDING_INVARIANT')
      }
      if (args.harness !== undefined && args.harness !== 'overlay') throw new Error('CHIEF_BINDING_INVARIANT')
      if (row.agentRole === 'personal_chief'
        && (args.name !== undefined || args.description !== undefined || args.avatarColor !== undefined || args.avatarShape !== undefined)) {
        await applyChiefIdentityPatch(ctx, {
          ownerUserId: row.chiefOwnerUserId!,
          name: args.name,
          description: args.description,
          avatarColor: args.avatarColor,
          avatarShape: args.avatarShape,
          now: args.now,
        })
      }
    }
    if (
      row.agentRole !== 'personal_chief' &&
      args.name &&
      args.name.trim().toLowerCase() !== row.name.toLowerCase()
    ) {
      const duplicate = (
        await ctx.db
          .query('workspaceAgentDefinitions')
          .withIndex('by_workspaceId', (q) =>
            q.eq('workspaceId', args.workspaceId),
          )
          .collect()
      ).find(
        (item) =>
          item._id !== row._id &&
          !item.archivedAt &&
          item.name.toLowerCase() === args.name!.trim().toLowerCase(),
      )
      if (duplicate) throw new Error('WORKSPACE_AGENT_ALREADY_EXISTS')
    }
    const patch: {
      name?: string
      description?: string
      instructions?: string
      harness?:
        | 'overlay'
        | 'claude-code'
        | 'codex'
        | 'opencode'
        | 'pi'
        | 'hermes'
      modelId?: string
      permissionMode?: string
      effort?: string
      reasoning?: 'provider-default' | 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
      avatarColor?: string
      avatarShape?: string
      allowedToolIds?: string[]
      teamIds?: string[]
      visibility?: 'creator' | 'workspace'
      updatedAt: number
    } = {
      ...(args.name === undefined || row.agentRole === 'personal_chief' ? {} : { name: args.name.trim() }),
      ...(args.description === undefined || row.agentRole === 'personal_chief' ? {} : { description: cleanOptional(args.description) }),
      ...(args.instructions === undefined ? {} : { instructions: args.instructions.trim() }),
      ...(args.harness === undefined ? {} : { harness: args.harness }),
      ...(args.modelId === undefined ? {} : { modelId: args.modelId.trim() }),
      ...(args.permissionMode === undefined ? {} : { permissionMode: args.permissionMode.trim() }),
      ...(args.effort === undefined ? {} : { effort: args.effort.trim() }),
      ...(args.reasoning === undefined ? {} : { reasoning: args.reasoning }),
      ...(args.avatarColor === undefined || row.agentRole === 'personal_chief' ? {} : { avatarColor: cleanOptional(args.avatarColor) }),
      ...(args.avatarShape === undefined || row.agentRole === 'personal_chief' ? {} : { avatarShape: cleanOptional(args.avatarShape) }),
      ...(args.allowedToolIds === undefined ? {} : { allowedToolIds: unique(args.allowedToolIds) }),
      ...(args.visibility === undefined ? {} : { visibility: args.visibility }),
      updatedAt: args.now,
    }
    if (
      ('name' in patch && !patch.name) ||
      ('instructions' in patch && !patch.instructions) ||
      ('modelId' in patch && !patch.modelId)
    ) {
      throw new Error('WORKSPACE_AGENT_INVALID')
    }
    await ctx.db.patch(row._id, patch)
    if ('name' in patch && patch.name) {
      const principal = await ctx.db
        .query('workspacePrincipals')
        .withIndex('by_principalId', (q) =>
          q.eq('principalId', row.principalId),
        )
        .unique()
      if (principal)
        await ctx.db.patch(principal._id, {
          displayName: patch.name,
          updatedAt: args.now,
        })
    }
    if (args.teamIds) {
      const existing = await ctx.db.query('workspaceTeamMemberships')
        .withIndex('by_principalId', (q) => q.eq('principalId', row.principalId)).collect()
      await Promise.all(existing.map((membership) => ctx.db.delete(membership._id)))
      const updatedTeams = await Promise.all(unique(args.teamIds).map((teamId) =>
        ctx.db.query('workspaceTeams').withIndex('by_teamId', (q) => q.eq('teamId', teamId)).unique()))
      const updatedJoinableTeamIds = unique(args.teamIds).filter((teamId, i) => {
        const team = updatedTeams[i]
        return team && team.workspaceId === args.workspaceId && !team.archivedAt
      })
      await Promise.all(updatedJoinableTeamIds.map((teamId) =>
        ctx.db.insert('workspaceTeamMemberships', {
          teamMembershipId: `${teamId}:${row.principalId}`, workspaceId: args.workspaceId,
          teamId, principalId: row.principalId, principalType: 'agent',
          addedByPrincipalId: args.updatedByPrincipalId, createdAt: args.now,
        })))
      // Store the updated teamIds projection on the definition row so
      // listByServer can read it without N+1 queries.
      patch.teamIds = unique(args.teamIds)
    }
    return await directoryValue(ctx, { ...row, ...patch })
  },
})

export const archiveByServer = mutation({
  args: { serverSecret: v.string(), agentId: v.string(), workspaceId: v.string(), now: v.number() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const row = await ctx.db
      .query('workspaceAgentDefinitions')
      .withIndex('by_agentId', (q) => q.eq('agentId', args.agentId))
      .unique()
    if (!row || row.workspaceId !== args.workspaceId || row.archivedAt)
      return false
    if (row.isDefault || row.agentId === `default-overlay-${args.workspaceId}`
      || row.agentRole === 'workspace_chief' || row.agentRole === 'personal_chief') return false
    await ctx.db.patch(row._id, {
      archivedAt: args.now,
      updatedAt: args.now,
      roomCount: 0,
      teamIds: [],
    })
    const principal = await ctx.db
      .query('workspacePrincipals')
      .withIndex('by_principalId', (q) => q.eq('principalId', row.principalId))
      .unique()
    if (principal)
      await ctx.db.patch(principal._id, {
        archivedAt: args.now,
        updatedAt: args.now,
      })
    const membership = await ctx.db
      .query('workspaceMemberships')
      .withIndex('by_workspaceId_principalId', (q) =>
        q
          .eq('workspaceId', args.workspaceId)
          .eq('principalId', row.principalId),
      )
      .unique()
    if (membership)
      await ctx.db.patch(membership._id, {
        status: 'suspended',
        updatedAt: args.now,
      })
    const participants = await ctx.db
      .query('conversationParticipants')
      .withIndex('by_workspaceId_principalId_status', (q) =>
        q.eq('workspaceId', args.workspaceId).eq('principalId', row.principalId).eq('status', 'active')).collect()
    const participantConversations = await Promise.all(participants.map((participant) =>
      ctx.db.get(participant.conversationId)))
    // Threads (agentId-bound conversations) keep the agent as a participant
    // while archived so the Archived view can render them and unarchive
    // restores without re-joining.
    await Promise.all(participants
      .filter((_, i) => participantConversations[i]?.agentId !== row.agentId)
      .map((participant) => ctx.db.patch(participant._id, { status: 'removed', removedAt: args.now, updatedAt: args.now })))
    const memberships = await ctx.db.query('workspaceTeamMemberships')
      .withIndex('by_principalId', (q) => q.eq('principalId', row.principalId)).collect()
    await Promise.all(memberships.map((teamMembership) => ctx.db.delete(teamMembership._id)))
    return true
  },
})

export const unarchiveByServer = mutation({
  args: { serverSecret: v.string(), agentId: v.string(), workspaceId: v.string(), now: v.number() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const row = await ctx.db
      .query('workspaceAgentDefinitions')
      .withIndex('by_agentId', (q) => q.eq('agentId', args.agentId))
      .unique()
    if (!row || row.workspaceId !== args.workspaceId || !row.archivedAt)
      return false
    await ctx.db.patch(row._id, { archivedAt: undefined, updatedAt: args.now })
    const principal = await ctx.db
      .query('workspacePrincipals')
      .withIndex('by_principalId', (q) => q.eq('principalId', row.principalId))
      .unique()
    if (principal)
      await ctx.db.patch(principal._id, {
        archivedAt: undefined,
        updatedAt: args.now,
      })
    const membership = await ctx.db
      .query('workspaceMemberships')
      .withIndex('by_workspaceId_principalId', (q) =>
        q
          .eq('workspaceId', args.workspaceId)
          .eq('principalId', row.principalId),
      )
      .unique()
    if (membership)
      await ctx.db.patch(membership._id, {
        status: 'active',
        updatedAt: args.now,
      })
    // Restore the agent's participant rows on its own threads if an older
    // archive removed them (threads written before this change shipped).
    const threads = await ctx.db
      .query('conversations')
      .withIndex('by_workspaceId_agentId', (q) =>
        q.eq('workspaceId', args.workspaceId).eq('agentId', row.agentId)).collect()
    const liveThreads = threads.filter((thread) => !thread.deletedAt)
    const threadParticipants = await Promise.all(liveThreads.map((thread) =>
      ctx.db.query('conversationParticipants')
        .withIndex('by_conversationId_principalId', (q) =>
          q.eq('conversationId', thread._id).eq('principalId', row.principalId)).unique()))
    await Promise.all(threadParticipants
      .filter((participant) => participant && participant.status !== 'active')
      .map((participant) => ctx.db.patch(participant!._id, { status: 'active', removedAt: undefined, updatedAt: args.now })))
    return true
  },
})

/**
 * Deletes an archived agent for good. Only an archived agent qualifies, and never the default one. The definition row
 * stays (marked deleted, hidden from every list) so messages the agent wrote in shared rooms still render; its direct
 * threads are deleted for everyone who talked to it.
 */
export const deleteArchivedByServer = mutation({
  args: { serverSecret: v.string(), agentId: v.string(), workspaceId: v.string(), now: v.number() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const row = await ctx.db
      .query('workspaceAgentDefinitions')
      .withIndex('by_agentId', (q) => q.eq('agentId', args.agentId))
      .unique()
    if (!row || row.workspaceId !== args.workspaceId || !row.archivedAt || row.deletedAt) return false
    if (row.isDefault || row.agentId === `default-overlay-${args.workspaceId}`
      || row.agentRole === 'workspace_chief' || row.agentRole === 'personal_chief') return false
    await ctx.db.patch(row._id, { deletedAt: args.now, updatedAt: args.now })
    const threads = await ctx.db
      .query('conversations')
      .withIndex('by_workspaceId_agentId', (q) =>
        q.eq('workspaceId', args.workspaceId).eq('agentId', row.agentId)).collect()
    await Promise.all(threads
      .filter((thread) => !thread.deletedAt)
      .map((thread) => ctx.db.patch(thread._id, { deletedAt: args.now, updatedAt: args.now })))
    return true
  },
})

/** Maintenance-only cleanup for development contract runs interrupted before
 * workspace erasure learned about agent definitions. */
export const purgeOrphanedByServer = mutation({
  args: { serverSecret: v.string() },
  returns: v.object({ deleted: v.number() }),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const definitions = await ctx.db.query('workspaceAgentDefinitions').take(500)
    const workspaces = await Promise.all(definitions.map((definition) =>
      ctx.db.query('workspaces')
        .withIndex('by_workspaceId', (q) => q.eq('workspaceId', definition.workspaceId)).unique()))
    const orphaned = definitions.filter((_, i) => !workspaces[i])
    await Promise.all(orphaned.map((definition) => ctx.db.delete(definition._id)))
    const deleted = orphaned.length
    return { deleted }
  },
})

export async function directoryValue(
  ctx: QueryCtx | MutationCtx,
  row: Doc<'workspaceAgentDefinitions'>,
) {
  const { _id, _creationTime, ...rawValue } = row
  void _id
  void _creationTime
  const identity = row.agentRole === 'personal_chief' && row.chiefOwnerUserId
    ? await ctx.db.query('personalChiefIdentities')
      .withIndex('by_userId', (q) => q.eq('userId', row.chiefOwnerUserId!)).unique()
    : null
  const value = identity
    ? {
        ...rawValue,
        name: identity.name,
        description: identity.description,
        avatarColor: identity.avatarColor,
        avatarShape: identity.avatarShape,
      }
    : rawValue

  // Use stored projections when available (set transactionally by mutations).
  // Fall back to live computation only for older rows that predate stored
  // projections — this maintains backward compatibility while eliminating
  // N+1 queries for the common case.
  // `visibility` predates the access-mode feature on older rows; absence means
  // a workspace-visible agent.
  const visibility = row.visibility ?? 'workspace'
  if (row.teamIds !== undefined && row.roomCount !== undefined) {
    return { ...value, visibility, teamIds: row.teamIds, roomCount: row.roomCount }
  }

  // Legacy fallback: compute from related tables.
  const [teams, rooms] = await Promise.all([
    ctx.db
      .query('workspaceTeamMemberships')
      .withIndex('by_principalId', (q) => q.eq('principalId', row.principalId))
      .collect(),
    ctx.db
      .query('conversationParticipants')
    .withIndex('by_workspaceId_principalId_status', (q) =>
        q
          .eq('workspaceId', row.workspaceId)
          .eq('principalId', row.principalId)
          .eq('status', 'active'),
      )
      .collect(),
  ])
  return {
    ...value,
    visibility,
    teamIds: teams.map((item) => item.teamId).sort(),
    roomCount: rooms.length,
  }
}

async function requireActiveHumanMembership(
  ctx: MutationCtx,
  workspaceId: string,
  userId: string,
  principalId: string,
) {
  const principal = await requirePrincipal(ctx, workspaceId, principalId)
  if (principal.type !== 'human' || principal.userId !== userId) throw new Error('WORKSPACE_ACCESS_DENIED')
  const membership = await ctx.db.query('workspaceMemberships')
    .withIndex('by_workspaceId_principalId', (q) => q.eq('workspaceId', workspaceId).eq('principalId', principalId))
    .unique()
  if (!membership || membership.status !== 'active') throw new Error('WORKSPACE_ACCESS_DENIED')
  return { principal, membership }
}

async function requireActiveHumanMembershipForPrincipal(
  ctx: MutationCtx,
  workspaceId: string,
  principalId: string,
) {
  const principal = await requirePrincipal(ctx, workspaceId, principalId)
  if (principal.type !== 'human' || !principal.userId) throw new Error('WORKSPACE_ACCESS_DENIED')
  const membership = await ctx.db.query('workspaceMemberships')
    .withIndex('by_workspaceId_principalId', (q) => q.eq('workspaceId', workspaceId).eq('principalId', principalId))
    .unique()
  if (!membership || membership.status !== 'active') throw new Error('WORKSPACE_ACCESS_DENIED')
  return { principal, membership }
}

async function eligiblePersonalOwners(
  ctx: MutationCtx,
  workspace: Doc<'workspaces'>,
  actorUserId: string,
  actorPrincipalId: string,
) {
  const memberships = await ctx.db.query('workspaceMemberships')
    .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspace.workspaceId)).collect()
  const principals = await ctx.db.query('workspacePrincipals')
    .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspace.workspaceId)).collect()
  const principalById = new Map(principals.map((principal) => [principal.principalId, principal]))
  return memberships
    .filter((membership) => membership.status === 'active' && membership.role !== 'guest')
    .map((membership) => principalById.get(membership.principalId))
    .filter((principal): principal is NonNullable<typeof principal> =>
      Boolean(principal && principal.type === 'human' && principal.userId && !principal.archivedAt))
    .filter((principal) => workspace.kind === 'organization'
      ? true
      : principal.userId === workspace.personalOwnerUserId && principal.userId === actorUserId
        && principal.principalId === actorPrincipalId)
    .map((principal) => ({ userId: principal.userId!, principalId: principal.principalId }))
}

async function adoptChief(
  ctx: MutationCtx,
  row: Doc<'workspaceAgentDefinitions'>,
  role: 'workspace_chief' | 'personal_chief',
  scope: 'workspace' | 'personal',
  ownerUserId: string | undefined,
  now: number,
) {
  const patch = {
    agentRole: role,
    chiefScope: scope,
    ...(ownerUserId ? { chiefOwnerUserId: ownerUserId } : {}),
    updatedAt: now,
    visibility: role === 'workspace_chief' ? 'workspace' as const : 'creator' as const,
  }
  await ctx.db.patch(row._id, patch)
  if (role === 'personal_chief' && ownerUserId) {
    await ensureIdentity(ctx, ownerUserId, row, now)
  }
  return { ...row, ...patch }
}

async function createPersonalChief(
  ctx: MutationCtx,
  workspace: Doc<'workspaces'>,
  owner: { userId: string; principalId: string },
  scope: 'personal' | 'workspace',
  now: number,
) {
  const profile = await ensureIdentity(ctx, owner.userId, undefined, now)
  return await insertChief(ctx, {
    workspace,
    agentId: scope === 'personal'
      ? `personal-chief-${workspace.workspaceId}-${owner.userId}`
      : `personal-chief-workspace-${workspace.workspaceId}-${owner.userId}`,
    principalId: scope === 'personal'
      ? `personal-chief-principal-${workspace.workspaceId}-${owner.userId}`
      : `personal-chief-principal-workspace-${workspace.workspaceId}-${owner.userId}`,
    role: 'personal_chief',
    scope,
    ownerUserId: owner.userId,
    createdByPrincipalId: owner.principalId,
    visibility: scope === 'personal' ? 'creator' : 'workspace',
    name: profile.name,
    description: profile.description,
    instructions: 'You are the personal chief of staff. Help the owner plan, decide, and follow through.',
    allowedToolIds: toolIdsForEnabledGroups(new Set(DEFAULT_AGENT_TOOL_GROUP_IDS)),
    avatarColor: profile.avatarColor,
    avatarShape: profile.avatarShape,
    now,
  })
}

async function ensureIdentity(
  ctx: MutationCtx,
  userId: string,
  source: Doc<'workspaceAgentDefinitions'> | undefined,
  now: number,
) {
  const existing = await ctx.db.query('personalChiefIdentities')
    .withIndex('by_userId', (q) => q.eq('userId', userId)).unique()
  if (existing) return existing
  const personalDefault = source ?? await findPersonalWorkspaceDefault(ctx, userId)
  const account = await ctx.db.query('subscriptions')
    .withIndex('by_userId', (q) => q.eq('userId', userId)).first()
  const ownerPrincipals = (await ctx.db.query('workspacePrincipals')
    .withIndex('by_userId', (q) => q.eq('userId', userId)).collect())
    .filter((principal) => principal.type === 'human' && !principal.archivedAt)
    .sort((a, b) => a.workspaceId.localeCompare(b.workspaceId))
  let ownerDisplayName: string | undefined
  for (const principal of ownerPrincipals) {
    const membership = await ctx.db.query('workspaceMemberships')
      .withIndex('by_workspaceId_principalId', (q) =>
        q.eq('workspaceId', principal.workspaceId).eq('principalId', principal.principalId)).unique()
    if (membership?.status === 'active' && membership.role !== 'guest' && principal.displayName.trim()) {
      ownerDisplayName = principal.displayName.trim()
      break
    }
  }
  const ownerName = [account?.firstName, account?.lastName].filter(Boolean).join(' ').trim()
    || account?.name?.trim()
    || ownerDisplayName
    || account?.email?.trim()
    || userId
  const identity = {
    userId,
    name: personalDefault?.name ?? `${ownerName}’s Overlay`,
    ...(personalDefault?.description === undefined ? {} : { description: personalDefault.description }),
    avatarColor: personalDefault?.avatarColor ?? '#8b5cf6',
    avatarShape: personalDefault?.avatarShape ?? 'squircle',
    createdAt: now,
    updatedAt: now,
  }
  const id = await ctx.db.insert('personalChiefIdentities', identity)
  const inserted = await ctx.db.get(id)
  if (!inserted) throw new Error('CHIEF_IDENTITY_NOT_FOUND')
  return inserted
}

async function findPersonalWorkspaceDefault(ctx: MutationCtx, userId: string) {
  const principals = await ctx.db.query('workspacePrincipals')
    .withIndex('by_userId', (q) => q.eq('userId', userId)).collect()
  const personalWorkspaces = await Promise.all(principals
    .filter((principal) => principal.type === 'human' && !principal.archivedAt)
    .map(async (principal) => {
      const workspace = await ctx.db.query('workspaces')
        .withIndex('by_workspaceId', (q) => q.eq('workspaceId', principal.workspaceId)).unique()
      const membership = await ctx.db.query('workspaceMemberships')
        .withIndex('by_workspaceId_principalId', (q) =>
          q.eq('workspaceId', principal.workspaceId).eq('principalId', principal.principalId)).unique()
      return workspace?.status === 'active' && workspace.kind === 'personal'
        && workspace.personalOwnerUserId === userId
        && membership?.status === 'active' && membership.role !== 'guest' ? workspace : null
    }))
  for (const workspace of personalWorkspaces.filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => a.workspaceId.localeCompare(b.workspaceId))) {
    const candidates = await ctx.db.query('workspaceAgentDefinitions')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspace.workspaceId)).collect()
    const row = candidates
      .filter((candidate) => candidate.agentRole === undefined || candidate.agentRole === 'personal_chief')
      .filter((candidate) => candidate.isDefault || candidate.agentId === `default-overlay-${workspace.workspaceId}`)
      .sort((a, b) => Number(b.agentId === `default-overlay-${workspace.workspaceId}`)
        - Number(a.agentId === `default-overlay-${workspace.workspaceId}`)
        || a.agentId.localeCompare(b.agentId))[0]
    if (row) return row
  }
  return undefined
}

function findAdoptableLegacyDefault(
  rows: Doc<'workspaceAgentDefinitions'>[],
  workspaceId: string,
) {
  const canonicalId = `default-overlay-${workspaceId}`
  return rows
    .filter((row) => row.agentRole === undefined)
    .filter((row) => row.isDefault || row.agentId === canonicalId)
    .sort((a, b) => Number(b.agentId === canonicalId) - Number(a.agentId === canonicalId)
      || a.agentId.localeCompare(b.agentId))[0]
}

async function insertChief(
  ctx: MutationCtx,
  args: {
    workspace: Doc<'workspaces'>
    agentId: string
    principalId: string
    role: 'workspace_chief' | 'personal_chief'
    scope: 'workspace' | 'personal'
    ownerUserId?: string
    createdByPrincipalId: string
    visibility: 'creator' | 'workspace'
    name: string
    description?: string
    instructions: string
    allowedToolIds: string[]
    avatarColor?: string
    avatarShape?: string
    isDefault?: boolean
    now: number
  },
) {
  const existing = await ctx.db.query('workspaceAgentDefinitions')
    .withIndex('by_agentId', (q) => q.eq('agentId', args.agentId)).unique()
  if (existing) {
    if (existing.deletedAt || existing.archivedAt) throw new Error('CHIEF_BINDING_INVARIANT')
    if (existing.agentRole !== args.role || existing.chiefScope !== args.scope
      || existing.chiefOwnerUserId !== args.ownerUserId) throw new Error('CHIEF_ROLE_NOT_UNIQUE')
    return existing
  }
  await ctx.db.insert('workspacePrincipals', {
    principalId: args.principalId,
    workspaceId: args.workspace.workspaceId,
    type: 'agent',
    agentId: args.agentId,
    displayName: args.name,
    ...(args.avatarColor ? { avatarColor: args.avatarColor } : {}),
    ...(args.avatarShape ? { avatarShape: args.avatarShape } : {}),
    createdByPrincipalId: args.createdByPrincipalId,
    createdAt: args.now,
    updatedAt: args.now,
  })
  await ctx.db.insert('workspaceMemberships', {
    membershipId: `${args.agentId}:membership`,
    workspaceId: args.workspace.workspaceId,
    principalId: args.principalId,
    role: 'member',
    status: 'active',
    invitedByPrincipalId: args.createdByPrincipalId,
    joinedAt: args.now,
    updatedAt: args.now,
  })
  const id = await ctx.db.insert('workspaceAgentDefinitions', {
    agentId: args.agentId,
    workspaceId: args.workspace.workspaceId,
    principalId: args.principalId,
    name: args.name,
    description: cleanOptional(args.description),
    instructions: args.instructions,
    harness: 'overlay',
    modelId: DEFAULT_MODEL_ID,
    avatarColor: args.avatarColor,
    avatarShape: args.avatarShape,
    allowedToolIds: unique(args.allowedToolIds),
    invocationPolicy: 'mention',
    visibility: args.visibility,
    createdByPrincipalId: args.createdByPrincipalId,
    createdAt: args.now,
    updatedAt: args.now,
    teamIds: [],
    roomCount: 0,
    ...(args.isDefault === undefined ? {} : { isDefault: args.isDefault }),
    agentRole: args.role,
    chiefOwnerUserId: args.ownerUserId,
    chiefScope: args.scope,
  })
  const inserted = await ctx.db.get(id)
  if (!inserted) throw new Error('WORKSPACE_AGENT_NOT_FOUND')
  await ctx.db.insert('workspaceResourceScopes', {
    workspaceId: args.workspace.workspaceId,
    resourceType: 'agent',
    resourceId: args.agentId,
    createdAt: args.now,
    updatedAt: args.now,
  })
  if (args.visibility === 'workspace') {
    const channels = await ctx.db.query('conversations')
      .withIndex('by_workspaceId_conversationType_lastModified', (q) =>
        q.eq('workspaceId', args.workspace.workspaceId).eq('conversationType', 'channel'))
      .collect()
    await Promise.all(channels.filter((channel) => !channel.deletedAt && channel.channelVisibility === 'public')
      .map((channel) => ctx.db.insert('conversationParticipants', {
        conversationId: channel._id,
        workspaceId: args.workspace.workspaceId,
        principalId: args.principalId,
        principalType: 'agent',
        role: 'member',
        status: 'active',
        notificationLevel: 'mentions',
        joinedAt: args.now,
        updatedAt: args.now,
      })))
  }
  return inserted
}

async function requireActiveWorkspace(
  ctx: QueryCtx | MutationCtx,
  workspaceId: string,
) {
  const workspace = await ctx.db
    .query('workspaces')
    .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId))
    .unique()
  if (!workspace || workspace.status !== 'active')
    throw new Error('WORKSPACE_NOT_FOUND')
  return workspace
}

async function requirePrincipal(
  ctx: QueryCtx | MutationCtx,
  workspaceId: string,
  principalId: string,
) {
  const principal = await ctx.db
    .query('workspacePrincipals')
    .withIndex('by_principalId', (q) => q.eq('principalId', principalId))
    .unique()
  if (
    !principal ||
    principal.workspaceId !== workspaceId ||
    principal.archivedAt
  )
    throw new Error('WORKSPACE_ACCESS_DENIED')
  return principal
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function cleanOptional(value?: string) {
  return value?.trim() || undefined
}

export async function isActiveNonGuestHumanOwner(
  ctx: QueryCtx | MutationCtx,
  workspaceId: string,
  userId: string,
) {
  const principals = await ctx.db.query('workspacePrincipals')
    .withIndex('by_workspaceId_userId', (q) => q.eq('workspaceId', workspaceId).eq('userId', userId)).collect()
  for (const principal of principals) {
    if (principal.type !== 'human' || principal.archivedAt) continue
    const membership = await ctx.db.query('workspaceMemberships')
      .withIndex('by_workspaceId_principalId', (q) => q.eq('workspaceId', workspaceId).eq('principalId', principal.principalId)).unique()
    if (membership?.status === 'active' && membership.role !== 'guest') return true
  }
  return false
}

function required(value: string, code: string) {
  if (!value.trim()) throw new Error(code)
  return value.trim()
}
