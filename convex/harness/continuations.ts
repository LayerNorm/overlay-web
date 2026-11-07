import { v } from 'convex/values'
import {
  internalAction, internalMutation, internalQuery, mutation, query,
  type MutationCtx,
} from '../_generated/server'
import { requireServerSecret } from '../lib/auth'

const workflowKind = v.union(v.literal('native'), v.literal('personal'))
const activeContinuationStatuses = [
  'running',
  'waiting_for_resources',
  'waiting_for_input',
  'waiting_for_approval',
  'waiting_for_children',
]

type ContinuationIdentity = {
  runId: string
  actorUserId: string
  workflowRunId: string
  executionGeneration: number
}

async function readOwnedRun(ctx: MutationCtx, identity: ContinuationIdentity) {
  const run = await ctx.db.query('harnessRuns')
    .withIndex('by_runId', q => q.eq('runId', identity.runId))
    .unique()
  if (!run || run.actorUserId !== identity.actorUserId) throw new Error('HARNESS_RUN_NOT_FOUND')
  const metadata = JSON.parse(run.metadataJson) as {
    workflowRunId?: string
    executionGeneration?: number
    revision: number
    rootRunId: string
    planRevision: number
    status: string
    authorizationPause?: unknown
    policy: {
      actorUserId: string
      executionPolicyVersion?: number
      workspaceId?: string
      taskDeadlineAt?: number
    }
    modelReservation?: unknown
    resourceRequestToken?: string
  }
  if (metadata.workflowRunId !== identity.workflowRunId
    || (metadata.executionGeneration ?? 0) !== identity.executionGeneration
    || metadata.policy.actorUserId !== identity.actorUserId) {
    throw new Error('HARNESS_EXECUTION_NOT_OWNED')
  }
  return { run, metadata }
}

export const generateUploadUrl = mutation({
  args: {
    serverSecret: v.string(),
    actorUserId: v.string(),
    runId: v.string(),
    workflowRunId: v.string(),
    executionGeneration: v.number(),
  },
  returns: v.object({ uploadUrl: v.string() }),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const { metadata } = await readOwnedRun(ctx, args)
    if (metadata.policy.executionPolicyVersion !== 2
      || !activeContinuationStatuses.includes(metadata.status)
      || metadata.authorizationPause
      || (metadata.policy.taskDeadlineAt !== undefined && metadata.policy.taskDeadlineAt <= Date.now())
      || metadata.modelReservation || metadata.resourceRequestToken) {
      throw new Error('HARNESS_CONTINUATION_BOUNDARY_UNSAFE')
    }
    return { uploadUrl: await ctx.storage.generateUploadUrl() }
  },
})

export const handoff = mutation({
  args: {
    serverSecret: v.string(),
    actorUserId: v.string(),
    runId: v.string(),
    workflowRunId: v.string(),
    executionGeneration: v.number(),
    expectedRevision: v.number(),
    workflowKind,
    checkpointStorageId: v.id('_storage'),
  },
  returns: v.object({
    runId: v.string(),
    rootRunId: v.string(),
    status: v.string(),
    executionGeneration: v.number(),
    revision: v.number(),
    updatedAt: v.number(),
  }),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const { run, metadata: current } = await readOwnedRun(ctx, args)
    if (current.revision !== args.expectedRevision) throw new Error('HARNESS_CONTINUATION_CAS_CONFLICT')
    if (current.policy.executionPolicyVersion !== 2
      || !activeContinuationStatuses.includes(current.status)
      || current.authorizationPause
      || (current.policy.taskDeadlineAt !== undefined && current.policy.taskDeadlineAt <= Date.now())
      || current.modelReservation || current.resourceRequestToken) {
      throw new Error('HARNESS_CONTINUATION_BOUNDARY_UNSAFE')
    }
    const storage = await ctx.db.system.get(args.checkpointStorageId)
    if (!storage) throw new Error('HARNESS_CONTINUATION_STORAGE_NOT_FOUND')
    const generation = args.executionGeneration + 1
    const now = Date.now()
    const checkpointToken = `${args.runId}:${generation}`
    const next = {
      ...current,
      workflowRunId: undefined,
      handoffWorkflowRunId: args.workflowRunId,
      executionGeneration: generation,
      revision: current.revision + 1,
      updatedAt: now,
    }
    await ctx.db.patch(run._id, { metadataJson: JSON.stringify(next), updatedAt: now })
    await ctx.db.insert('harnessCheckpoints', {
      runId: args.runId,
      operationId: `continuation:${generation}`,
      revision: next.revision,
      metadataJson: JSON.stringify(next),
      planRevision: current.planRevision,
      purpose: 'continuation',
      generation,
      checkpointToken,
      checkpointStorageId: args.checkpointStorageId,
      createdAt: now,
    })
    await ctx.db.insert('harnessContinuationOutbox', {
      runId: args.runId,
      rootRunId: current.rootRunId,
      generation,
      previousWorkflowRunId: args.workflowRunId,
      previousExecutionGeneration: args.executionGeneration,
      checkpointToken,
      workflowKind: args.workflowKind,
      state: 'pending',
      attempts: 0,
      nextAttemptAt: now,
      createdAt: now,
      updatedAt: now,
    })
    return {
      runId: args.runId,
      rootRunId: current.rootRunId,
      status: next.status,
      executionGeneration: generation,
      revision: next.revision,
      updatedAt: now,
    }
  },
})

export const getLaunch = query({
  args: { serverSecret: v.string(), runId: v.string(), generation: v.number(), checkpointToken: v.string() },
  returns: v.union(v.object({
    workflowKind,
    actorUserId: v.string(),
    workspaceId: v.optional(v.string()),
    executionGeneration: v.number(),
    checkpointStorageUrl: v.optional(v.string()),
    checkpointJson: v.optional(v.string()),
    launchInputJson: v.optional(v.string()),
  }), v.null()),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const outbox = await ctx.db.query('harnessContinuationOutbox')
      .withIndex('by_runId_generation', q => q.eq('runId', args.runId).eq('generation', args.generation))
      .unique()
    if (!outbox || outbox.checkpointToken !== args.checkpointToken || outbox.state !== 'pending') return null
    const run = await ctx.db.query('harnessRuns')
      .withIndex('by_runId', q => q.eq('runId', args.runId))
      .unique()
    if (!run) return null
    const metadata = JSON.parse(run.metadataJson) as {
      status: string
      executionGeneration?: number
      authorizationPause?: unknown
      policy: { actorUserId: string; workspaceId?: string; taskDeadlineAt?: number }
    }
    if (['completed', 'failed', 'cancelled', 'waiting_for_authorization'].includes(metadata.status)
      || metadata.authorizationPause
      || (metadata.policy.taskDeadlineAt !== undefined && metadata.policy.taskDeadlineAt <= Date.now())
      || (metadata.executionGeneration ?? 0) !== args.generation) return null
    const checkpoint = await ctx.db.query('harnessCheckpoints')
      .withIndex('by_checkpointToken', q => q.eq('checkpointToken', args.checkpointToken))
      .unique()
    if (!checkpoint) return null
    const base = {
      workflowKind: outbox.workflowKind,
      actorUserId: metadata.policy.actorUserId,
      ...(metadata.policy.workspaceId ? { workspaceId: metadata.policy.workspaceId } : {}),
      executionGeneration: args.generation,
    }
    if (checkpoint.checkpointStorageId) {
      const checkpointStorageUrl = await ctx.storage.getUrl(checkpoint.checkpointStorageId)
      if (!checkpointStorageUrl) return null
      return { ...base, checkpointStorageUrl }
    }
    if (checkpoint.checkpointJson !== undefined && checkpoint.launchInputJson !== undefined) {
      return { ...base, checkpointJson: checkpoint.checkpointJson, launchInputJson: checkpoint.launchInputJson }
    }
    return null
  },
})

export const listDue = internalQuery({
  args: { now: v.number(), limit: v.number() },
  returns: v.array(v.object({ runId: v.string(), generation: v.number(), checkpointToken: v.string() })),
  handler: async (ctx, args) => (await ctx.db.query('harnessContinuationOutbox')
    .withIndex('by_state_nextAttemptAt', q => q.eq('state', 'pending').lte('nextAttemptAt', args.now))
    .take(Math.min(100, Math.max(1, args.limit))))
    .map(row => ({ runId: row.runId, generation: row.generation, checkpointToken: row.checkpointToken })),
})

export const noteAttempt = internalMutation({
  args: { runId: v.string(), generation: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const outbox = await ctx.db.query('harnessContinuationOutbox')
      .withIndex('by_runId_generation', q => q.eq('runId', args.runId).eq('generation', args.generation))
      .unique()
    if (!outbox || outbox.state !== 'pending') return null
    const now = Date.now()
    const delay = Math.min(15 * 60_000, 2 ** Math.min(outbox.attempts, 9) * 1_000)
    await ctx.db.patch(outbox._id, {
      attempts: outbox.attempts + 1, lastAttemptAt: now, nextAttemptAt: now + delay, updatedAt: now,
    })
    return null
  },
})

export const dispatchDue = internalAction({
  args: {},
  handler: async (ctx) => {
    const { internal } = await import('../_generated/api')
    const items = await ctx.runQuery(internal.harness.continuations.listDue, { now: Date.now(), limit: 25 })
    const nativeItems = await ctx.runQuery(internal.collaboration.assignmentRecovery.listDue, { now: Date.now() })
    const baseUrl = process.env.OVERLAY_BFF_URL?.replace(/\/$/, '')
    const secret = process.env.INTERNAL_API_SECRET
    if ((!items.length && !nativeItems.length) || !baseUrl || !secret) return null
    const { fetchAppCallback } = await import('../lib/appCallback')
    for (const item of items) {
      try {
        const response = await fetchAppCallback(`${baseUrl}/api/v1/harness/continuation`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-internal-api-secret': secret },
          body: JSON.stringify(item),
        })
        if (!response.ok) throw new Error(`harness_continuation_callback_${response.status}`)
      } catch (error) {
        console.warn('[HarnessContinuation] dispatch deferred', {
          runId: item.runId, generation: item.generation,
          error: error instanceof Error ? error.message : 'unknown',
        })
      } finally {
        await ctx.runMutation(internal.harness.continuations.noteAttempt, {
          runId: item.runId, generation: item.generation,
        })
      }
    }
    for (const item of nativeItems) {
      try {
        const response = await fetchAppCallback(`${baseUrl}/api/v1/harness/continuation`, {
          method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-api-secret': secret },
          body: JSON.stringify(item),
        })
        if (!response.ok) throw new Error(`native_recovery_callback_${response.status}`)
      } catch (error) {
        console.warn('[NativeRecovery] dispatch deferred', { kind: item.kind, id: item.id,
          error: error instanceof Error ? error.message : 'unknown' })
      } finally {
        await ctx.runMutation(internal.collaboration.assignmentRecovery.noteAttempt, item)
      }
    }
    return null
  },
})
