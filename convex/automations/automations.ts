import { v } from 'convex/values'
import { internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from '../_generated/server'
import { requireAccessToken, validateServerSecret } from '../lib/auth'
import type { Doc, Id } from '../_generated/dataModel'
import { internal } from '../_generated/api'
import { derivePlanKind } from '../../src/shared/billing/billing-pricing'

const automationSchedule = v.object({
  kind: v.union(
    v.literal('interval'),
    v.literal('daily'),
    v.literal('weekly'),
    v.literal('monthly'),
  ),
  intervalMinutes: v.optional(v.number()),
  minuteUTC: v.optional(v.number()),
  hourUTC: v.optional(v.number()),
  dayOfWeekUTC: v.optional(v.number()),
  dayOfMonthUTC: v.optional(v.number()),
})

const automationDoc = v.any()
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

const DEFAULT_SCHEDULE: AutomationSchedule = { kind: 'daily', hourUTC: 14, minuteUTC: 0 }
const MIN_INTERVAL_MINUTES = 15
const MAX_ENABLED_AUTOMATIONS = 25
const STALE_AUTOMATION_RUN_MS = 15 * 60_000
const AUTOMATION_POLICY_ERRORS = {
  intervalTooFrequent: 'automation_interval_too_frequent',
  paidPlanRequired: 'automation_paid_plan_required',
  enabledLimitReached: 'automation_enabled_limit_reached',
} as const

function normalizeSchedule(schedule: AutomationSchedule): AutomationSchedule {
  switch (schedule.kind) {
    case 'interval':
      return {
        kind: 'interval',
        intervalMinutes: clampInteger(schedule.intervalMinutes ?? 60, MIN_INTERVAL_MINUTES, 60 * 24 * 365, 60),
      }
    case 'daily':
      return {
        kind: 'daily',
        hourUTC: clampInteger(schedule.hourUTC ?? 9, 0, 23, 9),
        minuteUTC: clampInteger(schedule.minuteUTC ?? 0, 0, 59, 0),
      }
    case 'weekly':
      return {
        kind: 'weekly',
        dayOfWeekUTC: clampInteger(schedule.dayOfWeekUTC ?? 1, 0, 6, 1),
        hourUTC: clampInteger(schedule.hourUTC ?? 9, 0, 23, 9),
        minuteUTC: clampInteger(schedule.minuteUTC ?? 0, 0, 59, 0),
      }
    case 'monthly':
      return {
        kind: 'monthly',
        dayOfMonthUTC: clampInteger(schedule.dayOfMonthUTC ?? 1, 1, 31, 1),
        hourUTC: clampInteger(schedule.hourUTC ?? 9, 0, 23, 9),
        minuteUTC: clampInteger(schedule.minuteUTC ?? 0, 0, 59, 0),
      }
  }
}

function assertSchedulePolicy(schedule: AutomationSchedule): void {
  if (schedule.kind === 'interval' && (schedule.intervalMinutes ?? 60) < MIN_INTERVAL_MINUTES) {
    throw new Error(`${AUTOMATION_POLICY_ERRORS.intervalTooFrequent}:${MIN_INTERVAL_MINUTES}`)
  }
}

async function getUserPlanKind(ctx: AutomationPolicyCtx, userId: string) {
  const subscription = await ctx.db
    .query('subscriptions')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .first()
  return derivePlanKind(subscription ?? {})
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
  return rows.filter((row) => (
    !row.deletedAt &&
    row._id !== excludeAutomationId
  )).length
}

async function enforceAutomationPolicy(
  ctx: AutomationPolicyCtx,
  params: {
    userId: string
    enabled: boolean
    schedule: AutomationSchedule
    automationId?: Id<'automations'>
  },
): Promise<void> {
  assertSchedulePolicy(params.schedule)
  if (!params.enabled) return

  if (await getUserPlanKind(ctx, params.userId) !== 'paid') {
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
  if (await getUserPlanKind(ctx, automation.userId) !== 'paid') {
    return 'Automation paused because enabled automations require a paid plan.'
  }
  if (await countEnabledAutomations(ctx, automation.userId) > MAX_ENABLED_AUTOMATIONS) {
    return `Automation paused because the account exceeds the ${MAX_ENABLED_AUTOMATIONS} enabled automation limit.`
  }
  return null
}

function daysInUtcMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
}

export function computeNextRunAt(scheduleInput: AutomationSchedule, fromMs: number): number {
  const schedule = normalizeSchedule(scheduleInput)
  const from = new Date(fromMs)

  if (schedule.kind === 'interval') {
    return fromMs + (schedule.intervalMinutes ?? 60) * 60_000
  }

  if (schedule.kind === 'daily') {
    const candidate = Date.UTC(
      from.getUTCFullYear(),
      from.getUTCMonth(),
      from.getUTCDate(),
      schedule.hourUTC ?? 9,
      schedule.minuteUTC ?? 0,
      0,
      0,
    )
    return candidate > fromMs ? candidate : candidate + 24 * 60 * 60_000
  }

  if (schedule.kind === 'weekly') {
    const today = from.getUTCDay()
    const target = schedule.dayOfWeekUTC ?? 1
    let dayOffset = (target - today + 7) % 7
    let candidate = Date.UTC(
      from.getUTCFullYear(),
      from.getUTCMonth(),
      from.getUTCDate() + dayOffset,
      schedule.hourUTC ?? 9,
      schedule.minuteUTC ?? 0,
      0,
      0,
    )
    if (candidate <= fromMs) {
      dayOffset += 7
      candidate = Date.UTC(
        from.getUTCFullYear(),
        from.getUTCMonth(),
        from.getUTCDate() + dayOffset,
        schedule.hourUTC ?? 9,
        schedule.minuteUTC ?? 0,
        0,
        0,
      )
    }
    return candidate
  }

  const targetDay = schedule.dayOfMonthUTC ?? 1
  for (let monthOffset = 0; monthOffset < 24; monthOffset += 1) {
    const year = from.getUTCFullYear()
    const month = from.getUTCMonth() + monthOffset
    const day = Math.min(targetDay, daysInUtcMonth(year, month))
    const candidate = Date.UTC(
      year,
      month,
      day,
      schedule.hourUTC ?? 9,
      schedule.minuteUTC ?? 0,
      0,
      0,
    )
    if (candidate > fromMs) return candidate
  }

  return fromMs + 30 * 24 * 60 * 60_000
}

async function ensureProjectAccess(
  ctx: MutationCtx,
  userId: string,
  projectId?: string,
) {
  if (!projectId) return
  const project = await ctx.db.get(projectId as Id<'projects'>)
  if (!project || project.userId !== userId || project.deletedAt) {
    throw new Error('Unauthorized')
  }
}

export const list = query({
  args: {
    userId: v.string(),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    includeDeleted: v.optional(v.boolean()),
    projectId: v.optional(v.string()),
  },
  returns: v.array(automationDoc),
  handler: async (ctx, { userId, accessToken, serverSecret, includeDeleted, projectId }) => {
    try {
      await authorizeUserAccess({ userId, accessToken, serverSecret })
    } catch {
      return []
    }
    const rows = projectId
      ? await ctx.db
        .query('automations')
        .withIndex('by_projectId', (q) => q.eq('projectId', projectId))
        .order('desc')
        .take(200)
      : await ctx.db
        .query('automations')
        .withIndex('by_userId_updatedAt', (q) => q.eq('userId', userId))
        .order('desc')
        .take(200)
    return rows
      .filter((row) => row.userId === userId)
      .filter((row) => (includeDeleted ? true : !row.deletedAt))
  },
})

export const get = query({
  args: {
    automationId: v.id('automations'),
    userId: v.string(),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
  },
  returns: v.union(automationDoc, v.null()),
  handler: async (ctx, { automationId, userId, accessToken, serverSecret }) => {
    try {
      await authorizeUserAccess({ userId, accessToken, serverSecret })
    } catch {
      return null
    }
    const automation = await ctx.db.get(automationId)
    return automation && automation.userId === userId && !automation.deletedAt ? automation : null
  },
})

export const create = mutation({
  args: {
    userId: v.string(),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    name: v.string(),
    description: v.optional(v.string()),
    instructions: v.string(),
    enabled: v.optional(v.boolean()),
    schedule: automationSchedule,
    timezone: v.optional(v.string()),
    projectId: v.optional(v.string()),
    modelId: v.optional(v.string()),
    graphSource: v.optional(v.string()),
    graph: v.optional(v.any()),
    sourceConversationId: v.optional(v.id('conversations')),
    concurrencyPolicy: v.optional(v.union(v.literal('skip'), v.literal('queue'))),
  },
  returns: v.id('automations'),
  handler: async (ctx, args) => {
    await authorizeUserAccess(args)
    await ensureProjectAccess(ctx, args.userId, args.projectId)
    if (args.sourceConversationId) {
      const conversation = await ctx.db.get(args.sourceConversationId)
      if (!conversation || conversation.userId !== args.userId || conversation.deletedAt) {
        throw new Error('Unauthorized')
      }
    }
    const now = Date.now()
    const enabled = args.enabled ?? true
    await enforceAutomationPolicy(ctx, {
      userId: args.userId,
      enabled,
      schedule: args.schedule,
    })
    const schedule = normalizeSchedule(args.schedule)
    return await ctx.db.insert('automations', {
      userId: args.userId,
      name: args.name.trim() || 'Untitled automation',
      description: args.description?.trim() || '',
      instructions: args.instructions.trim(),
      enabled,
      schedule,
      timezone: args.timezone?.trim() || 'UTC',
      nextRunAt: enabled ? computeNextRunAt(schedule, now) : undefined,
      projectId: args.projectId,
      modelId: args.modelId?.trim() || undefined,
      graphSource: args.graphSource?.trim() || undefined,
      graph: args.graph ?? undefined,
      sourceConversationId: args.sourceConversationId,
      concurrencyPolicy: args.concurrencyPolicy ?? 'skip',
      createdAt: now,
      updatedAt: now,
    })
  },
})

export const update = mutation({
  args: {
    automationId: v.id('automations'),
    userId: v.string(),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    instructions: v.optional(v.string()),
    enabled: v.optional(v.boolean()),
    schedule: v.optional(automationSchedule),
    timezone: v.optional(v.string()),
    projectId: v.optional(v.string()),
    modelId: v.optional(v.string()),
    graphSource: v.optional(v.string()),
    graph: v.optional(v.any()),
    sourceConversationId: v.optional(v.id('conversations')),
    concurrencyPolicy: v.optional(v.union(v.literal('skip'), v.literal('queue'))),
  },
  returns: v.null(),
  handler: async (ctx, { automationId, userId, accessToken, serverSecret, ...updates }) => {
    await authorizeUserAccess({ userId, accessToken, serverSecret })
    const automation = await ctx.db.get(automationId)
    if (!automation || automation.userId !== userId || automation.deletedAt) {
      throw new Error('Unauthorized')
    }
    await ensureProjectAccess(ctx, userId, updates.projectId)
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
        enabled: nextEnabled,
        schedule: nextSchedule,
        automationId,
      })
    }
    if (updates.name !== undefined) patch.name = updates.name.trim() || automation.name
    if (updates.description !== undefined) patch.description = updates.description.trim()
    if (updates.instructions !== undefined) patch.instructions = updates.instructions.trim()
    if (updates.timezone !== undefined) patch.timezone = updates.timezone.trim() || 'UTC'
    if (updates.projectId !== undefined) patch.projectId = updates.projectId || undefined
    if (updates.modelId !== undefined) patch.modelId = updates.modelId.trim() || undefined
    if (updates.graphSource !== undefined) patch.graphSource = updates.graphSource.trim() || undefined
    if (updates.graph !== undefined) patch.graph = updates.graph ?? undefined
    if (updates.sourceConversationId !== undefined) patch.sourceConversationId = updates.sourceConversationId
    if (updates.concurrencyPolicy !== undefined) patch.concurrencyPolicy = updates.concurrencyPolicy
    if (updates.schedule !== undefined) {
      const schedule = normalizeSchedule(updates.schedule)
      patch.schedule = schedule
      patch.nextRunAt = nextEnabled ? computeNextRunAt(schedule, now) : undefined
    }
    if (updates.enabled !== undefined) {
      patch.enabled = updates.enabled
      if (!updates.enabled) {
        patch.nextRunAt = undefined
      } else if (patch.nextRunAt === undefined) {
        patch.nextRunAt = computeNextRunAt(patch.schedule ?? automation.schedule ?? DEFAULT_SCHEDULE, now)
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
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await authorizeUserAccess(args)
    const automation = await ctx.db.get(args.automationId)
    if (!automation || automation.userId !== args.userId || automation.deletedAt) {
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
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await authorizeUserAccess(args)
    const automation = await ctx.db.get(args.automationId)
    if (!automation || automation.userId !== args.userId || automation.deletedAt) {
      throw new Error('Unauthorized')
    }
    const now = Date.now()
    await enforceAutomationPolicy(ctx, {
      userId: args.userId,
      enabled: true,
      schedule: automation.schedule ?? DEFAULT_SCHEDULE,
      automationId: args.automationId,
    })
    await ctx.db.patch(args.automationId, {
      enabled: true,
      nextRunAt: computeNextRunAt(automation.schedule ?? DEFAULT_SCHEDULE, now),
      updatedAt: now,
    })
    return null
  },
})

export const remove = mutation({
  args: {
    automationId: v.id('automations'),
    userId: v.string(),
    accessToken: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await authorizeUserAccess(args)
    const automation = await ctx.db.get(args.automationId)
    if (!automation || automation.userId !== args.userId || automation.deletedAt) {
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

export const requestActiveRunCancellationByServer = mutation({
  args: {
    automationId: v.id('automations'),
    serverSecret: v.string(),
    userId: v.string(),
  },
  returns: v.object({ cancelled: v.number() }),
  handler: async (ctx, args) => {
    if (!validateServerSecret(args.serverSecret)) throw new Error('Unauthorized')
    const automation = await ctx.db.get(args.automationId)
    if (!automation || automation.userId !== args.userId || automation.deletedAt) {
      return { cancelled: 0 }
    }
    const runs = await ctx.db
      .query('automationRuns')
      .withIndex('by_automationId_createdAt', (q) => q.eq('automationId', args.automationId))
      .collect()
    const now = Date.now()
    const activeRuns = runs.filter((run) => ['queued', 'running'].includes(run.status))
    await Promise.all(activeRuns.map(async (run) => {
      await ctx.db.patch(run._id, {
        completedAt: run.status === 'queued' ? now : undefined,
        status: run.status === 'queued' ? 'cancelled' : 'cancel_requested',
        updatedAt: now,
      })
    }))
    return { cancelled: activeRuns.length }
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
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await authorizeUserAccess(args)
    const run = await ctx.db.get(args.runId)
    if (!run || run.userId !== args.userId || run.status !== 'queued') return null
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
    now: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await authorizeUserAccess(args)
    const run = await ctx.db.get(args.runId)
    if (!run || run.userId !== args.userId) return null
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
    now: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await authorizeUserAccess(args)
    const run = await ctx.db.get(args.runId)
    if (!run || run.userId !== args.userId) return null
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
    if (now - queuedAt <= STALE_AUTOMATION_RUN_MS) return true
    await ctx.db.patch(queued._id, {
      status: 'failed',
      completedAt: now,
      error: 'Automation run expired before execution could start.',
      updatedAt: now,
    })
  }
  const running = await ctx.db
    .query('automationRuns')
    .withIndex('by_automationId_status', (q) => q.eq('automationId', automationId).eq('status', 'running'))
    .first()
  if (!running) return false
  const startedAt = running.startedAt ?? running.updatedAt ?? running.createdAt
  if (now - startedAt <= STALE_AUTOMATION_RUN_MS) return true
  await ctx.db.patch(running._id, {
    status: 'failed',
    completedAt: now,
    error: 'Automation run timed out before completion.',
    updatedAt: now,
  })
  await ctx.db.patch(automationId, {
    lastError: 'Previous automation run timed out before completion.',
    updatedAt: now,
  })
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
    const due = await ctx.db
      .query('automations')
      .withIndex('by_enabled_nextRunAt', (q) => q.eq('enabled', true).lte('nextRunAt', args.now))
      .take(limit)

    const runIds: Array<Id<'automationRuns'>> = []
    for (const automation of due) {
      if (automation.deletedAt || automation.nextRunAt === undefined) continue
      const scheduledFor = automation.nextRunAt
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
      const nextRunAt = computeNextRunAt(automation.schedule ?? DEFAULT_SCHEDULE, Math.max(args.now, scheduledFor))

      if ((automation.concurrencyPolicy ?? 'skip') === 'skip' && await hasQueuedOrRunningRun(ctx, automation._id, now)) {
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
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId)
    if (!run) return null
    const automation = await ctx.db.get(run.automationId)
    if (!automation || automation.deletedAt) return null
    return { run, automation }
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
    return { run, automation }
  },
})

export const markRunStarted = internalMutation({
  args: {
    runId: v.id('automationRuns'),
    conversationId: v.optional(v.id('conversations')),
    turnId: v.string(),
    now: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId)
    if (!run || run.status !== 'queued') return null
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
    return null
  },
})
