import { paginationOptsValidator } from 'convex/server'
import { v } from 'convex/values'
import { internal } from '../_generated/api'
import { internalMutation, mutation, query, type MutationCtx } from '../_generated/server'
import { requireServerSecret } from '../lib/auth'
import type { Id } from '../_generated/dataModel'

/**
 * One-time removal of everything the retired third-party agent feature (Codex, Claude Code and other harnesses over
 * ACP) stored. The owner asked for its history to be deleted, not kept. Run after the deploy that removes the feature:
 *
 * 1. `scripts/db/purge-connected-agent-credentials.mts` deletes the vault secrets of stored agent accounts and
 *    imported config values, then their rows (they are read here because only the server can reach the vault).
 * 2. `migrations/purgeConnectedAgents:purgeRemovedTables` deletes every other row, rescheduling itself until empty.
 * 3. `migrations/purgeConnectedAgents:purgeRemoteRuns` deletes third-party agent runs and the replies they wrote.
 *
 * Delete this file, and the remote-run fields left on `conversationAgentRuns` and `conversationMessages`, once
 * production reports nothing left.
 */
const REMOVED_TABLES = [
  'agentBindings', 'agentRunCommands', 'agentRemoteSessions', 'agentRemoteRunIntents', 'agentEventRateWindows',
  'agentWorkspacePolicyUsage', 'agentMcpCalls', 'agentMcpResultChunks', 'agentMcpCallBudgets',
  'agentApprovalRequests', 'agentArtifacts', 'agentSandboxSettlements', 'agentHarnessSessions',
  'agentDriveRetiredObjects', 'agentDriveUploads', 'agentDriveWriteBudgets', 'agentDriveMetadataReceipts',
  'agentProfiles', 'agentProfileChunks',
] as const
const CREDENTIAL_TABLES = ['agentProviderAccounts', 'agentSecrets'] as const
const BATCH = 200

/** These tables are no longer in the schema, so their rows are reached without schema types. */
type UntypedDb = {
  query(table: string): { take(count: number): Promise<Array<{ _id: string; credentialRef?: unknown }>> }
  delete(id: string): Promise<void>
}
const untyped = (ctx: { db: unknown }) => ctx.db as UntypedDb

export const purgeRemovedTables = internalMutation({
  args: { dryRun: v.boolean() },
  returns: v.object({ deleted: v.record(v.string(), v.number()), isDone: v.boolean() }),
  handler: async (ctx, { dryRun }) => {
    const deleted: Record<string, number> = {}
    let isDone = true
    for (const table of REMOVED_TABLES) {
      const rows = await untyped(ctx).query(table).take(BATCH)
      if (rows.length === 0) continue
      deleted[table] = rows.length
      if (rows.length === BATCH) isDone = false
      if (!dryRun) for (const row of rows) await untyped(ctx).delete(row._id)
    }
    if (!dryRun && !isDone) await ctx.scheduler.runAfter(0, internal.migrations.purgeConnectedAgents.purgeRemovedTables, { dryRun: false })
    return { deleted, isDone }
  },
})

/** Third-party agent runs and the replies (and stored reply text) they wrote. */
export const purgeRemoteRuns = internalMutation({
  args: { paginationOpts: paginationOptsValidator, dryRun: v.boolean() },
  returns: v.object({ scanned: v.number(), deleted: v.number(), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { paginationOpts, dryRun }) => {
    const page = await ctx.db.query('conversationAgentRuns').paginate({
      ...paginationOpts, numItems: Math.min(Math.max(paginationOpts.numItems, 1), 100),
    })
    let deleted = 0
    for (const run of page.page) {
      if (run.runner !== 'remote') continue
      deleted += 1
      if (dryRun) continue
      await deleteMessage(ctx, run.assistantMessageId)
      await ctx.db.delete(run._id)
    }
    return { scanned: page.page.length, deleted, isDone: page.isDone, continueCursor: page.continueCursor }
  },
})

async function deleteMessage(ctx: MutationCtx, messageId: Id<'conversationMessages'>) {
  const message = await ctx.db.get(messageId)
  if (!message) return
  const chunks = await ctx.db.query('remoteMessageTextChunks')
    .withIndex('by_messageId_partIndex_chunkIndex', (q) => q.eq('messageId', message._id)).take(1_000)
  for (const chunk of chunks) await ctx.db.delete(chunk._id)
  await ctx.db.delete(message._id)
}

/** Vault references still held by retired credential rows; the server deletes the secrets, then the rows. */
export const listRetiredCredentialsByServer = query({
  args: { serverSecret: v.string() },
  returns: v.array(v.object({ table: v.string(), id: v.string(), credentialRef: v.string() })),
  handler: async (ctx, { serverSecret }) => {
    requireServerSecret(serverSecret)
    const rows = []
    for (const table of CREDENTIAL_TABLES) {
      for (const row of await untyped(ctx).query(table).take(BATCH)) {
        if (typeof row.credentialRef === 'string') rows.push({ table, id: row._id, credentialRef: row.credentialRef })
      }
    }
    return rows
  },
})

export const deleteRetiredCredentialRowsByServer = mutation({
  args: { serverSecret: v.string(), ids: v.array(v.string()) },
  returns: v.number(),
  handler: async (ctx, { serverSecret, ids }) => {
    requireServerSecret(serverSecret)
    for (const id of ids.slice(0, BATCH)) await untyped(ctx).delete(id)
    return Math.min(ids.length, BATCH)
  },
})
