import { v } from 'convex/values'
import { internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from '../_generated/server'
import { requireAccessToken, validateServerSecret } from '../lib/auth'
import { assertCanCreateInScope, getReadableRow, listScopedRows, scopeContextLoader } from '../lib/resourceScope'
import { scopeMutations } from '../lib/scopeMutations'
import type { Doc, Id } from '../_generated/dataModel'
import { internal } from '../_generated/api'
import { paidWorkspaceAccountFor } from '../billing/workspacePayer'
import { enqueueTerminalWebhook } from './terminalWebhook'
import {
  computeNextRunAt as sharedComputeNextRunAt,
  withUtcFields,
  DEFAULT_SCHEDULE as SHARED_DEFAULT_SCHEDULE,
  MIN_INTERVAL_MINUTES as SHARED_MIN_INTERVAL_MINUTES,
} from '../../src/shared/automations/schedule'
import { AUTOMATION_THREAD_RUN_OWNER_PREFIX, automationRunTurnId } from '../../src/shared/automations/run-identity'
import { createAgentThread } from '../agents/agentThreads'
import { recordConversationEvent } from '../collaboration/events'
import { isWaitingForOwner, threadAgentRunFor } from '../lib/automationThreadRuns'
import { DEFAULT_MODEL_ID } from '../../src/shared/ai/gateway/model-types'

const automationSchedule = v.object({
  kind: v.union(
    v.literal('interval'),
    v.literal('daily'),
    v.literal('weekdays'),
    v.literal('weekly'),
    v.literal('monthly'),
  ),
  intervalMinutes: v.optional(v.number()),
  minuteUTC: v.optional(v.number()),
  hourUTC: v.optional(v.number()),
  dayOfWeekUTC: v.optional(v.number()),
  dayOfMonthUTC: v.optional(v.number()),
  hour: v.optional(v.number()),
  minute: v.optional(v.number()),
  dayOfWeek: v.optional(v.number()),
  dayOfMonth: v.optional(v.number()),
})

const automationDoc = v.any()
const scopeArg = v.optional(v.union(v.literal('personal'), v.literal('workspace')))
const viewArg = v.optional(v.union(v.literal('personal'), v.literal('workspace'), v.literal('archived')))

// An archived automation stops running (the scheduler only picks up enabled ones); restoring leaves it paused.
export const { setScope, archive, restore } = scopeMutations('automations', 'content', { onArchive: { enabled: false, nextRunAt: undefined } })
const automationRunDoc = v.any()

async function authorizeUserAccess(params: {
  accessToken?: string
  serverSecret?: string
  userId: string
}) {
  if (validateServerSecret(params.serverSecret)) {
    return
  }
  await requireAccessToken(params.accessToken ?? '', params.userId)
}

function clampInteger(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.floor(value)))
}

type AutomationSchedule = NonNullable<Doc<'automations'>['schedule']>
type AutomationPolicyCtx = MutationCtx | QueryCtx

const DEFAULT_SCHEDULE = SHARED_DEFAULT_SCHEDULE
const MIN_INTERVAL_MINUTES = SHARED_MIN_INTERVAL_MINUTES
const MAX_ENABLED_AUTOMATIONS = 25
/**
 * A queued run that never started within a day is treated as lost. Running runs are
 * never failed by age: their durable workflow settles them, however long the work takes.
 */
const UNSTARTED_AUTOMATION_RUN_EXPIRY_MS = 24 * 60 * 60_000
/**
 * Per-user cap for claimDueRuns. Prevents a single user with many due
 * automations from monopolizing the per-tick batch and starving other users.
 * With MAX_ENABLED_AUTOMATIONS=25 and MIN_INTERVAL_MINUTES=15, a user can
 * have at most ~2 runs due per minute in steady state, so 5 is a generous
 * ceiling that still leaves room for burst catch-up without starving others.
 */
const MAX_RUNS_PER_USER_PER_TICK = 5
/**
 * Over-fetch factor so the round-robin has candidates from multiple users
 * to choose from after the per-user cap is applied.
 */
const CLAIM_CANDIDATE_BATCH_SIZE = 100
const AUTOMATION_POLICY_ERRORS = {
  intervalTooFrequent: 'automation_interval_too_frequent',
  paidPlanRequired: 'automation_paid_plan_required',
  enabledLimitReached: 'automation_enabled_limit_reached',
} as const

function assertSchedulePolicy(schedule: AutomationSchedule): void {
  if (schedule.kind === 'interval' && (schedule.intervalMinutes ?? 60) < MIN_INTERVAL_MINUTES) {
    throw new Error(`${AUTOMATION_POLICY_ERRORS.intervalTooFrequent}:${MIN_INTERVAL_MINUTES}`)
  }
}

/** Plans belong to workspaces: automations need the workspace they run in to have a paid plan. */
async function workspaceIsPaid(ctx: AutomationPolicyCtx, userId: string, workspaceId: string | undefined) {
  return Boolean(await paidWorkspaceAccountFor(ctx, userId, workspaceId))
}

async function countEnabledAutomations(
  ctx: AutomationPolicyCtx,
  userId: string,
  excludeAutomationId?: Id<'automations'>,
): Promise<number> {
  const rows = await ctx.db
    .query('automations')
    .withIndex('by_userId_enabled', (q) => q.eq('userId', userId).eq('enabled', true))
    .collect()
  return rows.filter((row) => !row.deletedAt && row._id !== excludeAutomationId)
    .length
}

async function enforceAutomationPolicy(
  ctx: AutomationPolicyCtx,
  params: {
    userId: string
    workspaceId: string | undefined
    enabled: boolean
    schedule: AutomationSchedule
    automationId?: Id<'automations'>
  },
): Promise<void> {
  assertSchedulePolicy(params.schedule)
  if (!params.enabled) return

  if (!(await workspaceIsPaid(ctx, params.userId, params.workspaceId))) {
    throw new Error(AUTOMATION_POLICY_ERRORS.paidPlanRequired)
  }

  const enabledCount = await countEnabledAutomations(ctx, params.userId, params.automationId)
  if (enabledCount >= MAX_ENABLED_AUTOMATIONS) {
    throw new Error(`${AUTOMATION_POLICY_ERRORS.enabledLimitReached}:${MAX_ENABLED_AUTOMATIONS}`)
  }
}

async function getAutomationRunPolicyViolation(
  ctx: MutationCtx,
  automation: Doc<'automations'>,
): Promise<string | null> {
  const schedule = automation.schedule ?? DEFAULT_SCHEDULE
  if (schedule.kind === 'interval' && (schedule.intervalMinutes ?? 60) < MIN_INTERVAL_MINUTES) {
    return `Automation paused because interval automations must run at least ${MIN_INTERVAL_MINUTES} minutes apart.`
  }
  if (!(await workspaceIsPaid(ctx, automation.userId, automation.workspaceId))) {
    return 'Automation paused because enabled automations require a paid plan.'
  }
  if (
    (await countEnabledAutomations(ctx, automation.userId)) >
    MAX_ENABLED_AUTOMATIONS
  ) {
    return `Automation paused because the account exceeds the ${MAX_ENABLED_AUTOMATIONS} enabled automation limit.`
  }
  return null
}

export function computeNextRunAt(scheduleInput: AutomationSchedule, fromMs: number, timeZone?: string): number {
  return sharedComputeNextRunAt(scheduleInput, fromMs, timeZone)
}

/** The caller's own automations plus other members' workspace-scoped ones, for a view. */
export async function listWorkspaceAutomations(
  ctx: QueryCtx,
  { userId, workspaceId, view }: { userId: string; workspaceId: string; view?: 'personal' | 'workspace' | 'archived' },
) {
  return await listScopedRows(ctx, {
    userId, workspaceId, view,
    fetchMine: async () => await ctx.db.query('automations')
      .withIndex('by_workspaceId_userId', (q) => q.eq('workspaceId', workspaceId).eq('userId', userId)).collect(),
    fetchShared: async (ws) => await ctx.db.query('automations')
      .withIndex('by_workspaceId_scope_archivedAt', (q) => q.eq('workspaceId', ws).eq('scope', 'workspace')).collect(),
  })
}

export const list = query({
  args: {
    userId: v.string(),
    workspaceId: v.optional(v.string()),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    includeDeleted: v.optional(v.boolean()),
    excludeAgentBound: v.optional(v.boolean()),
    limit: v.optional(v.number()),
    beforeUpdatedAt: v.optional(v.number()),
    /** personal, workspace, or archived; omitted means everything active that the caller can see. */
    view: viewArg,
  },
  returns: v.array(automationDoc),
  handler: async (ctx, { userId, workspaceId, accessToken, serverSecret, includeDeleted, excludeAgentBound, limit, beforeUpdatedAt, view }) => {
    try {
      await authorizeUserAccess({ userId, accessToken, serverSecret })
    } catch {
      return []
    }
    const pageLimit = Math.min(100, Math.max(1, Math.floor(limit ?? 100)))
    if (workspaceId !== undefined) {
      return (await listWorkspaceAutomations(ctx, { userId, workspaceId, view }))
        .filter((row) => (includeDeleted ? true : !row.deletedAt))
        .filter((row) => (excludeAgentBound ? !row.agentId : true))
        .filter((row) => (beforeUpdatedAt !== undefined && Number.isFinite(beforeUpdatedAt) ? row.updatedAt < beforeUpdatedAt : true))
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, pageLimit)
    }
    // Over-fetch by 3x to account for in-memory filters (deletedAt, workspaceId).
    const scanLimit = Math.min(300, Math.max(pageLimit * 3, 100))
    const rows = await ctx.db
      .query('automations')
      .withIndex('by_userId_updatedAt', (q) => {
        const scoped = q.eq('userId', userId)
        return beforeUpdatedAt !== undefined && Number.isFinite(beforeUpdatedAt)
          ? scoped.lt('updatedAt', beforeUpdatedAt)
          : scoped
      })
      .order('desc')
      .take(scanLimit)
    return (
      rows
      .filter((row) => row.userId === userId)
      .filter((row) => (view === 'archived' ? row.archivedAt !== undefined : row.archivedAt === undefined))
      .filter((row) => (includeDeleted ? true : !row.deletedAt))
      // The standalone Automations page lists only standalone automations;
      // agent-owned automations live as threads under their agent.
      .filter((row) => (excludeAgentBound ? !row.agentId : true))
      .slice(0, pageLimit)
    )
  },
})

export const get = query({
  args: {
    automationId: v.id('automations'),
    userId: v.string(),
    workspaceId: v.optional(v.string()),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
  },
  returns: v.union(automationDoc, v.null()),
  handler: async (ctx, { automationId, userId, workspaceId, accessToken, serverSecret }) => {
    try {
      await authorizeUserAccess({ userId, accessToken, serverSecret })
    } catch {
      return null
    }
    const automation = await getReadableRow(ctx, { row: await ctx.db.get(automationId), userId, workspaceId })
    return automation && !automation.deletedAt ? automation : null
  },
})

export const create = mutation({
  args: {
    userId: v.string(),
    workspaceId: v.optional(v.string()),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    name: v.string(),
    description: v.optional(v.string()),
    instructions: v.string(),
    enabled: v.optional(v.boolean()),
    schedule: automationSchedule,
    timezone: v.optional(v.string()),
    modelId: v.optional(v.string()),
    graphSource: v.optional(v.string()),
    graph: v.optional(v.any()),
    sourceConversationId: v.optional(v.id('conversations')),
    concurrencyPolicy: v.optional(v.union(v.literal('skip'), v.literal('queue'))),
    scope: scopeArg,
    byAgent: v.optional(v.boolean()),
    /** Runs the automation as this workspace agent, in a thread with it. */
    agentId: v.optional(v.string()),
  },
  returns: v.id('automations'),
  handler: async (ctx, args) => {
    await authorizeUserAccess(args)
    const scope = await assertCanCreateInScope(ctx, { kind: 'content', scope: args.scope, workspaceId: args.workspaceId, userId: args.userId })
    let sourceAgentId: string | undefined
    if (args.sourceConversationId) {
      const conversation = await ctx.db.get(args.sourceConversationId)
      if (!conversation || conversation.userId !== args.userId || conversation.deletedAt) {
        throw new Error('Unauthorized')
      }
      // Automations drafted inside an agent thread belong to that agent:
      // they nest under it in the sidebar and never appear on the standalone
      // Automations page.
      sourceAgentId = conversation.agentId
    }
    const now = Date.now()
    const enabled = args.enabled ?? true
    await enforceAutomationPolicy(ctx, {
      userId: args.userId,
      workspaceId: args.workspaceId,
      enabled,
      schedule: args.schedule,
    })
    const timezone = args.timezone?.trim() || 'UTC'
    const schedule = withUtcFields(args.schedule, timezone, now)
    const automationId = await ctx.db.insert('automations', {
      userId: args.userId,
      workspaceId: args.workspaceId,
      scope,
      name: args.name.trim() || 'Untitled automation',
      description: args.description?.trim() || '',
      instructions: args.instructions.trim(),
      enabled,
      schedule,
      timezone,
      nextRunAt: enabled ? computeNextRunAt(schedule, now, timezone) : undefined,
      modelId: args.modelId?.trim() || undefined,
      graphSource: args.graphSource?.trim() || undefined,
      graph: args.graph ?? undefined,
      sourceConversationId: args.sourceConversationId,
      agentId: args.agentId?.trim() || sourceAgentId,
      concurrencyPolicy: args.concurrencyPolicy ?? 'skip',
      createdByAgent: args.byAgent || undefined,
      createdAt: now,
      updatedAt: now,
    })
    // Every automation is a schedule on one thread: bind it now so the
    // thread is listed in the sidebar before the first run.
    const created = await ctx.db.get(automationId)
    if (created?.workspaceId) await bindAutomationThread(ctx, created)
    return automationId
  },
})

export const update = mutation({
  args: {
    automationId: v.id('automations'),
    userId: v.string(),
    workspaceId: v.optional(v.string()),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    instructions: v.optional(v.string()),
    enabled: v.optional(v.boolean()),
    schedule: v.optional(automationSchedule),
    timezone: v.optional(v.string()),
    modelId: v.optional(v.string()),
    graphSource: v.optional(v.string()),
    graph: v.optional(v.any()),
    sourceConversationId: v.optional(v.id('conversations')),
    concurrencyPolicy: v.optional(v.union(v.literal('skip'), v.literal('queue'))),
    /** Refuse the update when the automation changed since the editor loaded this version. */
    expectedUpdatedAt: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, { automationId, userId, workspaceId, accessToken, serverSecret, expectedUpdatedAt, ...updates }) => {
    await authorizeUserAccess({ userId, accessToken, serverSecret })
    const automation = await ctx.db.get(automationId)
    if (!automation || automation.deletedAt || (workspaceId !== undefined && automation.workspaceId !== workspaceId) || !(await scopeContextLoader(ctx, userId).canEdit(automation))) {
      throw new Error('Unauthorized')
    }
    if (expectedUpdatedAt !== undefined && automation.updatedAt !== expectedUpdatedAt) throw new Error('AUTOMATION_CONFLICT')
    if (updates.sourceConversationId) {
      const conversation = await ctx.db.get(updates.sourceConversationId)
      if (!conversation || conversation.userId !== userId || conversation.deletedAt) {
        throw new Error('Unauthorized')
      }
    }

    const now = Date.now()
    const patch: Partial<Doc<'automations'>> = { updatedAt: now }
    const nextEnabled = (updates.enabled ?? automation.enabled) !== false
    const nextSchedule = updates.schedule ?? automation.schedule ?? DEFAULT_SCHEDULE
    if (updates.schedule !== undefined || nextEnabled) {
      await enforceAutomationPolicy(ctx, {
        userId,
        workspaceId: automation.workspaceId,
        enabled: nextEnabled,
        schedule: nextSchedule,
        automationId,
      })
    }
    if (updates.name !== undefined) patch.name = updates.name.trim() || automation.name
    if (updates.description !== undefined) patch.description = updates.description.trim()
    if (updates.instructions !== undefined) patch.instructions = updates.instructions.trim()
    if (updates.timezone !== undefined) patch.timezone = updates.timezone.trim() || 'UTC'
    if (updates.modelId !== undefined) patch.modelId = updates.modelId.trim() || undefined
    if (updates.graphSource !== undefined) patch.graphSource = updates.graphSource.trim() || undefined
    if (updates.graph !== undefined) patch.graph = updates.graph ?? undefined
    if (updates.sourceConversationId !== undefined) patch.sourceConversationId = updates.sourceConversationId
    if (updates.concurrencyPolicy !== undefined) patch.concurrencyPolicy = updates.concurrencyPolicy
    const timezone = patch.timezone ?? automation.timezone
    if (updates.schedule !== undefined || updates.timezone !== undefined) {
      const schedule = withUtcFields(updates.schedule ?? automation.schedule ?? DEFAULT_SCHEDULE, timezone, now)
      patch.schedule = schedule
      patch.nextRunAt = nextEnabled ? computeNextRunAt(schedule, now, timezone) : undefined
    }
    if (updates.enabled !== undefined) {
      patch.enabled = updates.enabled
      if (!updates.enabled) {
        patch.nextRunAt = undefined
      } else if (patch.nextRunAt === undefined) {
        patch.nextRunAt = computeNextRunAt(patch.schedule ?? automation.schedule ?? DEFAULT_SCHEDULE, now, timezone)
      }
    }
    await ctx.db.patch(automationId, patch)
    return null
  },
})

export const pause = mutation({
  args: {
    automationId: v.id('automations'),
    userId: v.string(),
    workspaceId: v.optional(v.string()),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await authorizeUserAccess(args)
    const automation = await ctx.db.get(args.automationId)
    if (!automation || automation.deletedAt || (args.workspaceId !== undefined && automation.workspaceId !== args.workspaceId) || !(await scopeContextLoader(ctx, args.userId).canEdit(automation))) {
      throw new Error('Unauthorized')
    }
    await ctx.db.patch(args.automationId, {
      enabled: false,
      nextRunAt: undefined,
      updatedAt: Date.now(),
    })
    return null
  },
})

export const resume = mutation({
  args: {
    automationId: v.id('automations'),
    userId: v.string(),
    workspaceId: v.optional(v.string()),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await authorizeUserAccess(args)
    const automation = await ctx.db.get(args.automationId)
    if (!automation || automation.deletedAt || (args.workspaceId !== undefined && automation.workspaceId !== args.workspaceId) || !(await scopeContextLoader(ctx, args.userId).canEdit(automation))) {
      throw new Error('Unauthorized')
    }
    const now = Date.now()
    await enforceAutomationPolicy(ctx, {
      userId: args.userId,
      workspaceId: automation.workspaceId,
      enabled: true,
      schedule: automation.schedule ?? DEFAULT_SCHEDULE,
      automationId: args.automationId,
    })
    await ctx.db.patch(args.automationId, {
      enabled: true,
      nextRunAt: computeNextRunAt(automation.schedule ?? DEFAULT_SCHEDULE, now, automation.timezone),
      updatedAt: now,
    })
    return null
  },
})

export const remove = mutation({
  args: {
    automationId: v.id('automations'),
    userId: v.string(),
    workspaceId: v.optional(v.string()),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await authorizeUserAccess(args)
    const automation = await ctx.db.get(args.automationId)
    if (!automation || automation.deletedAt || (args.workspaceId !== undefined && automation.workspaceId !== args.workspaceId) || !(await scopeContextLoader(ctx, args.userId).canEdit(automation))) {
      throw new Error('Unauthorized')
    }
    await ctx.db.patch(args.automationId, {
      enabled: false,
      nextRunAt: undefined,
      deletedAt: Date.now(),
      updatedAt: Date.now(),
    })
    return null
  },
})

export const listRuns = query({
  args: {
    automationId: v.id('automations'),
    userId: v.string(),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
  },
  returns: v.array(automationRunDoc),
  handler: async (ctx, args) => {
    try {
      await authorizeUserAccess(args)
    } catch {
      return []
    }
    const automation = await ctx.db.get(args.automationId)
    if (!automation || automation.userId !== args.userId || automation.deletedAt) return []
    return await ctx.db
      .query('automationRuns')
      .withIndex('by_automationId_createdAt', (q) => q.eq('automationId', args.automationId))
      .order('desc')
      .take(50)
  },
})

export const requestRunCancellationByServer = mutation({
  args: {
    runId: v.id('automationRuns'),
    serverSecret: v.string(),
    userId: v.string(),
  },
  returns: v.object({ cancelled: v.boolean() }),
  handler: async (ctx, args) => {
    if (!validateServerSecret(args.serverSecret)) throw new Error('Unauthorized')
    const run = await ctx.db.get(args.runId)
    if (!run || run.userId !== args.userId || !['queued', 'running'].includes(run.status)) {
      return { cancelled: false }
    }
    const now = Date.now()
    await ctx.db.patch(args.runId, {
      completedAt: run.status === 'queued' ? now : undefined,
      status: run.status === 'queued' ? 'cancelled' : 'cancel_requested',
      updatedAt: now,
    })
    return { cancelled: true }
  },
})

export const retryRunByServer = mutation({
  args: {
    runId: v.id('automationRuns'),
    serverSecret: v.string(),
    userId: v.string(),
  },
  returns: v.object({ runId: v.union(v.id('automationRuns'), v.null()) }),
  handler: async (ctx, args) => {
    if (!validateServerSecret(args.serverSecret)) throw new Error('Unauthorized')
    const source = await ctx.db.get(args.runId)
    if (!source || source.userId !== args.userId || !['failed', 'cancelled'].includes(source.status)) {
      return { runId: null }
    }
    const now = Date.now()
    const runId = await ctx.db.insert('automationRuns', {
      automationId: source.automationId,
      createdAt: now,
      retryOfRunId: source._id,
      scheduledFor: now,
      status: 'queued',
      triggerSource: 'retry',
      updatedAt: now,
      userId: args.userId,
    })
    await ctx.scheduler.runAfter(0, internal.automations.automationRunner.runAutomation, { runId })
    return { runId }
  },
})

export const createManualRun = mutation({
  args: {
    automationId: v.id('automations'),
    userId: v.string(),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    scheduledFor: v.number(),
  },
  returns: v.id('automationRuns'),
  handler: async (ctx, args) => {
    await authorizeUserAccess(args)
    const automation = await ctx.db.get(args.automationId)
    if (!automation || automation.userId !== args.userId || automation.deletedAt) {
      throw new Error('Unauthorized')
    }
    const now = Date.now()
    return await ctx.db.insert('automationRuns', {
      automationId: args.automationId,
      userId: args.userId,
      status: 'queued',
      scheduledFor: args.scheduledFor,
      triggerSource: 'manual',
      createdAt: now,
      updatedAt: now,
    })
  },
})

export const markManualRunStarted = mutation({
  args: {
    runId: v.id('automationRuns'),
    userId: v.string(),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    conversationId: v.optional(v.id('conversations')),
    turnId: v.string(),
    now: v.number(),
    expectedWorkflowRunId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await authorizeUserAccess(args)
    if (args.turnId !== automationRunTurnId(args.runId)) {
      throw new Error('Automation run turn ID must be derived from its run')
    }
    const run = await ctx.db.get(args.runId)
    if (!run || run.userId !== args.userId) return null
    if (args.expectedWorkflowRunId !== undefined && run.workflowRunId !== args.expectedWorkflowRunId) {
      throw new Error('Automation workflow ownership changed')
    }
    if (run.status === 'running') {
      if (args.expectedWorkflowRunId !== undefined
        && ((run.turnId && run.turnId !== args.turnId)
          || (run.conversationId && run.conversationId !== args.conversationId))) {
        throw new Error('Automation run binding changed')
      }
      if (args.expectedWorkflowRunId !== undefined
        && (run.turnId !== args.turnId || run.conversationId !== args.conversationId)) {
        await ctx.db.patch(args.runId, {
          turnId: args.turnId,
          conversationId: args.conversationId ?? run.conversationId,
          updatedAt: args.now,
        })
      }
      return null
    }
    if (run.status !== 'queued') throw new Error('Automation run is not startable')
    await ctx.db.patch(args.runId, {
      status: 'running',
      startedAt: args.now,
      conversationId: args.conversationId,
      turnId: args.turnId,
      updatedAt: args.now,
    })
    return null
  },
})

export const markManualRunCompleted = mutation({
  args: {
    runId: v.id('automationRuns'),
    userId: v.string(),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    conversationId: v.optional(v.id('conversations')),
    expectedWorkflowRunId: v.optional(v.string()),
    expectedTurnId: v.optional(v.string()),
    now: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await authorizeUserAccess(args)
    const run = await ctx.db.get(args.runId)
    if (!run || run.userId !== args.userId) return null
    if ((args.expectedWorkflowRunId !== undefined && run.workflowRunId !== args.expectedWorkflowRunId)
      || (args.expectedTurnId !== undefined && run.turnId !== args.expectedTurnId)
      || run.status !== 'running') return null
    await ctx.db.patch(args.runId, {
      status: 'completed',
      completedAt: args.now,
      conversationId: args.conversationId ?? run.conversationId,
      updatedAt: args.now,
    })
    await ctx.db.patch(run.automationId, {
      ...(args.conversationId ? { conversationId: args.conversationId } : {}),
      lastRunAt: args.now,
      lastError: undefined,
      updatedAt: args.now,
    })
    await enqueueTerminalWebhook(ctx, run, { type: 'automation.finished', conversationId: args.conversationId }, args.now)
    return null
  },
})

export const markManualRunFailed = mutation({
  args: {
    runId: v.id('automationRuns'),
    userId: v.string(),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    error: v.string(),
    expectedWorkflowRunId: v.optional(v.string()),
    expectedTurnId: v.optional(v.string()),
    status: v.optional(v.union(v.literal('failed'), v.literal('cancelled'), v.literal('skipped'))),
    now: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await authorizeUserAccess(args)
    const run = await ctx.db.get(args.runId)
    if (!run || run.userId !== args.userId) return null
    if ((args.expectedWorkflowRunId !== undefined && run.workflowRunId !== args.expectedWorkflowRunId)
      || (args.expectedTurnId !== undefined && run.turnId !== args.expectedTurnId)
      || !['queued', 'running'].includes(run.status)) return null
    await ctx.db.patch(args.runId, {
      status: args.status ?? 'failed',
      completedAt: args.now,
      error: args.error,
      updatedAt: args.now,
    })
    await ctx.db.patch(run.automationId, {
      lastRunAt: args.now,
      lastError: args.error,
      updatedAt: args.now,
    })
    await enqueueTerminalWebhook(ctx, run, { type: 'automation.failed', error: args.error }, args.now)
    return null
  },
})

export const settleManualRunByServer = mutation({
  args: {
    runId: v.id('automationRuns'),
    userId: v.string(),
    serverSecret: v.string(),
    expectedWorkflowRunId: v.string(),
    expectedStatus: v.union(
      v.literal('queued'), v.literal('running'), v.literal('completed'), v.literal('succeeded'),
      v.literal('failed'), v.literal('cancel_requested'), v.literal('cancelled'), v.literal('skipped'),
      v.literal('dead_letter'),
    ),
    expectedTurnId: v.optional(v.string()),
    status: v.union(v.literal('completed'), v.literal('failed'), v.literal('cancelled'), v.literal('skipped')),
    conversationId: v.optional(v.id('conversations')),
    error: v.optional(v.string()),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    if (!validateServerSecret(args.serverSecret)) throw new Error('Unauthorized')
    const run = await ctx.db.get(args.runId)
    if (!run || run.userId !== args.userId
      || run.workflowRunId !== args.expectedWorkflowRunId
      || run.turnId !== args.expectedTurnId) return false
    if (run.status === args.status) return true
    if (run.status !== args.expectedStatus) return false
    if (!['queued', 'running'].includes(run.status)) return false
    if (args.status === 'completed' && run.status !== 'running') return false
    const now = Date.now()
    await ctx.db.patch(args.runId, {
      status: args.status,
      completedAt: now,
      ...(args.conversationId ? { conversationId: args.conversationId } : {}),
      ...(args.error ? { error: args.error } : {}),
      updatedAt: now,
    })
    await ctx.db.patch(run.automationId, {
      ...(args.conversationId ? { conversationId: args.conversationId } : {}),
      lastRunAt: now,
      lastRunStatus: args.status,
      lastError: args.status === 'completed' ? undefined : args.error,
      updatedAt: now,
    })
    if (args.status === 'completed') {
      await enqueueTerminalWebhook(ctx, run, { type: 'automation.finished', conversationId: args.conversationId }, now)
    } else if (args.status === 'failed') {
      await enqueueTerminalWebhook(ctx, run, { type: 'automation.failed', error: args.error ?? 'Automation failed' }, now)
    }
    return true
  },
})

export const attachConversationByServer = mutation({
  args: {
    automationId: v.id('automations'),
    conversationId: v.id('conversations'),
    serverSecret: v.string(),
    userId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!validateServerSecret(args.serverSecret))
      throw new Error('Unauthorized')
    const [automation, conversation] = await Promise.all([
      ctx.db.get(args.automationId),
      ctx.db.get(args.conversationId),
    ])
    if (
      !automation ||
      automation.userId !== args.userId ||
      automation.deletedAt ||
      !conversation ||
      conversation.userId !== args.userId ||
      conversation.deletedAt
    ) {
      throw new Error('Unauthorized')
    }
    if (automation.workspaceId && conversation.workspaceId !== automation.workspaceId) {
      throw new Error('Unauthorized')
    }
    // The conversation a user chats in on the automation surface IS the
    // automation's own thread: it is owned by the automation, hidden from
    // Chats via isAutomation, and becomes the run target.
    const currentOwned = automation.conversationId
      ? await ctx.db.get(automation.conversationId)
      : null
    const currentOwnedIsValid = Boolean(
      currentOwned
      && currentOwned.userId === args.userId
      && !currentOwned.deletedAt
      && currentOwned._id !== automation.sourceConversationId
      && (!automation.workspaceId || currentOwned.workspaceId === automation.workspaceId),
    )
    if (!currentOwnedIsValid) {
      await ctx.db.patch(args.automationId, {
        conversationId: args.conversationId,
        // An automation adopting an agent thread as its owned thread belongs
        // to that agent even when it was drafted without sourceConversationId.
        agentId: automation.agentId ?? conversation.agentId,
        updatedAt: Date.now(),
      })
      if (!conversation.isAutomation) {
        await ctx.db.patch(args.conversationId, { isAutomation: true })
      }
    }
    return null
  },
})

// ---------------------------------------------------------------------------
// Thread binding. An automation is a schedule attached to exactly one thread:
// an agent thread when it belongs to an agent, otherwise an ordinary chat.
// Each run appends its instructions to that thread as a user message.
// ---------------------------------------------------------------------------

type ThreadKind = 'agent' | 'chat'

function isBoundThread(automation: Doc<'automations'>, conversation: Doc<'conversations'> | null): conversation is Doc<'conversations'> {
  if (!conversation || conversation.deletedAt !== undefined || conversation.userId !== automation.userId
    || conversation.workspaceId !== automation.workspaceId
    || conversation._id === automation.sourceConversationId) return false
  if (automation.agentId) {
    return conversation.agentId === automation.agentId && conversation.conversationType === 'dm'
  }
  return (conversation.conversationType ?? 'personal') === 'personal' && !conversation.agentId
    && !conversation.externalPlatform && !conversation.surfaceBindingId
}

async function insertAutomationChat(ctx: MutationCtx, automation: Doc<'automations'>, title: string) {
  const principal = await ctx.db.query('workspacePrincipals')
    .withIndex('by_workspaceId_userId', q => q.eq('workspaceId', automation.workspaceId!).eq('userId', automation.userId))
    .unique()
  if (!principal || principal.type !== 'human' || principal.archivedAt) throw new Error('WORKSPACE_ACCESS_DENIED')
  const now = Date.now()
  const modelId = automation.modelId || DEFAULT_MODEL_ID
  const conversationId = await ctx.db.insert('conversations', {
    workspaceId: automation.workspaceId, userId: automation.userId, clientId: `automation:${automation._id}`,
    title, askModelIds: [modelId], actModelId: modelId, lastMode: 'act',
    conversationType: 'personal', scope: automation.scope === 'workspace' ? 'workspace' : 'personal',
    createdByPrincipalId: principal.principalId, createdAt: now, updatedAt: now, lastModified: now,
  })
  await recordConversationEvent(ctx, { conversationId, workspaceId: automation.workspaceId,
    userId: automation.userId, type: 'conversation.created' })
  return conversationId
}

/** Returns the automation's thread, creating it when the automation has none that fits. */
async function bindAutomationThread(ctx: MutationCtx, automation: Doc<'automations'>): Promise<{
  conversationId: Id<'conversations'>
  kind: ThreadKind
  workspaceId: string
}> {
  if (!automation.workspaceId) throw new Error('AUTOMATION_WORKSPACE_REQUIRED')
  const workspaceId = automation.workspaceId
  const kind: ThreadKind = automation.agentId ? 'agent' : 'chat'
  const current = automation.conversationId ? await ctx.db.get(automation.conversationId) : null
  if (isBoundThread(automation, current)) {
    // Threads owned by the retired automation runner were hidden from the
    // sidebar. A bound thread is an ordinary thread, so it is listed.
    if (current.isAutomation) await ctx.db.patch(current._id, { isAutomation: undefined })
    return { conversationId: current._id, kind, workspaceId }
  }
  const title = (automation.name || automation.title || 'Automation').slice(0, 120)
  const conversationId = automation.agentId
    ? (await createAgentThread(ctx, { workspaceId, agentId: automation.agentId, userId: automation.userId, title })).conversationId
    : await insertAutomationChat(ctx, automation, title)
  await ctx.db.patch(automation._id, { conversationId, updatedAt: Date.now() })
  return { conversationId, kind, workspaceId }
}

export const bindThreadByServer = mutation({
  args: {
    automationId: v.id('automations'),
    userId: v.string(),
    serverSecret: v.string(),
  },
  returns: v.object({
    conversationId: v.id('conversations'),
    kind: v.union(v.literal('agent'), v.literal('chat')),
    workspaceId: v.string(),
  }),
  handler: async (ctx, args) => {
    if (!validateServerSecret(args.serverSecret)) throw new Error('Unauthorized')
    const automation = await ctx.db.get(args.automationId)
    if (!automation || automation.userId !== args.userId || automation.deletedAt) throw new Error('Unauthorized')
    return await bindAutomationThread(ctx, automation)
  },
})

export const linkRunMessageByServer = mutation({
  args: {
    runId: v.id('automationRuns'),
    userId: v.string(),
    serverSecret: v.string(),
    expectedWorkflowRunId: v.string(),
    messageId: v.id('conversationMessages'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!validateServerSecret(args.serverSecret)) throw new Error('Unauthorized')
    const run = await ctx.db.get(args.runId)
    if (!run || run.userId !== args.userId || run.workflowRunId !== args.expectedWorkflowRunId
      || run.status !== 'running') throw new Error('Automation run ownership changed')
    const message = await ctx.db.get(args.messageId)
    if (!message || message.conversationId !== run.conversationId || message.role !== 'user') {
      throw new Error('Automation run message does not belong to its thread')
    }
    if (run.messageId === args.messageId) return null
    if (run.messageId) throw new Error('Automation run message already linked')
    await ctx.db.patch(args.runId, { messageId: args.messageId, updatedAt: Date.now() })
    return null
  },
})

// A run whose message never produced a turn (the start failed before the
// thread recorded one) settles as failed after this long.
const THREAD_RUN_START_TIMEOUT_MS = 15 * 60_000
const TERMINAL_THREAD_RUN_STATUSES = new Set(['completed', 'failed', 'cancelled'])

type ThreadRunOutcome =
  | { status: 'pending' }
  | { status: 'completed' | 'failed' | 'cancelled'; error?: string }

async function threadRunOutcome(ctx: QueryCtx, run: Doc<'automationRuns'>, now: number): Promise<ThreadRunOutcome> {
  const startedAt = run.startedAt ?? run.createdAt
  if (!run.messageId || !run.conversationId) {
    return now - startedAt > THREAD_RUN_START_TIMEOUT_MS
      ? { status: 'failed', error: 'The automation message was not delivered to its thread.' }
      : { status: 'pending' }
  }
  const agentRun = await threadAgentRunFor(ctx, run)
  if (!agentRun) {
    return now - startedAt > THREAD_RUN_START_TIMEOUT_MS
      ? { status: 'failed', error: 'The thread did not start a turn for the automation message.' }
      : { status: 'pending' }
  }
  if (!TERMINAL_THREAD_RUN_STATUSES.has(agentRun.status)) return { status: 'pending' }
  return {
    status: agentRun.status as 'completed' | 'failed' | 'cancelled',
    ...(agentRun.terminalError?.message ? { error: agentRun.terminalError.message } : {}),
  }
}

export const getThreadRunOutcomeByServer = query({
  args: { runId: v.id('automationRuns'), serverSecret: v.string() },
  returns: v.union(
    v.object({ status: v.literal('pending') }),
    v.object({
      status: v.union(v.literal('completed'), v.literal('failed'), v.literal('cancelled')),
      error: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    if (!validateServerSecret(args.serverSecret)) throw new Error('Unauthorized')
    const run = await ctx.db.get(args.runId)
    if (!run || run.status !== 'running') return { status: 'pending' as const }
    return await threadRunOutcome(ctx, run, Date.now())
  },
})

/** Thread runs whose turn has ended and whose ledger row still says running. */
export const listSettleableThreadRuns = internalQuery({
  args: { now: v.number(), limit: v.optional(v.number()) },
  returns: v.array(v.object({ runId: v.id('automationRuns'), userId: v.string() })),
  handler: async (ctx, args) => {
    const running = await ctx.db.query('automationRuns')
      .withIndex('by_status_scheduledFor', q => q.eq('status', 'running'))
      .take(clampInteger(args.limit ?? 100, 1, 200, 100))
    const settleable: Array<{ runId: Id<'automationRuns'>; userId: string }> = []
    for (const run of running) {
      if (!run.workflowRunId?.startsWith(AUTOMATION_THREAD_RUN_OWNER_PREFIX)) continue
      const outcome = await threadRunOutcome(ctx, run, args.now)
      if (outcome.status !== 'pending') settleable.push({ runId: run._id, userId: run.userId })
    }
    return settleable
  },
})

export const updateRunWorkflowRunIdByServer = mutation({
  args: {
    runId: v.id('automationRuns'),
    serverSecret: v.string(),
    workflowRunId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!validateServerSecret(args.serverSecret)) throw new Error('Unauthorized')
    const run = await ctx.db.get(args.runId)
    if (!run) return null
    if (run.workflowRunId && run.workflowRunId !== args.workflowRunId) {
      throw new Error('Automation run is already owned by another workflow')
    }
    if (!['queued', 'running'].includes(run.status)) {
      throw new Error('Automation run is no longer startable')
    }
    await ctx.db.patch(args.runId, {
      workflowRunId: args.workflowRunId,
      updatedAt: Date.now(),
    })
    return null
  },
})

async function hasQueuedOrRunningRun(ctx: MutationCtx, automationId: Id<'automations'>, now: number) {
  const queued = await ctx.db
    .query('automationRuns')
    .withIndex('by_automationId_status', (q) => q.eq('automationId', automationId).eq('status', 'queued'))
    .first()
  if (queued) {
    const queuedAt = queued.createdAt ?? queued.updatedAt ?? queued.scheduledFor
    if (now - queuedAt <= UNSTARTED_AUTOMATION_RUN_EXPIRY_MS) return true
    await ctx.db.patch(queued._id, {
      status: 'failed',
      completedAt: now,
      error: 'Automation run expired before execution could start.',
      updatedAt: now,
    })
  }
  // A run whose turn waits for the owner's answer or approval does not hold the schedule.
  const running = await ctx.db
    .query('automationRuns')
    .withIndex('by_automationId_status', (q) => q.eq('automationId', automationId).eq('status', 'running'))
    .take(20)
  for (const run of running) {
    if (!await isWaitingForOwner(ctx, run)) return true
  }
  return false
}

export const claimDueRuns = internalMutation({
  args: {
    now: v.number(),
    limit: v.optional(v.number()),
  },
  returns: v.array(v.id('automationRuns')),
  handler: async (ctx, args) => {
    const limit = clampInteger(args.limit ?? 25, 1, 100, 25)
    // Over-fetch candidates so the per-user round-robin has multiple users
    // to draw from after applying MAX_RUNS_PER_USER_PER_TICK. Without this,
    // a single user with many due automations could fill the entire batch
    // and starve every other user for that tick.
    const candidateLimit = Math.min(CLAIM_CANDIDATE_BATCH_SIZE, limit * 4)
    const due = await ctx.db
      .query('automations')
      .withIndex('by_enabled_nextRunAt', (q) => q.eq('enabled', true).lte('nextRunAt', args.now))
      .take(candidateLimit)

    // Round-robin across users so no single user monopolizes the batch.
    // Automations due earlier (lower nextRunAt) are prioritized within each
    // user, but the cross-user selection is fair.
    const perUserQueues = new Map<string, Doc<'automations'>[]>()
    for (const automation of due) {
      if (automation.deletedAt || automation.nextRunAt === undefined) continue
      const queue = perUserQueues.get(automation.userId)
      if (queue) queue.push(automation)
      else perUserQueues.set(automation.userId, [automation])
    }

    const sortedUsers = [...perUserQueues.entries()].sort(
      ([aUserId, aQueue], [bUserId, bQueue]) => {
        const aEarliest = aQueue[0]!.nextRunAt!
        const bEarliest = bQueue[0]!.nextRunAt!
        if (aEarliest !== bEarliest) return aEarliest - bEarliest
        return aUserId.localeCompare(bUserId)
      },
    )

    const runIds: Array<Id<'automationRuns'>> = []
    const claimedPerUser = new Map<string, number>()
    let exhausted = false

    while (runIds.length < limit && !exhausted) {
      exhausted = true
      for (const [userId, queue] of sortedUsers) {
        if (runIds.length >= limit) break
        const claimed = claimedPerUser.get(userId) ?? 0
        if (claimed >= MAX_RUNS_PER_USER_PER_TICK) continue
        if (queue.length === 0) continue

        const automation = queue.shift()!
        const scheduledFor = automation.nextRunAt!
        const now = Date.now()
        const policyViolation = await getAutomationRunPolicyViolation(ctx, automation)
        if (policyViolation) {
          await ctx.db.patch(automation._id, {
            enabled: false,
            nextRunAt: undefined,
            lastError: policyViolation,
            updatedAt: now,
          })
          continue
        }
        const nextRunAt = computeNextRunAt(automation.schedule ?? DEFAULT_SCHEDULE, Math.max(args.now, scheduledFor), automation.timezone)

        if (
          (automation.concurrencyPolicy ?? 'skip') === 'skip' &&
          (await hasQueuedOrRunningRun(ctx, automation._id, now))
        ) {
          await ctx.db.insert('automationRuns', {
            automationId: automation._id,
            userId: automation.userId,
            status: 'skipped',
            scheduledFor,
            error: 'Skipped because a previous run is still queued or running.',
            completedAt: now,
            createdAt: now,
            updatedAt: now,
          })
          await ctx.db.patch(automation._id, {
            nextRunAt,
            lastError: 'Skipped because a previous run is still queued or running.',
            updatedAt: now,
          })
          continue
        }

        const runId = await ctx.db.insert('automationRuns', {
          automationId: automation._id,
          userId: automation.userId,
          status: 'queued',
          scheduledFor,
          createdAt: now,
          updatedAt: now,
        })
        await ctx.db.patch(automation._id, {
          nextRunAt,
          updatedAt: now,
        })
        runIds.push(runId)
        claimedPerUser.set(userId, claimed + 1)
        exhausted = false
      }
    }
    return runIds
  },
})

export const getRunForExecution = internalQuery({
  args: { runId: v.id('automationRuns') },
  returns: v.union(
    v.object({
      run: automationRunDoc,
      automation: automationDoc,
      agentArchived: v.boolean(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId)
    if (!run) return null
    const automation = await ctx.db.get(run.automationId)
    if (!automation || automation.deletedAt) return null
    // Agent-owned automations stop running while their agent is archived.
    const agent = automation.agentId
      ? await ctx.db
          .query('workspaceAgentDefinitions')
        .withIndex('by_agentId', (q) => q.eq('agentId', automation.agentId!))
        .unique()
      : null
    const agentArchived = Boolean(automation.agentId && (!agent || agent.archivedAt))
    return { run, automation, agentArchived }
  },
})

export const getRunForExecutionByServer = query({
  args: {
    runId: v.id('automationRuns'),
    serverSecret: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    if (!validateServerSecret(args.serverSecret)) throw new Error('Unauthorized')
    const run = await ctx.db.get(args.runId)
    if (!run) return null
    const automation = await ctx.db.get(run.automationId)
    if (!automation || automation.deletedAt) return null
    const agent = automation.agentId
      ? await ctx.db
          .query('workspaceAgentDefinitions')
        .withIndex('by_agentId', (q) => q.eq('agentId', automation.agentId!))
        .unique()
      : null
    const agentArchived = Boolean(automation.agentId && (!agent || agent.archivedAt))
    return { run, automation, agentArchived }
  },
})

// The scheduler only claims the run. The run workflow binds the thread and
// stamps the turn ID (automationRunTurnId) when it starts, as for manual runs.
export const markRunStarted = internalMutation({
  args: {
    runId: v.id('automationRuns'),
    now: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId)
    if (!run || run.status !== 'queued') return null
    await ctx.db.patch(args.runId, {
      status: 'running',
      startedAt: args.now,
      updatedAt: args.now,
    })
    return null
  },
})

export const markRunCompleted = internalMutation({
  args: {
    runId: v.id('automationRuns'),
    conversationId: v.optional(v.id('conversations')),
    now: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId)
    if (!run) return null
    await ctx.db.patch(args.runId, {
      status: 'completed',
      completedAt: args.now,
      conversationId: args.conversationId ?? run.conversationId,
      updatedAt: args.now,
    })
    await ctx.db.patch(run.automationId, {
      ...(args.conversationId ? { conversationId: args.conversationId } : {}),
      lastRunAt: args.now,
      lastError: undefined,
      updatedAt: args.now,
    })
    await enqueueTerminalWebhook(ctx, run, { type: 'automation.finished', conversationId: args.conversationId }, args.now)
    return null
  },
})

export const markRunSkipped = internalMutation({
  args: {
    runId: v.id('automationRuns'),
    now: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId)
    if (!run || run.status !== 'queued') return null
    await ctx.db.patch(args.runId, {
      status: 'skipped',
      completedAt: args.now,
      updatedAt: args.now,
    })
    return null
  },
})

export const markRunFailed = internalMutation({
  args: {
    runId: v.id('automationRuns'),
    error: v.string(),
    now: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId)
    if (!run) return null
    await ctx.db.patch(args.runId, {
      status: 'failed',
      completedAt: args.now,
      error: args.error,
      updatedAt: args.now,
    })
    await ctx.db.patch(run.automationId, {
      lastRunAt: args.now,
      lastError: args.error,
      updatedAt: args.now,
    })
    await enqueueTerminalWebhook(ctx, run, { type: 'automation.failed', error: args.error }, args.now)
    return null
  },
})
