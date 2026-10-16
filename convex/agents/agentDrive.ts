import { v } from 'convex/values'
import { query, type MutationCtx, type QueryCtx } from '../_generated/server'
import { requireServerSecret } from '../lib/auth'
import { loadScopeContext } from '../lib/resourceScope'
import { currentRemoteAttempt } from './remoteRunModel'
import { assertCurrentDriveRun, type AgentDriveAuthorityClaims } from '../../src/shared/agents/agent-drive-authority'
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
  if (process.env.OVERLAY_CONNECTED_AGENT_DRIVE !== '1') throw Error('DRIVE_DISABLED')
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
  if (!run || !session || !binding || !environment || !agent || !workspace || !principal) throw Error('DRIVE_RUN_UNAVAILABLE')
  const rows = [session, binding, environment, agent]
  if (rows.some(row => row.workspaceId !== workspaceId) || workspace.status !== 'active' || workspace.archivedAt !== undefined
    || agent.archivedAt !== undefined || agent.deletedAt !== undefined || principal.archivedAt !== undefined
    || principal.type !== 'human' || binding.agentId !== agent.agentId || binding.environmentId !== environment.environmentId
    || (environment.kind !== 'overlay_cloud' && binding.adapterConfig?.connectedAgentDrive !== true)) throw Error('DRIVE_RUN_UNAVAILABLE')
  const creatorOnly = agent.visibility === 'creator'
  if (creatorOnly && agent.createdByPrincipalId !== principal.principalId) throw Error('DRIVE_RUN_UNAVAILABLE')
  const currentScope: AgentDriveAuthorityClaims['scope'] = creatorOnly
    ? { kind: 'personal', workspaceId, ownerUserId: args.actorUserId } : { kind: 'workspace', workspaceId }
  const hardDeadlineAt = session.hardDeadlineAt ?? session.capabilitySnapshot?.hardExpiresAt
  if (typeof hardDeadlineAt !== 'number' || !Number.isSafeInteger(hardDeadlineAt)) throw Error('DRIVE_RUN_UNAVAILABLE')
  if (run.bindingId !== session.bindingId || run.environmentId !== session.environmentId) throw Error('DRIVE_RUN_UNAVAILABLE')
  const phase = run.remoteLifecycle?.phase ?? run.status
  if (['cancelled', 'cancelling', 'completed', 'failed', 'needs_attention'].includes(phase)) throw Error('DRIVE_RUN_UNAVAILABLE')
  assertCurrentDriveRun(args, {
    actorUserId: run.userId, agentId: run.agentId ?? '', runId: run.externalRunId ?? '',
    sessionId: session.sessionId, bindingId: session.bindingId, environmentId: session.environmentId,
    scope: currentScope, bindingEnabled: binding.enabled,
    environmentRevoked: environment.status === 'revoked' || environment.status === 'pending',
    actorIsMember: ['owner', 'admin', 'member'].includes(scopeContext.viewer.role ?? ''),
    status: session.status, hardDeadlineAt,
    ...(session.attemptId !== undefined && session.executionGeneration !== undefined
      ? { execution: { attemptId: session.attemptId, generation: session.executionGeneration } } : {}),
  })
  return { scope: currentScope, scopeContext, agent, run, session }
}

/** Small pages cap Convex read/return size even when inline file bodies approach the document limit. */
export const manifestPageByServer = query({
  args: { ...driveAuthorityArgs, cursor: v.optional(v.string()) },
  returns: v.object({
    // Canonical rows are validated by the Files table schema, including its evolving optional fields.
    rows: v.array(v.any()), scope: driveScopeValidator, nextCursor: v.union(v.string(), v.null()),
    viewer: v.object({ userId: v.string(), role: v.union(v.literal('owner'), v.literal('admin'), v.literal('member'), v.literal('guest'), v.null()) }),
  }),
  handler: async (ctx, args) => {
    const { scope, scopeContext } = await requireDriveAuthority(ctx, args)
    const page = scope.kind === 'personal'
      ? await ctx.db.query('files').withIndex('by_workspaceId_userId_archivedAt', q => q.eq('workspaceId', scope.workspaceId).eq('userId', scope.ownerUserId).eq('archivedAt', undefined))
        .paginate({ cursor: args.cursor ?? null, numItems: 8 })
      : await ctx.db.query('files').withIndex('by_workspaceId_scope_archivedAt', q => q.eq('workspaceId', scope.workspaceId).eq('scope', 'workspace').eq('archivedAt', undefined))
        .paginate({ cursor: args.cursor ?? null, numItems: 8 })
    const rows = page.page.filter(row => row.deletedAt === undefined && row.archivedAt === undefined
      && rowScope(row) === scope.kind && canReadResource(row, scopeContext.viewer))
    return { rows, scope, viewer: scopeContext.viewer, nextCursor: page.isDone ? null : page.continueCursor }
  },
})

/** Resolve only the exact current canonical storage source; a storage id alone grants nothing. */
export const storageSourceByServer = query({
  args: { ...driveAuthorityArgs, fileId: v.id('files'), storageId: v.id('_storage'), updatedAt: v.number() },
  returns: v.object({ url: v.string(), sizeBytes: v.number(), sha256: v.string() }),
  handler: async (ctx, args) => {
    const { scope, scopeContext } = await requireDriveAuthority(ctx, args)
    const file = await ctx.db.get(args.fileId)
    if (!file || file.workspaceId !== scope.workspaceId || file.type !== 'file' || file.deletedAt !== undefined
      || file.archivedAt !== undefined || rowScope(file) !== scope.kind || !canReadResource(file, scopeContext.viewer)
      || (scope.kind === 'personal' && file.userId !== scope.ownerUserId)
      || file.r2Key || file.textInObjectStore || file.storageId !== args.storageId
      || (file.updatedAt ?? file.createdAt) !== args.updatedAt) throw Error('DRIVE_SOURCE_CHANGED')
    const [metadata, url] = await Promise.all([ctx.db.system.get(args.storageId), ctx.storage.getUrl(args.storageId)])
    if (!metadata || !url) throw Error('DRIVE_FILE_UNAVAILABLE')
    return { url, sizeBytes: metadata.size, sha256: metadata.sha256 }
  },
})
