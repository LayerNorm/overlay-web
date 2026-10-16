import { ConvexError, v } from 'convex/values'
import type { Doc, Id } from '../_generated/dataModel'
import { query, type MutationCtx, type QueryCtx } from '../_generated/server'
import { requireServerSecret } from '../lib/auth'
import { loadScopeContext } from '../lib/resourceScope'
import { currentRemoteAttempt } from './remoteRunModel'
import { isCurrentDriveRun, type AgentDriveAuthorityClaims } from '../../src/shared/agents/agent-drive-authority'
import { canReadResource, rowScope } from '../../src/shared/workspaces/resource-scope'

const driveScopeValidator = v.union(
  v.object({ kind: v.literal('personal'), workspaceId: v.string(), ownerUserId: v.string() }),
  v.object({ kind: v.literal('workspace'), workspaceId: v.string() }),
)

export const driveAuthorityArgs = {
  serverSecret: v.string(), actorUserId: v.string(), agentId: v.string(), environmentId: v.string(),
  bindingId: v.string(), runId: v.string(), sessionId: v.string(), expiresAt: v.number(),
  scope: driveScopeValidator,
  execution: v.optional(v.object({ attemptId: v.string(), generation: v.number() })),
}

/** Same transaction gate for reads and future file commits. No host-selected scope is trusted. */
export async function requireDriveAuthority(ctx: QueryCtx | MutationCtx, args: AgentDriveAuthorityClaims & { serverSecret: string }) {
  requireServerSecret(args.serverSecret)
  if (process.env.OVERLAY_CONNECTED_AGENT_DRIVE !== '1') throw new ConvexError('DRIVE_DISABLED')
  const workspaceId = args.scope.workspaceId
  const [run, session, binding, environment, agent, workspace, principal, scopeContext] = await Promise.all([
    ctx.db.query('conversationAgentRuns').withIndex('by_externalRunId', q => q.eq('externalRunId', args.runId)).unique(),
    currentRemoteAttempt(ctx, args.runId),
    ctx.db.query('agentBindings').withIndex('by_bindingId', q => q.eq('bindingId', args.bindingId)).unique(),
    ctx.db.query('agentEnvironments').withIndex('by_environmentId', q => q.eq('environmentId', args.environmentId)).unique(),
    ctx.db.query('workspaceAgentDefinitions').withIndex('by_agentId', q => q.eq('agentId', args.agentId)).unique(),
    ctx.db.query('workspaces').withIndex('by_workspaceId', q => q.eq('workspaceId', workspaceId)).unique(),
    ctx.db.query('workspacePrincipals').withIndex('by_workspaceId_userId', q => q.eq('workspaceId', workspaceId).eq('userId', args.actorUserId)).unique(),
    loadScopeContext(ctx, workspaceId, args.actorUserId),
  ])
  if (!run || !session || !binding || !environment || !agent || !workspace || !principal) throw new ConvexError('DRIVE_RUN_UNAVAILABLE')
  const rows = [session, binding, environment, agent]
  if (rows.some(row => row.workspaceId !== workspaceId) || workspace.status !== 'active' || workspace.archivedAt !== undefined
    || agent.archivedAt !== undefined || agent.deletedAt !== undefined || principal.archivedAt !== undefined
    || principal.type !== 'human' || binding.agentId !== agent.agentId || binding.environmentId !== environment.environmentId
    || (environment.kind !== 'overlay_cloud' && binding.adapterConfig?.connectedAgentDrive !== true)) throw new ConvexError('DRIVE_RUN_UNAVAILABLE')
  const creatorOnly = agent.visibility === 'creator'
  if (creatorOnly && agent.createdByPrincipalId !== principal.principalId) throw new ConvexError('DRIVE_RUN_UNAVAILABLE')
  const currentScope: AgentDriveAuthorityClaims['scope'] = creatorOnly
    ? { kind: 'personal', workspaceId, ownerUserId: args.actorUserId } : { kind: 'workspace', workspaceId }
  const hardDeadlineAt = session.hardDeadlineAt ?? session.capabilitySnapshot?.hardExpiresAt
  if (typeof hardDeadlineAt !== 'number' || !Number.isSafeInteger(hardDeadlineAt)) throw new ConvexError('DRIVE_RUN_UNAVAILABLE')
  if (run.bindingId !== session.bindingId || run.environmentId !== session.environmentId) throw new ConvexError('DRIVE_RUN_UNAVAILABLE')
  const phase = run.remoteLifecycle?.phase ?? run.status
  if (['cancelled', 'cancelling', 'completed', 'failed', 'needs_attention'].includes(phase)) throw new ConvexError('DRIVE_RUN_UNAVAILABLE')
  if (!isCurrentDriveRun(args, {
    actorUserId: run.userId, agentId: run.agentId ?? '', runId: run.externalRunId ?? '',
    sessionId: session.sessionId, bindingId: session.bindingId, environmentId: session.environmentId,
    scope: currentScope, bindingEnabled: binding.enabled,
    environmentRevoked: environment.status === 'revoked' || environment.status === 'pending',
    actorIsMember: ['owner', 'admin', 'member'].includes(scopeContext.viewer.role ?? ''),
    status: session.status, hardDeadlineAt,
    ...(session.attemptId !== undefined && session.executionGeneration !== undefined
      ? { execution: { attemptId: session.attemptId, generation: session.executionGeneration } } : {}),
  })) throw new ConvexError('DRIVE_RUN_UNAVAILABLE')
  return { scope: currentScope, scopeContext, agent, run, session, hardDeadlineAt }
}

/** Small pages cap Convex read/return size even when inline file bodies approach the document limit. */
export const manifestPageByServer = query({
  args: { ...driveAuthorityArgs, cursor: v.optional(v.string()), metadataOnly: v.optional(v.boolean()) },
  returns: v.object({
    // Canonical rows are validated by the Files table schema, including its evolving optional fields.
    rows: v.array(v.any()), scope: driveScopeValidator, nextCursor: v.union(v.string(), v.null()),
    viewer: v.object({ userId: v.string(), role: v.union(v.literal('owner'), v.literal('admin'), v.literal('member'), v.literal('guest'), v.null()) }),
  }),
  handler: async (ctx, args) => {
    const { scope, scopeContext } = await requireDriveAuthority(ctx, args)
    const page = scope.kind === 'personal'
      ? await ctx.db.query('files').withIndex('by_workspaceId_userId_archivedAt', q => q.eq('workspaceId', scope.workspaceId).eq('userId', scope.ownerUserId).eq('archivedAt', undefined))
        .paginate({ cursor: args.cursor ?? null, numItems: args.metadataOnly ? 128 : 8, maximumBytesRead: 4 * 1024 * 1024 })
      : await ctx.db.query('files').withIndex('by_workspaceId_scope_archivedAt', q => q.eq('workspaceId', scope.workspaceId).eq('scope', 'workspace').eq('archivedAt', undefined))
        .paginate({ cursor: args.cursor ?? null, numItems: args.metadataOnly ? 128 : 8, maximumBytesRead: 4 * 1024 * 1024 })
    const rows = page.page.filter(row => row.deletedAt === undefined && row.archivedAt === undefined
      && rowScope(row) === scope.kind && canReadResource(row, scopeContext.viewer))
    const manifestRows = args.metadataOnly ? rows.map(driveMetadata) : rows
    return { rows: manifestRows, scope, viewer: scopeContext.viewer, nextCursor: page.isDone ? null : page.continueCursor }
  },
})

/** Resolve only the exact current canonical storage source; a storage id alone grants nothing. */
export const storageSourceByServer = query({
  args: { ...driveAuthorityArgs, fileId: v.id('files'), storageId: v.id('_storage'), updatedAt: v.number() },
  returns: v.object({ url: v.string(), sizeBytes: v.number(), sha256: v.string() }),
  handler: async (ctx, args) => {
    const file = await requireDriveFile(ctx, args)
    if (file.r2Key || file.textInObjectStore || file.storageId !== args.storageId) throw new ConvexError('DRIVE_SOURCE_CHANGED')
    const [metadata, url] = await Promise.all([ctx.db.system.get(args.storageId), ctx.storage.getUrl(args.storageId)])
    if (!metadata || !url) throw new ConvexError('DRIVE_FILE_UNAVAILABLE')
    return { url, sizeBytes: metadata.size, sha256: metadata.sha256 }
  },
})

export const authorizeByServer = query({
  args: driveAuthorityArgs,
  returns: v.null(),
  handler: async (ctx, args) => { await requireDriveAuthority(ctx, args); return null },
})

/** Inline notes are read by exact revision, not retained across all manifest pages. */
export const inlineSourceByServer = query({
  args: { ...driveAuthorityArgs, fileId: v.id('files'), updatedAt: v.number() },
  returns: v.object({ text: v.string() }),
  handler: async (ctx, args) => {
    const file = await requireDriveFile(ctx, args)
    if (file.r2Key || file.storageId || file.textInObjectStore) throw new ConvexError('DRIVE_SOURCE_CHANGED')
    return { text: file.textContent ?? file.content ?? '' }
  },
})

export const fileByServer = query({
  args: { ...driveAuthorityArgs, fileId: v.id('files'), updatedAt: v.number() },
  returns: v.any(),
  handler: async (ctx, args) => {
    return requireDriveFile(ctx, args)
  },
})

function driveMetadata(row: Doc<'files'>) {
  const { _id, userId, workspaceId, scope, name, parentId, type, kind, textInObjectStore, r2Key, storageId, mimeType, sizeBytes, createdAt, updatedAt } = row
  const metadata = { _id, userId, workspaceId, scope, name, parentId, type, kind, textInObjectStore, r2Key, storageId, mimeType, sizeBytes, createdAt, updatedAt }
  return type === 'file' && !r2Key && !storageId && !textInObjectStore
    ? { ...metadata, driveInline: { sizeBytes: new TextEncoder().encode(row.textContent ?? row.content ?? '').byteLength } } : metadata
}

async function requireDriveFile(ctx: QueryCtx, args: AgentDriveAuthorityClaims & { serverSecret: string; fileId: Id<'files'>; updatedAt: number }) {
  const { scope, scopeContext } = await requireDriveAuthority(ctx, args)
  const file = await ctx.db.get(args.fileId)
  if (!file || file.workspaceId !== scope.workspaceId || file.type !== 'file' || file.deletedAt !== undefined
    || file.archivedAt !== undefined || rowScope(file) !== scope.kind || !canReadResource(file, scopeContext.viewer)
    || (scope.kind === 'personal' && file.userId !== scope.ownerUserId)
    || (file.updatedAt ?? file.createdAt) !== args.updatedAt) throw new ConvexError('DRIVE_SOURCE_CHANGED')
  return file
}
