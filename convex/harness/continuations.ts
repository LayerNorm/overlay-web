import { v } from 'convex/values'
import { internalAction, internalMutation, internalQuery, mutation, query } from '../_generated/server'
import { requireServerSecret } from '../lib/auth'

const MAX_CONTINUATION_BYTES = 4 * 1024 * 1024

function json(value: unknown): string {
  return JSON.stringify(value)
}

export const handoff = mutation({
  args: {
    serverSecret: v.string(),
    actorUserId: v.string(),
    runId: v.string(),
    workflowRunId: v.string(),
    executionGeneration: v.number(),
    expectedRevision: v.number(),
    workflowKind: v.union(v.literal('native'), v.literal('personal')),
    checkpointJson: v.string(),
    launchInputJson: v.string(),
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
    if (new TextEncoder().encode(args.checkpointJson).byteLength
      + new TextEncoder().encode(args.launchInputJson).byteLength > MAX_CONTINUATION_BYTES) {
      throw new Error('HARNESS_CONTINUATION_CHECKPOINT_TOO_LARGE')
    }
    const checkpoint = JSON.parse(args.checkpointJson) as { version?: unknown; messages?: unknown[] }
    const launch = JSON.parse(args.launchInputJson) as { access?: { runId?: string; executionGeneration?: number } }
    if (checkpoint.version !== 1 || !Array.isArray(checkpoint.messages)
      || launch.access?.runId !== args.runId
      || launch.access.executionGeneration !== args.executionGeneration + 1) {
      throw new Error('HARNESS_CONTINUATION_CHECKPOINT_INVALID')
    }
    const run = await ctx.db.query('harnessRuns')
      .withIndex('by_runId', q => q.eq('runId', args.runId))
      .unique()
    if (!run || run.actorUserId !== args.actorUserId) throw new Error('HARNESS_RUN_NOT_FOUND')
    const current = JSON.parse(run.metadataJson) as {
      runId: string; rootRunId: string; workflowRunId?: string; executionGeneration?: number
      revision: number; planRevision: number; status: string; policy: { executionPolicyVersion?: number }
      modelReservation?: unknown; resourceRequestToken?: string
    }
    if (current.workflowRunId !== args.workflowRunId
      || (current.executionGeneration ?? 0) !== args.executionGeneration
      || current.revision !== args.expectedRevision) {
      throw new Error('HARNESS_CONTINUATION_CAS_CONFLICT')
    }
    if (current.policy.executionPolicyVersion !== 2 || current.status !== 'running'
      || current.modelReservation || current.resourceRequestToken) {
      throw new Error('HARNESS_CONTINUATION_BOUNDARY_UNSAFE')
    }
    const generation = args.executionGeneration + 1
    const now = Date.now()
    const checkpointToken = `${args.runId}:${generation}`
    const next = {
      ...current,
      workflowRunId: undefined,
      executionGeneration: generation,
      revision: current.revision + 1,
      updatedAt: now,
    }
    await ctx.db.patch(run._id, { metadataJson: json(next), updatedAt: now })
    await ctx.db.insert('harnessCheckpoints', {
      runId: args.runId,
      operationId: `continuation:${generation}`,
      revision: next.revision,
      metadataJson: json(next),
      planRevision: current.planRevision,
      purpose: 'continuation',
      generation,
      checkpointToken,
      checkpointJson: args.checkpointJson,
      launchInputJson: args.launchInputJson,
      createdAt: now,
    })
    await ctx.db.insert('harnessContinuationOutbox', {
      runId: args.runId, rootRunId: current.rootRunId, generation, checkpointToken,
      workflowKind: args.workflowKind, state: 'pending', attempts: 0,
      nextAttemptAt: now, createdAt: now, updatedAt: now,
    })
    return {
      runId: args.runId, rootRunId: current.rootRunId, status: next.status,
      executionGeneration: generation, revision: next.revision, updatedAt: now,
    }
  },
})

export const getLaunch = query({
  args: { serverSecret: v.string(), runId: v.string(), generation: v.number(), checkpointToken: v.string() },
  returns: v.union(v.object({
    workflowKind: v.union(v.literal('native'), v.literal('personal')),
    checkpointJson: v.string(),
    launchInputJson: v.string(),
  }), v.null()),
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret)
    const outbox = await ctx.db.query('harnessContinuationOutbox')
      .withIndex('by_runId_generation', q => q.eq('runId', args.runId).eq('generation', args.generation))
      .unique()
    if (!outbox || outbox.checkpointToken !== args.checkpointToken || outbox.state !== 'pending') return null
    const checkpoint = await ctx.db.query('harnessCheckpoints')
      .withIndex('by_checkpointToken', q => q.eq('checkpointToken', args.checkpointToken))
      .unique()
    if (!checkpoint?.checkpointJson || !checkpoint.launchInputJson) return null
    return {
      workflowKind: outbox.workflowKind,
      checkpointJson: checkpoint.checkpointJson,
      launchInputJson: checkpoint.launchInputJson,
    }
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
    const baseUrl = process.env.OVERLAY_BFF_URL?.replace(/\/$/, '')
    const secret = process.env.INTERNAL_API_SECRET
    if (!items.length || !baseUrl || !secret) return null
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
        await ctx.runMutation(internal.harness.continuations.noteAttempt, item)
      }
    }
    return null
  },
})
