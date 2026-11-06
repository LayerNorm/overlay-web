import { paginationOptsValidator } from 'convex/server'
import { v } from 'convex/values'
import type { Doc } from '../_generated/dataModel'
import { mutation, query, type MutationCtx, type QueryCtx } from '../_generated/server'
import { applyChiefIdentityPatch, createWorkspaceAgentRecord, directoryValue, ensureWorkspaceAgentChiefRecords, persistWorkspaceAgentProfile, restoreWorkspaceAgentRecord } from '../collaboration/agents'
import { requireNativeWorkspace } from '../lib/nativeViewer'
import { requireNativeDeploymentFeature } from '../lib/nativeDeploymentPolicy'
import { parseByoModelId } from '@/shared/agents/agent-model'
import { isSupportedAgentProviderId } from '@/shared/agents/provider-accounts'
import {
  isWorkspaceAgentCreatureShape,
  WORKSPACE_AGENT_CREATURE_SHAPES,
  type WorkspaceAgentDirectoryItem,
  type WorkspaceAgentHarness,
} from '@overlay/workspace-contracts'

const MAX_PAGE_SIZE = 100
const MAX_RELATED_RECORDS = 200
const MAX_TOOLS = 100
const MAX_TEAMS = 100
const SUPPORTED_HARNESSES = ['overlay', 'claude-code', 'codex'] as const
const REASONING = ['provider-default', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const
const VISIBILITIES = ['creator', 'workspace'] as const
const CREATURE_SHAPES = WORKSPACE_AGENT_CREATURE_SHAPES

const harnessValidator = v.union(v.literal('overlay'), v.literal('claude-code'), v.literal('codex'))
const reasoningValidator = v.union(
  v.literal('provider-default'), v.literal('none'), v.literal('minimal'), v.literal('low'),
  v.literal('medium'), v.literal('high'), v.literal('xhigh'),
)
const shapeValidator = v.union(
  v.literal('circle'), v.literal('blob'), v.literal('squircle'), v.literal('pill'),
  v.literal('triangle'), v.literal('hexagon'), v.literal('cloud'), v.literal('droplet'),
)
const visibilityValidator = v.union(v.literal('creator'), v.literal('workspace'))
const profileFields = {
  name: v.optional(v.string()),
  description: v.optional(v.string()),
  instructions: v.optional(v.string()),
  harness: v.optional(harnessValidator),
  permissionMode: v.optional(v.string()),
  effort: v.optional(v.string()),
  reasoning: v.optional(reasoningValidator),
  modelId: v.optional(v.string()),
  avatarColor: v.optional(v.string()),
  avatarShape: v.optional(shapeValidator),
  allowedToolIds: v.optional(v.array(v.string())),
  teamIds: v.optional(v.array(v.string())),
  visibility: v.optional(visibilityValidator),
}

const nativeAgentValidator = v.object({
  id: v.string(),
  workspaceId: v.string(),
  principalId: v.string(),
  name: v.string(),
  description: v.optional(v.string()),
  instructions: v.string(),
  harness: v.union(
    v.literal('overlay'), v.literal('claude-code'), v.literal('codex'),
    v.literal('opencode'), v.literal('pi'), v.literal('hermes'),
  ),
  modelId: v.string(),
  reasoning: v.optional(reasoningValidator),
  permissionMode: v.optional(v.string()),
  effort: v.optional(v.string()),
  avatarColor: v.optional(v.string()),
  avatarShape: v.optional(shapeValidator),
  allowedToolIds: v.array(v.string()),
  invocationPolicy: v.literal('mention'),
  visibility: visibilityValidator,
  createdByPrincipalId: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
  archivedAt: v.optional(v.number()),
  isDefault: v.optional(v.boolean()),
  agentRole: v.optional(v.union(v.literal('workspace_chief'), v.literal('personal_chief'), v.literal('agent'))),
  chiefOwnerUserId: v.optional(v.string()),
  chiefScope: v.optional(v.union(v.literal('personal'), v.literal('workspace'))),
  teamIds: v.array(v.string()),
  roomCount: v.number(),
  createdByDisplayName: v.optional(v.string()),
  canEdit: v.boolean(),
  revision: v.string(),
})

type Viewer = Awaited<ReturnType<typeof requireNativeWorkspace>>
type NativeCtx = QueryCtx | MutationCtx
type NativeAgentProjection = Omit<WorkspaceAgentDirectoryItem, 'canEdit'> & {
  canEdit: boolean
  revision: string
}

function manager(viewer: Viewer) {
  return viewer.membership.role === 'owner' || viewer.membership.role === 'admin'
}

export function visible(row: Doc<'workspaceAgentDefinitions'>, viewer: Viewer) {
  if (row.deletedAt !== undefined || row.workspaceId !== viewer.workspaceId) return false
  if (row.visibility === 'creator' && row.createdByPrincipalId !== viewer.principal.principalId) return false
  if (row.agentRole === 'personal_chief') {
    if (row.chiefScope === 'personal') {
      return viewer.membership.role !== 'guest' && row.chiefOwnerUserId === viewer.userId
    }
    return row.chiefScope === 'workspace'
  }
  return true
}

async function activePersonalChiefOwner(ctx: NativeCtx, row: Doc<'workspaceAgentDefinitions'>) {
  if (row.agentRole !== 'personal_chief' || !row.chiefOwnerUserId) return false
  const principal = await ctx.db.query('workspacePrincipals')
    .withIndex('by_workspaceId_userId', (q) =>
      q.eq('workspaceId', row.workspaceId).eq('userId', row.chiefOwnerUserId!)).unique()
  if (!principal || principal.type !== 'human' || principal.archivedAt !== undefined) return false
  const membership = await ctx.db.query('workspaceMemberships')
    .withIndex('by_workspaceId_principalId', (q) =>
      q.eq('workspaceId', row.workspaceId).eq('principalId', principal.principalId)).unique()
  return membership?.status === 'active' && membership.role !== 'guest'
}

async function canRead(ctx: NativeCtx, row: Doc<'workspaceAgentDefinitions'>, viewer: Viewer) {
  return visible(row, viewer)
    && (row.agentRole !== 'personal_chief' || await activePersonalChiefOwner(ctx, row))
}

function canEdit(row: Doc<'workspaceAgentDefinitions'>, viewer: Viewer) {
  if (row.agentRole === 'personal_chief') {
    return viewer.membership.role !== 'guest' && row.chiefOwnerUserId === viewer.userId
  }
  if (row.agentRole === 'workspace_chief') {
    return viewer.membership.role !== 'guest'
      && (manager(viewer) || row.createdByPrincipalId === viewer.principal.principalId)
  }
  return manager(viewer) || row.createdByPrincipalId === viewer.principal.principalId
}

function snapshot(
  row: Doc<'workspaceAgentDefinitions'>,
  overlay: Doc<'personalChiefIdentities'> | null,
  teamIds: string[],
) {
  const personal = row.agentRole === 'personal_chief'
    ? overlay
    : null
  return JSON.stringify([
    row.agentId, row.workspaceId, row.principalId, row.name, row.description ?? null,
    row.instructions, row.harness, row.modelId, row.reasoning ?? null, row.permissionMode ?? null,
    row.effort ?? null, row.avatarColor ?? null, row.avatarShape ?? null, row.allowedToolIds,
    teamIds, row.roomCount, row.invocationPolicy, row.visibility ?? 'workspace',
    row.createdByPrincipalId, row.createdAt, row.updatedAt, row.archivedAt ?? null,
    row.deletedAt ?? null, row.isDefault ?? false, row.agentRole ?? null, row.chiefOwnerUserId ?? null,
    row.chiefScope ?? null, personal?.userId ?? null, personal?.name ?? null,
    personal?.description ?? null, personal?.avatarColor ?? null, personal?.avatarShape ?? null,
    personal?.createdAt ?? null, personal?.updatedAt ?? null,
  ])
}

const revisionEncoder = new TextEncoder()

async function revisionFor(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', revisionEncoder.encode(value))
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `sha256:${hex}`
}

async function project(
  ctx: NativeCtx,
  row: Doc<'workspaceAgentDefinitions'>,
  viewer: Viewer,
): Promise<NativeAgentProjection> {
  let identity: Doc<'personalChiefIdentities'> | null = null
  if (row.agentRole === 'personal_chief' && row.chiefOwnerUserId) {
    identity = await ctx.db.query('personalChiefIdentities')
      .withIndex('by_userId', (q) => q.eq('userId', row.chiefOwnerUserId!)).unique()
  }
  const avatarShape = identity?.avatarShape ?? row.avatarShape
  const directory = await directoryValue(ctx, row, MAX_RELATED_RECORDS)
  const teamIds = directory.teamIds
  const creator = await ctx.db.query('workspacePrincipals')
    .withIndex('by_principalId', (q) => q.eq('principalId', row.createdByPrincipalId)).unique()
  return {
    id: row.agentId,
    workspaceId: row.workspaceId,
    principalId: row.principalId,
    name: identity?.name ?? row.name,
    ...((identity?.description ?? row.description) === undefined
      ? {}
      : { description: identity?.description ?? row.description }),
    instructions: row.instructions,
    harness: row.harness as WorkspaceAgentHarness,
    modelId: row.modelId,
    ...(row.reasoning === undefined ? {} : { reasoning: row.reasoning }),
    ...(row.permissionMode === undefined ? {} : { permissionMode: row.permissionMode }),
    ...(row.effort === undefined ? {} : { effort: row.effort }),
    ...((identity?.avatarColor ?? row.avatarColor) === undefined
      ? {}
      : { avatarColor: identity?.avatarColor ?? row.avatarColor }),
    ...(isWorkspaceAgentCreatureShape(avatarShape) ? { avatarShape } : {}),
    allowedToolIds: row.allowedToolIds,
    invocationPolicy: 'mention' as const,
    visibility: row.visibility ?? 'workspace',
    createdByPrincipalId: row.createdByPrincipalId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.archivedAt === undefined ? {} : { archivedAt: row.archivedAt }),
    ...(row.isDefault === undefined ? {} : { isDefault: row.isDefault }),
    ...(row.agentRole === undefined ? {} : { agentRole: row.agentRole }),
    ...(row.chiefOwnerUserId === undefined ? {} : { chiefOwnerUserId: row.chiefOwnerUserId }),
    ...(row.chiefScope === undefined ? {} : { chiefScope: row.chiefScope }),
    teamIds,
    roomCount: directory.roomCount,
    ...(creator?.displayName ? { createdByDisplayName: creator.displayName } : {}),
    canEdit: canEdit(row, viewer),
    revision: await revisionFor(snapshot(row, identity, teamIds)),
  }
}

async function recordWrite(ctx: MutationCtx, userId: string, workspaceId: string, agentId: string, action: string, now: number) {
  const bucket = 'agent-directory:write:user'
  const bucketKey = `${bucket}:${userId}`
  const existing = await ctx.db.query('rateLimitWindows')
    .withIndex('by_bucketKey', (q) => q.eq('bucketKey', bucketKey)).unique()
  if (existing && existing.resetAt > now && existing.count >= 300) throw new Error('RATE_LIMITED')
  const value = {
    bucket, bucketKey,
    count: existing && existing.resetAt > now ? existing.count + 1 : 1,
    resetAt: existing && existing.resetAt > now ? existing.resetAt : now + 600_000,
    updatedAt: now,
  }
  if (existing) await ctx.db.patch(existing._id, value)
  else await ctx.db.insert('rateLimitWindows', value)
  const eventId = `native-agent:${action}:${userId}:${workspaceId}:${agentId}:${now}`
  await ctx.db.insert('auditEvents', {
    eventId, actorType: 'user', actorUserId: userId, action,
    resourceType: 'workspace_agent', resourceId: agentId, outcome: 'success',
    metadataJson: JSON.stringify({ workspaceId, actorUserId: userId, resourceId: agentId }),
    createdAt: now,
  })
}

async function sharingPolicy(ctx: NativeCtx, workspaceId: string) {
  return await ctx.db.query('workspaceSharingPolicies')
    .withIndex('by_workspaceId', (q) => q.eq('workspaceId', workspaceId)).unique()
}

async function assertCanCreate(ctx: NativeCtx, viewer: Viewer, harness: string) {
  if (viewer.membership.role === 'guest') throw new Error('WORKSPACE_AGENT_CREATE_DENIED')
  const policy = await sharingPolicy(ctx, viewer.workspaceId)
  if (!manager(viewer) && policy?.memberCanCreateAgents === false) {
    throw new Error('WORKSPACE_AGENT_CREATE_DENIED')
  }
  if (policy?.allowedAgentHarnesses?.length && !policy.allowedAgentHarnesses.includes(harness)) {
    throw new Error('WORKSPACE_AGENT_HARNESS_DENIED')
  }
}

async function assertHarnessPolicy(ctx: NativeCtx, workspaceId: string, harness: string) {
  const policy = await sharingPolicy(ctx, workspaceId)
  if (policy?.allowedAgentHarnesses?.length && !policy.allowedAgentHarnesses.includes(harness)) {
    throw new Error('WORKSPACE_AGENT_HARNESS_DENIED')
  }
}

async function hasBinding(ctx: NativeCtx, workspaceId: string, agentId: string) {
  const rows = await ctx.db.query('agentBindings')
    .withIndex('by_workspaceId_agentId', (q) => q.eq('workspaceId', workspaceId).eq('agentId', agentId))
    .take(1)
  return rows.length > 0
}

function externalRuntime(harness: string | undefined, modelId: string | undefined) {
  return Boolean((harness && harness !== 'overlay') || (modelId && parseByoModelId(modelId)))
}

async function assertExternalAllowed(
  ctx: NativeCtx,
  workspaceId: string,
  agentId: string,
  ...runtimes: Array<{ harness?: string; modelId?: string }>
) {
  const connected = await hasBinding(ctx, workspaceId, agentId)
  if (connected) await requireNativeDeploymentFeature(ctx, 'connectedAgents', workspaceId)
  if (connected || runtimes.some(({ harness, modelId }) => externalRuntime(harness, modelId))) {
    await requireNativeDeploymentFeature(ctx, 'externalAgents', workspaceId)
  }
}

function validateText(value: string | undefined, label: string, max: number, required = false) {
  const normalized = value?.trim()
  if (required && !normalized) throw new Error('WORKSPACE_AGENT_INVALID')
  if (normalized && normalized.length > max) throw new Error('WORKSPACE_AGENT_INVALID')
  return normalized
}

function validateProfile(input: Record<string, unknown>) {
  const values = { ...input }
  if ('name' in input) values.name = validateText(input.name as string | undefined, 'name', 80, true)
  if ('description' in input && input.description !== undefined) {
    values.description = validateText(input.description as string, 'description', 240) ?? ''
  }
  if ('instructions' in input) values.instructions = validateText(input.instructions as string | undefined, 'instructions', 20_000, true)
  if ('modelId' in input) values.modelId = validateText(input.modelId as string | undefined, 'model', 200, true)
  if ('permissionMode' in input && input.permissionMode !== undefined) {
    values.permissionMode = validateText(input.permissionMode as string, 'permissionMode', 200, true)
  }
  if ('effort' in input && input.effort !== undefined) {
    values.effort = validateText(input.effort as string, 'effort', 200, true)
  }
  if ('avatarColor' in input && input.avatarColor !== undefined) {
    const color = String(input.avatarColor).trim()
    if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error('WORKSPACE_AGENT_INVALID')
    values.avatarColor = color.toLowerCase()
  }
  if ('avatarShape' in input && input.avatarShape !== undefined) {
    const shape = String(input.avatarShape).trim().toLowerCase()
    if (!CREATURE_SHAPES.includes(shape as typeof CREATURE_SHAPES[number])) throw new Error('WORKSPACE_AGENT_INVALID')
    values.avatarShape = shape
  }
  if ('harness' in input && input.harness !== undefined
    && !SUPPORTED_HARNESSES.includes(input.harness as typeof SUPPORTED_HARNESSES[number])) throw new Error('WORKSPACE_AGENT_INVALID')
  if ('reasoning' in input && input.reasoning !== undefined
    && !REASONING.includes(input.reasoning as typeof REASONING[number])) throw new Error('WORKSPACE_AGENT_INVALID')
  if ('visibility' in input && input.visibility !== undefined
    && !VISIBILITIES.includes(input.visibility as typeof VISIBILITIES[number])) throw new Error('WORKSPACE_AGENT_INVALID')
  for (const key of ['allowedToolIds', 'teamIds'] as const) {
    const list = input[key] as string[] | undefined
    const normalized = list?.map((item) => item.trim())
    if (normalized && (new Set(normalized).size !== normalized.length || normalized.some((item) => !item)
      || normalized.some((item) => item.length > 200)
      || normalized.length > (key === 'teamIds' ? MAX_TEAMS : MAX_TOOLS))) {
      throw new Error('WORKSPACE_AGENT_INVALID')
    }
    if (normalized) values[key] = normalized
  }
  const modelId = values.modelId as string | undefined
  if (modelId) {
    const byo = parseByoModelId(modelId)
    if (byo && !isSupportedAgentProviderId(byo.adapterId)) throw new Error('WORKSPACE_AGENT_INVALID')
  }
  return values
}

function validateEffectivePermissionMode(harness: string, permissionMode?: string) {
  if (harness === 'overlay' && permissionMode !== undefined
    && permissionMode !== 'ask' && permissionMode !== 'auto') {
    throw new Error('WORKSPACE_AGENT_INVALID')
  }
}

async function validateTeams(ctx: NativeCtx, workspaceId: string, teamIds: string[] | undefined) {
  if (!teamIds?.length) return
  const teams = await Promise.all(teamIds.map((teamId) =>
    ctx.db.query('workspaceTeams').withIndex('by_teamId', (q) => q.eq('teamId', teamId)).unique()))
  if (teams.some((team) => !team || team.workspaceId !== workspaceId || team.archivedAt !== undefined)) {
    throw new Error('WORKSPACE_AGENT_TEAM_DENIED')
  }
}

async function visibleAgent(ctx: NativeCtx, workspaceId: string, agentId: string, viewer: Viewer) {
  const row = await ctx.db.query('workspaceAgentDefinitions')
    .withIndex('by_agentId', (q) => q.eq('agentId', agentId)).unique()
  if (!row || row.workspaceId !== workspaceId || !(await canRead(ctx, row, viewer))) return null
  return row
}

export const context = query({
  args: { workspaceId: v.string() },
  handler: async (ctx, { workspaceId }) => {
    const viewer = await requireNativeWorkspace(ctx, workspaceId)
    const canCreate = viewer.membership.role !== 'guest'
      && (manager(viewer) || (await sharingPolicy(ctx, workspaceId))?.memberCanCreateAgents !== false)
    return {
      viewerPrincipalId: viewer.principal.principalId,
      canCreate,
      canBootstrapChiefs: viewer.membership.role !== 'guest',
    }
  },
})

export const bootstrapChiefs = mutation({
  args: { workspaceId: v.string() },
  returns: v.array(nativeAgentValidator),
  handler: async (ctx, { workspaceId }) => {
    const viewer = await requireNativeWorkspace(ctx, workspaceId)
    if (viewer.membership.role === 'guest') throw new Error('WORKSPACE_AGENT_EDIT_DENIED')
    const now = Date.now()
    await recordWrite(ctx, viewer.userId, workspaceId, 'chief-bootstrap', 'agent.bootstrap', now)
    const rows = await ensureWorkspaceAgentChiefRecords(ctx, {
      workspaceId,
      actorUserId: viewer.userId,
      actorPrincipalId: viewer.principal.principalId,
      now,
      maxRelatedRecords: MAX_RELATED_RECORDS,
    })
    const readable = []
    for (const row of rows) {
      if (await canRead(ctx, row, viewer)) readable.push(row)
    }
    return await Promise.all(readable.map((row) => project(ctx, row, viewer)))
  },
})

export const list = query({
  args: { workspaceId: v.string(), includeArchived: v.optional(v.boolean()), paginationOpts: paginationOptsValidator },
  returns: v.object({
    page: v.array(nativeAgentValidator),
    continueCursor: v.string(),
    isDone: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const viewer = await requireNativeWorkspace(ctx, args.workspaceId)
    const result = await ctx.db.query('workspaceAgentDefinitions')
      .withIndex('by_workspaceId', (q) => q.eq('workspaceId', args.workspaceId))
      .order('desc')
      .paginate({ ...args.paginationOpts, numItems: Math.max(1, Math.min(MAX_PAGE_SIZE, args.paginationOpts.numItems)) })
    const page: Array<Awaited<ReturnType<typeof project>>> = []
    for (const row of result.page) {
      if (!(await canRead(ctx, row, viewer)) || row.deletedAt !== undefined
        || ((row.archivedAt !== undefined) !== Boolean(args.includeArchived))) continue
      page.push(await project(ctx, row, viewer))
    }
    return { page, continueCursor: result.continueCursor, isDone: result.isDone }
  },
})

export const get = query({
  args: { workspaceId: v.string(), agentId: v.string(), includeArchived: v.optional(v.boolean()) },
  returns: v.union(nativeAgentValidator, v.null()),
  handler: async (ctx, args) => {
    const viewer = await requireNativeWorkspace(ctx, args.workspaceId)
    const row = await visibleAgent(ctx, args.workspaceId, args.agentId, viewer)
    if (!row || (row.archivedAt !== undefined && !args.includeArchived)) return null
    return await project(ctx, row, viewer)
  },
})

export const create = mutation({
  args: {
    workspaceId: v.string(),
    requestId: v.string(),
    ...profileFields,
    name: v.string(),
    instructions: v.string(),
    modelId: v.string(),
  },
  returns: nativeAgentValidator,
  handler: async (ctx, args) => {
    const viewer = await requireNativeWorkspace(ctx, args.workspaceId)
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(args.requestId)) {
      throw new Error('WORKSPACE_AGENT_INVALID_REQUEST_ID')
    }
    const agentId = `native-agent:${args.workspaceId}:${viewer.principal.principalId}:${args.requestId}`
    const principalId = `${agentId}:principal`
    const existing = await ctx.db.query('workspaceAgentDefinitions')
      .withIndex('by_agentId', (q) => q.eq('agentId', agentId)).unique()
    if (existing) {
      if (existing.workspaceId !== args.workspaceId
        || existing.createdByPrincipalId !== viewer.principal.principalId) throw new Error('WORKSPACE_AGENT_ACCESS_DENIED')
      await assertExternalAllowed(ctx, args.workspaceId, agentId, {
        harness: existing.harness,
        modelId: existing.modelId,
      })
      return await project(ctx, existing, viewer)
    }
    const input = validateProfile(args as unknown as Record<string, unknown>)
    const harness = (input.harness ?? 'overlay') as typeof SUPPORTED_HARNESSES[number]
    validateEffectivePermissionMode(harness, input.permissionMode as string | undefined)
    await assertCanCreate(ctx, viewer, harness)
    await assertHarnessPolicy(ctx, args.workspaceId, harness)
    await assertExternalAllowed(ctx, args.workspaceId, agentId, { harness, modelId: input.modelId as string })
    await validateTeams(ctx, args.workspaceId, input.teamIds as string[] | undefined)
    const now = Date.now()
    await recordWrite(ctx, viewer.userId, args.workspaceId, agentId, 'agent.create', now)
    const row = await createWorkspaceAgentRecord(ctx, {
      agentId, principalId, workspaceId: args.workspaceId,
      name: input.name as string, description: input.description as string | undefined,
      instructions: input.instructions as string, harness, modelId: input.modelId as string,
      permissionMode: input.permissionMode as string | undefined, effort: input.effort as string | undefined,
      reasoning: input.reasoning as typeof REASONING[number] | undefined,
      avatarColor: input.avatarColor as string | undefined, avatarShape: input.avatarShape as string | undefined,
      allowedToolIds: (input.allowedToolIds as string[] | undefined) ?? [],
      teamIds: (input.teamIds as string[] | undefined) ?? [],
      visibility: input.visibility as typeof VISIBILITIES[number] | undefined,
      createdByPrincipalId: viewer.principal.principalId, now,
      maxRelatedRecords: MAX_RELATED_RECORDS,
    })
    return await project(ctx, row, viewer)
  },
})

export const update = mutation({
  args: {
    workspaceId: v.string(),
    agentId: v.string(),
    expectedRevision: v.string(),
    patch: v.object(profileFields),
  },
  returns: nativeAgentValidator,
  handler: async (ctx, args) => {
    const viewer = await requireNativeWorkspace(ctx, args.workspaceId)
    if (args.expectedRevision.length > 4096) throw new Error('WORKSPACE_AGENT_REVISION_INVALID')
    const row = await visibleAgent(ctx, args.workspaceId, args.agentId, viewer)
    if (!row || row.archivedAt !== undefined) throw new Error('WORKSPACE_AGENT_NOT_FOUND')
    if (!canEdit(row, viewer)) throw new Error('WORKSPACE_AGENT_EDIT_DENIED')
    const current = await project(ctx, row, viewer)
    if (current.revision !== args.expectedRevision) throw new Error('WORKSPACE_AGENT_REVISION_CONFLICT')
    const input = validateProfile(args.patch as unknown as Record<string, unknown>)
    if (!Object.keys(input).length) throw new Error('WORKSPACE_AGENT_INVALID')
    if (row.agentRole === 'personal_chief' || row.agentRole === 'workspace_chief') {
      const requiredVisibility = row.chiefScope === 'personal' ? 'creator' : 'workspace'
      if (input.visibility !== undefined && input.visibility !== requiredVisibility) {
        throw new Error('CHIEF_BINDING_INVARIANT')
      }
      if (input.harness !== undefined && input.harness !== 'overlay') {
        throw new Error('CHIEF_BINDING_INVARIANT')
      }
    }
    const effectiveHarness = (input.harness ?? row.harness) as string
    const effectiveModelId = (input.modelId ?? row.modelId) as string
    validateEffectivePermissionMode(effectiveHarness, (input.permissionMode ?? row.permissionMode) as string | undefined)
    if (input.harness !== undefined) await assertHarnessPolicy(ctx, args.workspaceId, effectiveHarness)
    if (input.modelId !== undefined && input.modelId !== row.modelId && input.reasoning === undefined) {
      input.reasoning = 'provider-default'
    }
    await assertExternalAllowed(ctx, args.workspaceId, args.agentId,
      { harness: row.harness, modelId: row.modelId },
      { harness: effectiveHarness, modelId: effectiveModelId })
    await validateTeams(ctx, args.workspaceId, input.teamIds as string[] | undefined)
    if (row.agentRole === 'personal_chief' && row.chiefOwnerUserId) {
      const identityPatch: Record<string, unknown> = {}
      if (input.name !== undefined && input.name !== current.name) identityPatch.name = input.name
      if (input.description !== undefined && input.description !== current.description) {
        identityPatch.description = input.description
      }
      if (input.avatarColor !== undefined && input.avatarColor !== current.avatarColor) {
        identityPatch.avatarColor = input.avatarColor
      }
      if (input.avatarShape !== undefined && input.avatarShape !== current.avatarShape) {
        identityPatch.avatarShape = input.avatarShape
      }
      if (Object.keys(identityPatch).length > 0) {
        await applyChiefIdentityPatch(ctx, {
          ownerUserId: row.chiefOwnerUserId,
          ...identityPatch,
          now: Date.now(),
          maxRelatedRecords: MAX_RELATED_RECORDS,
        })
      }
    }
    const now = Date.now()
    await recordWrite(ctx, viewer.userId, args.workspaceId, args.agentId, 'agent.update', now)
    const updated = await persistWorkspaceAgentProfile(ctx, row, {
      ...input, agentId: args.agentId, workspaceId: args.workspaceId, now,
      updatedByPrincipalId: viewer.principal.principalId,
      maxRelatedRecords: MAX_RELATED_RECORDS,
    })
    return await project(ctx, updated, viewer)
  },
})

export const restore = mutation({
  args: { workspaceId: v.string(), agentId: v.string(), expectedRevision: v.string() },
  returns: nativeAgentValidator,
  handler: async (ctx, args) => {
    const viewer = await requireNativeWorkspace(ctx, args.workspaceId)
    if (args.expectedRevision.length > 4096) throw new Error('WORKSPACE_AGENT_REVISION_INVALID')
    const row = await visibleAgent(ctx, args.workspaceId, args.agentId, viewer)
    if (!row || row.archivedAt === undefined || row.deletedAt !== undefined) throw new Error('WORKSPACE_AGENT_NOT_FOUND')
    if (row.agentRole === 'personal_chief') {
      if (viewer.membership.role === 'guest' || row.chiefOwnerUserId !== viewer.userId) throw new Error('WORKSPACE_AGENT_RESTORE_DENIED')
    } else if (!manager(viewer) && row.createdByPrincipalId !== viewer.principal.principalId) {
      throw new Error('WORKSPACE_AGENT_RESTORE_DENIED')
    }
    const current = await project(ctx, row, viewer)
    if (current.revision !== args.expectedRevision) throw new Error('WORKSPACE_AGENT_REVISION_CONFLICT')
    await assertExternalAllowed(ctx, args.workspaceId, args.agentId, { harness: row.harness, modelId: row.modelId })
    const now = Date.now()
    await recordWrite(ctx, viewer.userId, args.workspaceId, args.agentId, 'agent.restore', now)
    await restoreWorkspaceAgentRecord(ctx, row, now, args.workspaceId, MAX_RELATED_RECORDS)
    const restored = await ctx.db.get(row._id)
    if (!restored) throw new Error('WORKSPACE_AGENT_NOT_FOUND')
    return await project(ctx, restored, viewer)
  },
})
