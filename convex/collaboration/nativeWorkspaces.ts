import { paginationOptsValidator } from 'convex/server'
import { DEFAULT_WORKSPACE_POLICY, WORKSPACE_AGENT_HARNESSES, WORKSPACE_ROLLOUT_STAGES } from '@overlay/workspace-contracts'
import type { WorkspaceSharingPolicyPatch } from '@overlay/workspace-contracts'
import { v } from 'convex/values'
import type { Doc } from '../_generated/dataModel'
import { mutation, query, type MutationCtx, type QueryCtx } from '../_generated/server'
import { nativeViewer, requireNativeWorkspace } from '../lib/nativeViewer'
import { requireNativeDeploymentFeature } from '../lib/nativeDeploymentPolicy'
import { claimWorkspaceHandle, getWorkspaceHandle } from '../lib/workspaceHandles'
import { versionedIdentityUrl } from '@/shared/workspaces/identity-resolution'
import {
  isReservedWorkspaceHandle,
  isWorkspaceHandleSyntaxValid,
  normalizeWorkspaceHandleInput,
  validateWorkspaceHandleAddress,
} from '@/shared/workspaces/handle-policy'

const PAGE_SIZE = 50
const scopeEditorsValidator = v.union(v.literal('members'), v.literal('admins'))
const rolloutStageValidator = v.union(v.literal('dogfood'), v.literal('invited'), v.literal('general'))
const sharingPolicyValidator = v.object({
  workspaceId: v.string(),
  publicLinksEnabled: v.boolean(),
  memberCanCreateChannels: v.boolean(),
  memberCanCreateAgents: v.boolean(),
  memberCanInvite: v.boolean(),
  workspaceExtensionsEditors: scopeEditorsValidator,
  workspaceContentEditors: scopeEditorsValidator,
  memberCanMoveScope: v.boolean(),
  usageTopUpBy: scopeEditorsValidator,
  guestExpirationDays: v.optional(v.number()),
  allowedAgentHarnesses: v.optional(v.array(v.string())),
  agentRunBudgetCents: v.optional(v.number()),
  channelRetentionDays: v.optional(v.number()),
  legalHold: v.boolean(),
  dataResidency: v.optional(v.string()),
  rolloutStage: rolloutStageValidator,
  updatedByPrincipalId: v.optional(v.string()),
  updatedAt: v.number(),
})
const sharingPolicyPatchValidator = v.object({
  publicLinksEnabled: v.optional(v.boolean()),
  memberCanCreateChannels: v.optional(v.boolean()),
  memberCanCreateAgents: v.optional(v.boolean()),
  memberCanInvite: v.optional(v.boolean()),
  workspaceExtensionsEditors: v.optional(scopeEditorsValidator),
  workspaceContentEditors: v.optional(scopeEditorsValidator),
  memberCanMoveScope: v.optional(v.boolean()),
  usageTopUpBy: v.optional(scopeEditorsValidator),
  guestExpirationDays: v.optional(v.union(v.number(), v.null())),
  allowedAgentHarnesses: v.optional(v.union(v.array(v.string()), v.null())),
  agentRunBudgetCents: v.optional(v.union(v.number(), v.null())),
  channelRetentionDays: v.optional(v.union(v.number(), v.null())),
  legalHold: v.optional(v.boolean()),
  dataResidency: v.optional(v.union(v.string(), v.null())),
  rolloutStage: v.optional(rolloutStageValidator),
})

type HandleResolution = { workspaceId: string; canonicalHandle: string; canonical: boolean }

function workspaceSummary(
  workspace: Doc<'workspaces'>,
  role: Doc<'workspaceMemberships'>['role'],
  routingHandle?: string,
) {
  return {
    id: workspace.workspaceId,
    name: workspace.name,
    slug: workspace.slug,
    ...(routingHandle ? { routingHandle } : {}),
    ...(workspace.iconObjectKey ? {
      iconUrl: versionedIdentityUrl(
        `/api/v1/workspaces/${encodeURIComponent(workspace.workspaceId)}/icon`,
        workspace.iconObjectKey,
      ),
    } : {}),
    ...(workspace.iconPreset ? { iconPreset: workspace.iconPreset } : {}),
    kind: workspace.kind,
    status: workspace.status,
    role,
    updatedAt: workspace.updatedAt,
  }
}

async function resolveHandleForViewer(
  ctx: Pick<QueryCtx, 'db'>,
  userId: string,
  input: string,
): Promise<HandleResolution | null> {
  const address = validateWorkspaceHandleAddress(input)
  if (!address.ok) return null
  const handle = address.handle
  const registered = await getWorkspaceHandle(ctx, handle)
  if (registered?.visibility === 'private') return null
  let workspace = registered
    ? await ctx.db.query('workspaces')
      .withIndex('by_workspaceId', q => q.eq('workspaceId', registered.workspaceId)).unique()
    : null
  if (!workspace && !registered) {
    const migration = await ctx.db.query('workspaceHandleMigrationState')
      .withIndex('by_key', q => q.eq('key', 'workspace-handles-v1')).unique()
    if (migration?.status === 'ready') return null
    const legacy = await ctx.db.query('workspaces')
      .withIndex('by_slug', q => q.eq('slug', handle)).first()
    if (legacy?.kind === 'organization') workspace = legacy
  }
  if (!workspace || workspace.status !== 'active' || workspace.archivedAt !== undefined) return null
  const principal = await ctx.db.query('workspacePrincipals')
    .withIndex('by_workspaceId_userId', q => q.eq('workspaceId', workspace!.workspaceId).eq('userId', userId)).unique()
  if (!principal || principal.type !== 'human' || principal.archivedAt !== undefined) return null
  const membership = await ctx.db.query('workspaceMemberships')
    .withIndex('by_workspaceId_principalId', q => q.eq('workspaceId', workspace!.workspaceId).eq('principalId', principal.principalId)).unique()
  if (!membership || membership.status !== 'active') return null
  return {
    workspaceId: workspace.workspaceId,
    canonicalHandle: workspace.slug,
    canonical: workspace.slug === handle,
  }
}

async function directoryRow(
  ctx: QueryCtx,
  userId: string,
  principal: Doc<'workspacePrincipals'>,
  membership: Doc<'workspaceMemberships'>,
) {
  const workspace = await ctx.db.query('workspaces')
    .withIndex('by_workspaceId', q => q.eq('workspaceId', principal.workspaceId)).unique()
  if (!workspace || workspace.status !== 'active' || workspace.archivedAt !== undefined) return null
  const handle = await resolveHandleForViewer(ctx, userId, workspace.slug)
  const routingHandle = handle?.workspaceId === workspace.workspaceId
    ? handle.canonicalHandle
    : undefined
  return workspaceSummary(workspace, membership.role, routingHandle)
}

async function writeBudget(
  ctx: MutationCtx,
  userId: string,
  bucket = 'native-workspaces:write:user',
  limit = 300,
) {
  const bucketKey = `${bucket}:${userId}`
  const now = Date.now()
  const existing = await ctx.db.query('rateLimitWindows')
    .withIndex('by_bucketKey', q => q.eq('bucketKey', bucketKey)).unique()
  if (existing && existing.resetAt > now && existing.count >= limit) throw new Error('RATE_LIMITED')
  const value = {
    bucket,
    bucketKey,
    count: existing && existing.resetAt > now ? existing.count + 1 : 1,
    resetAt: existing && existing.resetAt > now ? existing.resetAt : now + 600_000,
    updatedAt: now,
  }
  if (existing) await ctx.db.patch(existing._id, value)
  else await ctx.db.insert('rateLimitWindows', value)
}

function nextRevision(previous: number) {
  return Math.max(Date.now(), previous + 1)
}

async function recordWorkspaceAudit(
  ctx: MutationCtx,
  args: {
    userId: string
    workspaceId: string
    action: string
    revision: number
    metadata: Record<string, unknown>
  },
) {
  await ctx.db.insert('auditEvents', {
    eventId: `${args.action}.${args.workspaceId}.${args.revision}`,
    actorType: 'user',
    actorUserId: args.userId,
    action: args.action,
    resourceType: 'workspace',
    resourceId: args.workspaceId,
    outcome: 'success',
    metadataJson: JSON.stringify(args.metadata),
    createdAt: args.revision,
  })
}

function policyValue(row: Doc<'workspaceSharingPolicies'> | null, workspaceId: string) {
  return row
    ? {
        workspaceId,
        publicLinksEnabled: row.publicLinksEnabled,
        memberCanCreateChannels: row.memberCanCreateChannels ?? true,
        memberCanCreateAgents: row.memberCanCreateAgents ?? true,
        memberCanInvite: row.memberCanInvite ?? false,
        workspaceExtensionsEditors: row.workspaceExtensionsEditors ?? 'members',
        workspaceContentEditors: row.workspaceContentEditors ?? 'members',
        memberCanMoveScope: row.memberCanMoveScope ?? true,
        usageTopUpBy: row.usageTopUpBy ?? 'admins',
        guestExpirationDays: row.guestExpirationDays,
        allowedAgentHarnesses: row.allowedAgentHarnesses?.length ? row.allowedAgentHarnesses : undefined,
        agentRunBudgetCents: row.agentRunBudgetCents,
        channelRetentionDays: row.channelRetentionDays,
        legalHold: row.legalHold ?? false,
        dataResidency: row.dataResidency,
        rolloutStage: row.rolloutStage ?? 'general',
        updatedByPrincipalId: row.updatedByPrincipalId,
        updatedAt: row.updatedAt,
      }
    : { ...DEFAULT_WORKSPACE_POLICY, workspaceId, updatedAt: 0 }
}

function validatePolicyPatch(input: Record<string, unknown>): WorkspaceSharingPolicyPatch {
  if (Object.keys(input).length === 0) throw new Error('WORKSPACE_POLICY_EMPTY_PATCH')
  const patch = { ...input }
  for (const field of [
    'publicLinksEnabled',
    'memberCanCreateChannels',
    'memberCanCreateAgents',
    'memberCanInvite',
    'memberCanMoveScope',
    'legalHold',
  ]) {
    if (patch[field] !== undefined && typeof patch[field] !== 'boolean') {
      throw new Error(`WORKSPACE_POLICY_INVALID:${field}`)
    }
  }
  for (const field of ['workspaceExtensionsEditors', 'workspaceContentEditors', 'usageTopUpBy']) {
    if (patch[field] !== undefined && patch[field] !== 'members' && patch[field] !== 'admins') {
      throw new Error(`WORKSPACE_POLICY_INVALID:${field}`)
    }
  }
  const ranges = [
    ['guestExpirationDays', 1, 365],
    ['channelRetentionDays', 1, 3_650],
    ['agentRunBudgetCents', 0, 100_000_000],
  ] as const
  for (const [field, min, max] of ranges) {
    const value = patch[field]
    if (value === null || value === undefined) continue
    if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value < min || value > max) {
      throw new Error(`WORKSPACE_POLICY_INVALID:${field}`)
    }
  }
  if (patch.rolloutStage !== undefined
    && !WORKSPACE_ROLLOUT_STAGES.includes(patch.rolloutStage as typeof WORKSPACE_ROLLOUT_STAGES[number])) {
    throw new Error('WORKSPACE_POLICY_INVALID:rolloutStage')
  }
  if (patch.allowedAgentHarnesses !== undefined && patch.allowedAgentHarnesses !== null) {
    if (!Array.isArray(patch.allowedAgentHarnesses)
      || patch.allowedAgentHarnesses.some(value =>
        typeof value !== 'string' || !(WORKSPACE_AGENT_HARNESSES as readonly string[]).includes(value))) {
      throw new Error('WORKSPACE_POLICY_INVALID:allowedAgentHarnesses')
    }
    patch.allowedAgentHarnesses = [...new Set(patch.allowedAgentHarnesses)]
  }
  if (patch.dataResidency !== undefined && patch.dataResidency !== null) {
    if (typeof patch.dataResidency !== 'string') throw new Error('WORKSPACE_POLICY_INVALID:dataResidency')
    patch.dataResidency = patch.dataResidency.trim().slice(0, 120)
  }
  return patch as WorkspaceSharingPolicyPatch
}

async function requireManager(ctx: MutationCtx, workspaceId: string) {
  const access = await requireNativeWorkspace(ctx, workspaceId)
  if (access.membership.role !== 'owner' && access.membership.role !== 'admin') {
    throw new Error('WORKSPACE_MANAGEMENT_FORBIDDEN')
  }
  return access
}

export const getInitialWorkspaceHint = query({
  args: {},
  returns: v.union(v.string(), v.null()),
  handler: async (ctx) => {
    const viewer = await nativeViewer(ctx)
    if (!viewer) return null
    const preference = await ctx.db.query('workspaceUserPreferences')
      .withIndex('by_userId', q => q.eq('userId', viewer.userId)).unique()
    return preference?.activeWorkspaceId ?? null
  },
})

export const listDirectory = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const viewer = await nativeViewer(ctx)
    if (!viewer) throw new Error('UNAUTHENTICATED')
    const page = await ctx.db.query('workspacePrincipals')
      .withIndex('by_userId', q => q.eq('userId', viewer.userId))
      .order('desc')
      .paginate({ ...paginationOpts, numItems: Math.max(1, Math.min(PAGE_SIZE, paginationOpts.numItems)) })
    const rows = await Promise.all(page.page.map(async principal => {
      if (principal.type !== 'human' || principal.archivedAt !== undefined) return null
      const membership = await ctx.db.query('workspaceMemberships')
        .withIndex('by_workspaceId_principalId', q => q.eq('workspaceId', principal.workspaceId).eq('principalId', principal.principalId)).unique()
      if (!membership || membership.status !== 'active') return null
      return await directoryRow(ctx, viewer.userId, principal, membership)
    }))
    return { ...page, page: rows.filter((row): row is NonNullable<typeof row> => row !== null) }
  },
})

export const resolveHandle = query({
  args: { handle: v.string() },
  returns: v.union(v.object({
    workspaceId: v.string(),
    canonicalHandle: v.string(),
    canonical: v.boolean(),
  }), v.null()),
  handler: async (ctx, args) => {
    const viewer = await nativeViewer(ctx)
    if (!viewer) return null
    return await resolveHandleForViewer(ctx, viewer.userId, args.handle)
  },
})

export const updateHandle = mutation({
  args: { workspaceId: v.string(), slug: v.string(), expectedUpdatedAt: v.number() },
  returns: v.object({ workspaceId: v.string(), slug: v.string(), updatedAt: v.number() }),
  handler: async (ctx, args) => {
    const access = await requireNativeWorkspace(ctx, args.workspaceId)
    if (access.membership.role !== 'owner') throw new Error('WORKSPACE_HANDLE_OWNER_REQUIRED')
    await requireNativeDeploymentFeature(ctx, 'workspaceHandles', args.workspaceId)

    const target = normalizeWorkspaceHandleInput(args.slug)
    if (!isWorkspaceHandleSyntaxValid(target) || isReservedWorkspaceHandle(target)) {
      throw new Error('WORKSPACE_HANDLE_INVALID')
    }
    const migration = await ctx.db.query('workspaceHandleMigrationState')
      .withIndex('by_key', q => q.eq('key', 'workspace-handles-v1')).unique()
    if (migration?.status !== 'ready') throw new Error('WORKSPACE_HANDLE_REGISTRY_NOT_READY')

    const workspace = await ctx.db.query('workspaces')
      .withIndex('by_workspaceId', q => q.eq('workspaceId', args.workspaceId)).unique()
    if (!workspace || workspace.status !== 'active' || workspace.archivedAt !== undefined) {
      throw new Error('WORKSPACE_NOT_FOUND')
    }
    if (workspace.updatedAt !== args.expectedUpdatedAt) throw new Error('WORKSPACE_REVISION_CONFLICT')
    if (workspace.slug === target) {
      return { workspaceId: args.workspaceId, slug: workspace.slug, updatedAt: workspace.updatedAt }
    }

    await writeBudget(ctx, access.userId, 'native-workspaces:handle-write:user', 10)
    const updatedAt = nextRevision(workspace.updatedAt)
    await claimWorkspaceHandle(ctx, {
      handle: target,
      workspaceId: args.workspaceId,
      kind: 'canonical',
      visibility: 'public',
      now: updatedAt,
    })
    await claimWorkspaceHandle(ctx, {
      handle: workspace.slug,
      workspaceId: args.workspaceId,
      kind: 'alias',
      visibility: 'public',
      now: updatedAt,
      allowReserved: workspace.kind === 'personal' && workspace.slug.startsWith('personal-'),
    })
    await ctx.db.patch(workspace._id, { slug: target, updatedAt })
    await recordWorkspaceAudit(ctx, {
      userId: access.userId,
      workspaceId: args.workspaceId,
      action: 'workspace.handle.update',
      revision: updatedAt,
      metadata: { previousHandle: workspace.slug, nextHandle: target },
    })
    return { workspaceId: args.workspaceId, slug: target, updatedAt }
  },
})

export const getSharingPolicy = query({
  args: { workspaceId: v.string() },
  returns: v.object({ policy: sharingPolicyValidator, canManage: v.boolean() }),
  handler: async (ctx, args) => {
    const access = await requireNativeWorkspace(ctx, args.workspaceId)
    const row = await ctx.db.query('workspaceSharingPolicies')
      .withIndex('by_workspaceId', q => q.eq('workspaceId', args.workspaceId)).unique()
    return {
      policy: policyValue(row, args.workspaceId),
      canManage: access.membership.role === 'owner' || access.membership.role === 'admin',
    }
  },
})

export const rename = mutation({
  args: { workspaceId: v.string(), name: v.string(), expectedUpdatedAt: v.number() },
  returns: v.number(),
  handler: async (ctx, args) => {
    const access = await requireManager(ctx, args.workspaceId)
    const workspace = await ctx.db.query('workspaces')
      .withIndex('by_workspaceId', q => q.eq('workspaceId', args.workspaceId)).unique()
    if (!workspace) throw new Error('WORKSPACE_ACCESS_DENIED')
    const name = args.name.trim()
    if (!name || name.length > 80) throw new Error('WORKSPACE_NAME_INVALID')
    if (workspace.updatedAt !== args.expectedUpdatedAt) throw new Error('WORKSPACE_REVISION_CONFLICT')
    if (name === workspace.name) return workspace.updatedAt
    await writeBudget(ctx, access.userId)
    const updatedAt = nextRevision(workspace.updatedAt)
    await ctx.db.patch(workspace._id, { name, updatedAt })
    await recordWorkspaceAudit(ctx, {
      userId: access.userId,
      workspaceId: args.workspaceId,
      action: 'workspace.rename',
      revision: updatedAt,
      metadata: { previousName: workspace.name, name },
    })
    return updatedAt
  },
})

export const setSharingPolicy = mutation({
  args: {
    workspaceId: v.string(),
    patch: sharingPolicyPatchValidator,
    expectedUpdatedAt: v.number(),
  },
  returns: sharingPolicyValidator,
  handler: async (ctx, args) => {
    const access = await requireManager(ctx, args.workspaceId)
    const patch = validatePolicyPatch(args.patch as Record<string, unknown>)
    const existing = await ctx.db.query('workspaceSharingPolicies')
      .withIndex('by_workspaceId', q => q.eq('workspaceId', args.workspaceId)).unique()
    const previous = existing?.updatedAt ?? 0
    if (previous !== args.expectedUpdatedAt) throw new Error('WORKSPACE_REVISION_CONFLICT')
    await writeBudget(ctx, access.userId)
    const updatedAt = nextRevision(previous)
    const persisted = Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, value === null ? undefined : value]))
    const row = {
      ...policyValue(existing, args.workspaceId),
      ...persisted,
      updatedByPrincipalId: access.principal.principalId,
      updatedAt,
    }
    if (existing) await ctx.db.patch(existing._id, row)
    else await ctx.db.insert('workspaceSharingPolicies', { ...row, createdAt: updatedAt } as never)
    await recordWorkspaceAudit(ctx, {
      userId: access.userId,
      workspaceId: args.workspaceId,
      action: 'workspace.sharing-policy.update',
      revision: updatedAt,
      metadata: { patch: persisted },
    })
    return row as ReturnType<typeof policyValue>
  },
})
