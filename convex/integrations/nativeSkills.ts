import { paginationOptsValidator } from 'convex/server'
import { v } from 'convex/values'
import { mutation, query, type MutationCtx, type QueryCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { requireNativeWorkspace } from '../lib/nativeViewer'
import { requireNativeCapability } from '../lib/nativeCapabilities'
import { loadScopeContext } from '../lib/resourceScope'
import {
  archivePatch, canCreateInScope, canEditResource, canReadResource, checkMoveResource,
  rowInView, scopeItemOptions,
} from '../../src/shared/workspaces/resource-scope'

const scope = v.union(v.literal('personal'), v.literal('workspace'))
const fields = { name: v.string(), description: v.string(), instructions: v.string(), enabled: v.boolean() }
const resource = { workspaceId: v.string(), skillId: v.id('skills') }
const revision = { ...resource, expectedRevision: v.number() }

async function access(ctx: QueryCtx, workspaceId: string) {
  const native = await requireNativeWorkspace(ctx, workspaceId)
  await requireNativeCapability(ctx, native.userId, 'skills.use')
  const context = await loadScopeContext(ctx, workspaceId, native.userId)
  if (!canCreateInScope('extension', 'personal', context.viewer, context.policy)) throw new Error('SKILL_ACCESS_DENIED')
  return { ...context, workspaceId }
}

function summary(row: Doc<'skills'>, context: Awaited<ReturnType<typeof access>>) {
  return {
    _id: row._id, userId: row.userId, workspaceId: row.workspaceId,
    name: row.name, description: row.description, enabled: row.enabled ?? true,
    scope: row.scope ?? 'personal', archivedAt: row.archivedAt, archivedFromScope: row.archivedFromScope,
    createdAt: row.createdAt, updatedAt: row.updatedAt, revision: row.revision ?? 0,
    editable: canEditResource(row, context.viewer),
    options: scopeItemOptions('extension', row, context.viewer, context.policy),
  }
}

export const list = query({
  args: { workspaceId: v.string(), view: v.union(scope, v.literal('archived')), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const context = await access(ctx, args.workspaceId)
    const source = args.view === 'personal'
      ? ctx.db.query('skills').withIndex('by_workspaceId_userId', q => q.eq('workspaceId', args.workspaceId).eq('userId', context.viewer.userId))
      : args.view === 'workspace'
        ? ctx.db.query('skills').withIndex('by_workspaceId_scope_archivedAt', q => q.eq('workspaceId', args.workspaceId).eq('scope', 'workspace').eq('archivedAt', undefined))
        : ctx.db.query('skills').withIndex('by_workspaceId', q => q.eq('workspaceId', args.workspaceId))
    const result = await source.order('desc').paginate({ ...args.paginationOpts, numItems: Math.max(1, Math.min(25, args.paginationOpts.numItems)) })
    return { ...result, page: result.page.filter(row => rowInView(row, args.view, context.viewer)).map(row => summary(row, context)) }
  },
})

export const permissions = query({
  args: { workspaceId: v.string() },
  handler: async (ctx, args) => {
    const context = await access(ctx, args.workspaceId)
    return { personal: true, workspace: canCreateInScope('extension', 'workspace', context.viewer, context.policy) }
  },
})

export const get = query({
  args: resource,
  handler: async (ctx, args) => {
    const context = await access(ctx, args.workspaceId)
    const row = await ctx.db.get(args.skillId)
    if (!row || row.workspaceId !== args.workspaceId || !canReadResource(row, context.viewer)) return null
    return { ...summary(row, context), instructions: row.instructions }
  },
})

// The legacy personal stream preserves pre-workspace, creator-only availability without exposing instructions.
export const availability = query({
  args: { workspaceId: v.string(), workspaceOnly: v.boolean(), legacyPersonal: v.boolean(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const context = await access(ctx, args.workspaceId)
    if (args.legacyPersonal && args.workspaceOnly) throw new Error('SKILL_ACCESS_DENIED')
    const source = args.legacyPersonal
      ? ctx.db.query('skills').withIndex('by_workspaceId_userId', q => q.eq('workspaceId', undefined).eq('userId', context.viewer.userId))
      : ctx.db.query('skills').withIndex('by_workspaceId', q => q.eq('workspaceId', args.workspaceId))
    const result = await source.order('desc').paginate({ ...args.paginationOpts, numItems: Math.max(1, Math.min(25, args.paginationOpts.numItems)) })
    return { ...result, page: result.page.filter(row => row.archivedAt === undefined && row.enabled !== false
      && (args.legacyPersonal || canReadResource(row, context.viewer))
      && (!args.workspaceOnly || row.scope === 'workspace'))
      .map(row => ({ _id: row._id, name: row.name, description: row.description, enabled: true as const, revision: row.revision ?? 0 })) }
  },
})

async function editable(ctx: MutationCtx, args: { workspaceId: string; skillId: Id<'skills'>; expectedRevision: number }) {
  const context = await access(ctx, args.workspaceId)
  const row = await ctx.db.get(args.skillId)
  if (!row || row.workspaceId !== args.workspaceId || !canEditResource(row, context.viewer)) throw new Error('SKILL_ACCESS_DENIED')
  if ((row.revision ?? 0) !== args.expectedRevision) throw new Error('SKILL_REVISION_CONFLICT')
  return { context, row }
}

async function admit(ctx: MutationCtx, userId: string) {
  const bucket = 'skills:write:user', bucketKey = `${bucket}:${userId}`, now = Date.now()
  const existing = await ctx.db.query('rateLimitWindows').withIndex('by_bucketKey', q => q.eq('bucketKey', bucketKey)).unique()
  if (existing && existing.resetAt > now && existing.count >= 600) throw new Error('RATE_LIMITED')
  const value = { bucket, bucketKey, count: existing && existing.resetAt > now ? existing.count + 1 : 1,
    resetAt: existing && existing.resetAt > now ? existing.resetAt : now + 600_000, updatedAt: now }
  if (existing) await ctx.db.patch(existing._id, value)
  else await ctx.db.insert('rateLimitWindows', value)
}

async function audit(ctx: MutationCtx, userId: string, workspaceId: string, skillId: Id<'skills'>, action: string) {
  await ctx.db.insert('auditEvents', { eventId: crypto.randomUUID(), actorType: 'user', actorUserId: userId,
    action: `skill.${action}`, resourceType: 'skills', resourceId: skillId, outcome: 'success',
    metadataJson: JSON.stringify({ workspaceId }), createdAt: Date.now() })
}

function clean(values: { name: string; description: string; instructions: string; enabled: boolean }) {
  const result = { name: values.name.trim(), description: values.description.trim(), instructions: values.instructions.trim(), enabled: values.enabled }
  if (!result.name || !result.description || !result.instructions || result.name.length > 500
    || result.description.length > 10_000 || result.instructions.length > 200_000) throw new Error('INVALID_SKILL')
  return result
}

export const create = mutation({
  args: { workspaceId: v.string(), requestId: v.string(), scope, ...fields },
  handler: async (ctx, args) => {
    const context = await access(ctx, args.workspaceId)
    if (!canCreateInScope('extension', args.scope, context.viewer, context.policy)) throw new Error('SKILL_ACCESS_DENIED')
    if (!args.requestId || args.requestId.length > 128) throw new Error('INVALID_REQUEST_ID')
    const values = clean(args)
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ workspaceId: args.workspaceId, scope: args.scope, ...values })))
    const payloadHash = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('')
    const receipt = await ctx.db.query('skillCreationReceipts').withIndex('by_userId_requestId', q => q.eq('userId', context.viewer.userId).eq('requestId', args.requestId)).unique()
    if (receipt) {
      if (receipt.payloadHash !== payloadHash || receipt.workspaceId !== args.workspaceId) throw new Error('IDEMPOTENCY_CONFLICT')
      return receipt.skillId
    }
    await admit(ctx, context.viewer.userId)
    const now = Date.now()
    const skillId = await ctx.db.insert('skills', { ...values, workspaceId: args.workspaceId, userId: context.viewer.userId,
      scope: args.scope, version: 1, revision: 1, createdAt: now, updatedAt: now })
    await ctx.db.insert('skillCreationReceipts', { userId: context.viewer.userId, workspaceId: args.workspaceId, requestId: args.requestId, payloadHash, skillId })
    await audit(ctx, context.viewer.userId, args.workspaceId, skillId, 'create')
    return skillId
  },
})

export const update = mutation({
  args: { ...revision, ...fields },
  handler: async (ctx, args) => {
    const { row, context } = await editable(ctx, args)
    const values = clean(args)
    await admit(ctx, context.viewer.userId)
    await ctx.db.patch(row._id, { ...values, revision: (row.revision ?? 0) + 1, version: (row.version ?? 1) + 1, updatedAt: Date.now() })
    await audit(ctx, context.viewer.userId, args.workspaceId, row._id, 'update')
  },
})

export const changeScope = mutation({
  args: { ...revision, action: v.union(v.literal('move'), v.literal('archive'), v.literal('restore')), to: v.optional(scope) },
  handler: async (ctx, args) => {
    const { row, context } = await editable(ctx, args)
    await admit(ctx, context.viewer.userId)
    const patch: Partial<Doc<'skills'>> = { revision: (row.revision ?? 0) + 1, updatedAt: Date.now() }
    if (args.action === 'move') {
      if (!args.to) throw new Error('INVALID_SCOPE')
      const decision = checkMoveResource('extension', row, args.to, context.viewer, context.policy)
      if (!decision.ok) throw new Error(`SKILL_SCOPE_DENIED:${decision.reason}`)
      patch.scope = args.to
    } else if (args.action === 'archive') {
      if (row.archivedAt !== undefined) throw new Error('SKILL_REVISION_CONFLICT')
      Object.assign(patch, archivePatch(row, context.viewer, Date.now()))
    } else {
      if (row.archivedAt === undefined) throw new Error('SKILL_REVISION_CONFLICT')
      Object.assign(patch, { scope: row.archivedFromScope ?? row.scope ?? 'personal', archivedAt: undefined, archivedBy: undefined, archivedFromScope: undefined })
    }
    await ctx.db.patch(row._id, patch)
    await audit(ctx, context.viewer.userId, args.workspaceId, row._id, args.action)
  },
})

export const remove = mutation({
  args: revision,
  handler: async (ctx, args) => {
    const { row, context } = await editable(ctx, args)
    await admit(ctx, context.viewer.userId)
    await ctx.db.delete(row._id)
    await audit(ctx, context.viewer.userId, args.workspaceId, row._id, 'delete')
  },
})
