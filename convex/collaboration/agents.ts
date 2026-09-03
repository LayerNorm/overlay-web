import { v } from 'convex/values'
import type { Doc } from '../_generated/dataModel'
import { mutation, query } from '../_generated/server'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { requireServerSecret } from '../lib/auth'

const harness = v.union(v.literal('overlay'), v.literal('claude-code'))
const agentVisibility = v.union(v.literal('creator'), v.literal('workspace'))
const agentValidator = v.object({
  agentId: v.string(),
  workspaceId: v.string(),
  principalId: v.string(),
  name: v.string(),
  description: v.optional(v.string()),
  instructions: v.string(),
  harness,
  modelId: v.string(),
  avatarColor: v.optional(v.string()),
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
})

export const createByServer = mutation({
  args: {
    serverSecret: v.string(), agentId: v.string(), principalId: v.string(), workspaceId: v.string(),
    name: v.string(), description: v.optional(v.string()), instructions: v.string(), harness,
    modelId: v.string(), avatarColor: v.optional(v.string()), allowedToolIds: v.array(v.string()),
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
    const duplicate = (await ctx.db.query('workspaceAgentDefinitions')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', args.workspaceId)).collect())
      .find((item) => item.name.toLowerCase() === args.name.trim().toLowerCase() && !item.archivedAt)
    if (duplicate && !duplicate.archivedAt) throw new Error('WORKSPACE_AGENT_ALREADY_EXISTS')
    if (await ctx.db.query('workspaceAgentDefinitions').withIndex('by_agentId', (q) => q.eq('agentId', args.agentId)).unique()) {
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
      avatarColor: cleanOptional(args.avatarColor), allowedToolIds: unique(args.allowedToolIds),
      invocationPolicy: 'mention', visibility: args.visibility ?? 'workspace',
      createdByPrincipalId: args.createdByPrincipalId,
      teamIds: unique(args.teamIds), roomCount: 0,
      createdAt: args.now, updatedAt: args.now,
      isDefault: args.isDefault || args.name.trim().toLowerCase() === 'overlay' ? true : undefined,
    })
    for (const teamId of unique(args.teamIds)) {
      const team = await ctx.db.query('workspaceTeams').withIndex('by_teamId', (q) => q.eq('teamId', teamId)).unique()
      if (!team || team.workspaceId !== args.workspaceId || team.archivedAt) continue
      await ctx.db.insert('workspaceTeamMemberships', {
        teamMembershipId: `${teamId}:${args.principalId}`, workspaceId: args.workspaceId,
        teamId, principalId: args.principalId, principalType: 'agent',
        addedByPrincipalId: args.createdByPrincipalId, createdAt: args.now,
      })
    }
    // Creator-only agents join no channels implicitly: only their creator can
    // place them anywhere, and only the creator can invoke them.
    if ((args.visibility ?? 'workspace') !== 'creator') {
      const channels = await ctx.db.query('conversations')
        .withIndex('by_workspaceId_conversationType_lastModified', (q) =>
          q.eq('workspaceId', args.workspaceId).eq('conversationType', 'channel'))
        .collect()
      for (const channel of channels) {
        if (channel.deletedAt || channel.channelVisibility !== 'public') continue
        await ctx.db.insert('conversationParticipants', {
          conversationId: channel._id, workspaceId: args.workspaceId, principalId: args.principalId,
          principalType: 'agent', role: 'member', status: 'active', notificationLevel: 'mentions',
          joinedAt: args.now, updatedAt: args.now,
        })
      }
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
    const row = await ctx.db.query('workspaceAgentDefinitions')
      .withIndex('by_agentId', (q) => q.eq('agentId', args.agentId)).unique()
    return row && row.workspaceId === args.workspaceId ? await directoryValue(ctx, row) : null
  },
})

export const listByServer = query({
  args: { serverSecret: v.string(), workspaceId: v.string(), includeArchived: v.optional(v.boolean()) },
  returns: v.array(agentValidator),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const rows = await ctx.db.query('workspaceAgentDefinitions')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', args.workspaceId)).collect()
    const visible = rows.filter((row) => args.includeArchived || !row.archivedAt)
      .sort((a, b) => a.name.localeCompare(b.name) || a.agentId.localeCompare(b.agentId))
    return await Promise.all(visible.map((row) => directoryValue(ctx, row)))
  },
})

export const updateByServer = mutation({
  args: {
    serverSecret: v.string(), agentId: v.string(), workspaceId: v.string(),
    name: v.optional(v.string()), description: v.optional(v.string()), instructions: v.optional(v.string()),
    harness: v.optional(harness), modelId: v.optional(v.string()), avatarColor: v.optional(v.string()),
    allowedToolIds: v.optional(v.array(v.string())), now: v.number(),
    teamIds: v.optional(v.array(v.string())), visibility: v.optional(agentVisibility),
    updatedByPrincipalId: v.optional(v.string()),
  },
  returns: v.union(agentValidator, v.null()),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const row = await ctx.db.query('workspaceAgentDefinitions')
      .withIndex('by_agentId', (q) => q.eq('agentId', args.agentId)).unique()
    if (!row || row.workspaceId !== args.workspaceId || row.archivedAt) return null
    if (args.name && args.name.trim().toLowerCase() !== row.name.toLowerCase()) {
      const duplicate = (await ctx.db.query('workspaceAgentDefinitions')
        .withIndex('by_workspaceId', (q) => q.eq('workspaceId', args.workspaceId)).collect())
        .find((item) => item._id !== row._id && !item.archivedAt
          && item.name.toLowerCase() === args.name!.trim().toLowerCase())
      if (duplicate) throw new Error('WORKSPACE_AGENT_ALREADY_EXISTS')
    }
    const patch: {
      name?: string
      description?: string
      instructions?: string
      harness?: 'overlay' | 'claude-code'
      modelId?: string
      avatarColor?: string
      allowedToolIds?: string[]
      teamIds?: string[]
      visibility?: 'creator' | 'workspace'
      updatedAt: number
    } = {
      ...(args.name === undefined ? {} : { name: args.name.trim() }),
      ...(args.description === undefined ? {} : { description: cleanOptional(args.description) }),
      ...(args.instructions === undefined ? {} : { instructions: args.instructions.trim() }),
      ...(args.harness === undefined ? {} : { harness: args.harness }),
      ...(args.modelId === undefined ? {} : { modelId: args.modelId.trim() }),
      ...(args.avatarColor === undefined ? {} : { avatarColor: cleanOptional(args.avatarColor) }),
      ...(args.allowedToolIds === undefined ? {} : { allowedToolIds: unique(args.allowedToolIds) }),
      ...(args.visibility === undefined ? {} : { visibility: args.visibility }),
      updatedAt: args.now,
    }
    if ('name' in patch && !patch.name || 'instructions' in patch && !patch.instructions || 'modelId' in patch && !patch.modelId) {
      throw new Error('WORKSPACE_AGENT_INVALID')
    }
    await ctx.db.patch(row._id, patch)
    if ('name' in patch && patch.name) {
      const principal = await ctx.db.query('workspacePrincipals')
        .withIndex('by_principalId', (q) => q.eq('principalId', row.principalId)).unique()
      if (principal) await ctx.db.patch(principal._id, { displayName: patch.name, updatedAt: args.now })
    }
    if (args.teamIds) {
      const existing = await ctx.db.query('workspaceTeamMemberships')
        .withIndex('by_principalId', (q) => q.eq('principalId', row.principalId)).collect()
      for (const membership of existing) await ctx.db.delete(membership._id)
      for (const teamId of unique(args.teamIds)) {
        const team = await ctx.db.query('workspaceTeams').withIndex('by_teamId', (q) => q.eq('teamId', teamId)).unique()
        if (!team || team.workspaceId !== args.workspaceId || team.archivedAt) continue
        await ctx.db.insert('workspaceTeamMemberships', {
          teamMembershipId: `${teamId}:${row.principalId}`, workspaceId: args.workspaceId,
          teamId, principalId: row.principalId, principalType: 'agent',
          addedByPrincipalId: args.updatedByPrincipalId, createdAt: args.now,
        })
      }
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
    const row = await ctx.db.query('workspaceAgentDefinitions')
      .withIndex('by_agentId', (q) => q.eq('agentId', args.agentId)).unique()
    if (!row || row.workspaceId !== args.workspaceId || row.archivedAt) return false
    if (row.isDefault || row.name.toLowerCase() === 'overlay') return false
    await ctx.db.patch(row._id, { archivedAt: args.now, updatedAt: args.now, roomCount: 0, teamIds: [] })
    const principal = await ctx.db.query('workspacePrincipals')
      .withIndex('by_principalId', (q) => q.eq('principalId', row.principalId)).unique()
    if (principal) await ctx.db.patch(principal._id, { archivedAt: args.now, updatedAt: args.now })
    const membership = await ctx.db.query('workspaceMemberships')
      .withIndex('by_workspaceId_principalId', (q) => q.eq('workspaceId', args.workspaceId).eq('principalId', row.principalId)).unique()
    if (membership) await ctx.db.patch(membership._id, { status: 'suspended', updatedAt: args.now })
    const participants = await ctx.db.query('conversationParticipants')
      .withIndex('by_workspaceId_principalId_status', (q) =>
        q.eq('workspaceId', args.workspaceId).eq('principalId', row.principalId).eq('status', 'active')).collect()
    for (const participant of participants) {
      await ctx.db.patch(participant._id, { status: 'removed', removedAt: args.now, updatedAt: args.now })
    }
    const memberships = await ctx.db.query('workspaceTeamMemberships')
      .withIndex('by_principalId', (q) => q.eq('principalId', row.principalId)).collect()
    for (const teamMembership of memberships) await ctx.db.delete(teamMembership._id)
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
    let deleted = 0
    for (const definition of definitions) {
      const workspace = await ctx.db.query('workspaces')
        .withIndex('by_workspaceId', (q) => q.eq('workspaceId', definition.workspaceId)).unique()
      if (workspace) continue
      await ctx.db.delete(definition._id)
      deleted += 1
    }
    return { deleted }
  },
})

async function directoryValue(
  ctx: QueryCtx | MutationCtx,
  row: Doc<'workspaceAgentDefinitions'>,
) {
  const { _id, _creationTime, ...value } = row
  void _id
  void _creationTime

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
  const teams = await ctx.db.query('workspaceTeamMemberships')
    .withIndex('by_principalId', (q) => q.eq('principalId', row.principalId)).collect()
  const rooms = await ctx.db.query('conversationParticipants')
    .withIndex('by_workspaceId_principalId_status', (q) =>
      q.eq('workspaceId', row.workspaceId).eq('principalId', row.principalId).eq('status', 'active')).collect()
  return { ...value, visibility, teamIds: teams.map((item) => item.teamId).sort(), roomCount: rooms.length }
}

async function requireActiveWorkspace(ctx: QueryCtx | MutationCtx, workspaceId: string) {
  const workspace = await ctx.db.query('workspaces').withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId)).unique()
  if (!workspace || workspace.status !== 'active') throw new Error('WORKSPACE_NOT_FOUND')
  return workspace
}

async function requirePrincipal(ctx: QueryCtx | MutationCtx, workspaceId: string, principalId: string) {
  const principal = await ctx.db.query('workspacePrincipals').withIndex('by_principalId', (q) => q.eq('principalId', principalId)).unique()
  if (!principal || principal.workspaceId !== workspaceId || principal.archivedAt) throw new Error('WORKSPACE_ACCESS_DENIED')
  return principal
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function cleanOptional(value?: string) {
  return value?.trim() || undefined
}
