import { v } from 'convex/values'
import { internal } from '../_generated/api'
import type { Doc } from '../_generated/dataModel'
import { internalMutation, type MutationCtx } from '../_generated/server'
import { growthCountFields } from '../lib/growthSchema'

/**
 * Nightly growth rollups (see internal/plans/GROWTH_ANALYTICS_PLAN.md).
 *
 * One UTC day is counted as a chain of small mutations: each reads one page of
 * one source table, adds to the running counts in `growthJobState`, and
 * schedules the next page. A page and its counts commit together, so a retry
 * never double-counts, and re-counting a day starts its counts from zero. Every
 * step gives the same answer whatever order days are counted in, so the
 * nightly run, a backfill and a repair can overlap in history safely.
 */

type Counts = { [Field in keyof typeof growthCountFields]: number }
type JobState = Doc<'growthJobState'>

const DAY_MS = 86_400_000
/** A run with no progress for this long is treated as stopped and restarted. */
const STALE_RUN_MS = 2 * 60 * 60 * 1_000
const TOP_WORKSPACES = 10
/**
 * Each night also re-counts this many earlier days, so outcomes that settle
 * after midnight (a top-up confirmed late, a run still going, a reservation
 * finalized later) are picked up.
 */
const RECOUNT_DAYS = 2

export function dayOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

export function addDays(day: string, days: number): string {
  return dayOf(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS)
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS)
}

/** The Monday (UTC) of the week containing `day`. */
export function weekStartOf(day: string): string {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay()
  return addDays(day, -((weekday + 6) % 7))
}

function zeroCounts(): Counts {
  return Object.fromEntries(Object.keys(growthCountFields).map((key) => [key, 0])) as Counts
}

function dayRange(day: string): { start: number; end: number } {
  const start = Date.parse(`${day}T00:00:00Z`)
  return { start, end: start + DAY_MS }
}

async function getState(ctx: MutationCtx): Promise<JobState | null> {
  return await ctx.db.query('growthJobState').withIndex('by_key', (q) => q.eq('key', 'daily')).unique()
}

// ─── Attribution ─────────────────────────────────────────────────────────

async function growthUser(ctx: MutationCtx, userId: string): Promise<Doc<'growthUsers'> | null> {
  return await ctx.db.query('growthUsers').withIndex('by_userId', (q) => q.eq('userId', userId)).unique()
}

async function bumpCohort(ctx: MutationCtx, signupDay: string, field: 'users' | 'w1Active' | 'w4Active') {
  const weekStart = weekStartOf(signupDay)
  const cohort = await ctx.db.query('growthCohortWeeks').withIndex('by_weekStart', (q) => q.eq('weekStart', weekStart)).unique()
  if (cohort) await ctx.db.patch(cohort._id, { [field]: cohort[field] + 1 })
  else {
    await ctx.db.insert('growthCohortWeeks', {
      weekStart,
      users: field === 'users' ? 1 : 0,
      w1Active: field === 'w1Active' ? 1 : 0,
      w4Active: field === 'w4Active' ? 1 : 0,
    })
  }
}

/** Whether the user did any work on a day between `fromDay` and `toDay`. */
async function activeBetween(ctx: MutationCtx, userId: string, fromDay: string, toDay: string): Promise<boolean> {
  const row = await ctx.db.query('growthUserDays')
    .withIndex('by_userId_day', (q) => q.eq('userId', userId).gte('day', fromDay).lte('day', toDay)).first()
  return row !== null
}

/** Credits W1 / W4 once each, whichever order the signup and the activity are counted in. */
async function creditRetention(ctx: MutationCtx, user: Doc<'growthUsers'>) {
  if (!user.signupDay) return
  const patch: Partial<Doc<'growthUsers'>> = {}
  if (!user.w1Active && await activeBetween(ctx, user.userId, addDays(user.signupDay, 7), addDays(user.signupDay, 13))) {
    patch.w1Active = true
    await bumpCohort(ctx, user.signupDay, 'w1Active')
  }
  if (!user.w4Active && await activeBetween(ctx, user.userId, addDays(user.signupDay, 28), addDays(user.signupDay, 34))) {
    patch.w4Active = true
    await bumpCohort(ctx, user.signupDay, 'w4Active')
  }
  if (Object.keys(patch).length > 0) await ctx.db.patch(user._id, patch)
}

async function recordSignup(ctx: MutationCtx, userId: string, day: string) {
  const existing = await growthUser(ctx, userId)
  if (existing?.signupDay) return
  if (existing) await ctx.db.patch(existing._id, { signupDay: day })
  else await ctx.db.insert('growthUsers', { userId, signupDay: day, w1Active: false, w4Active: false })
  await bumpCohort(ctx, day, 'users')
  const user = await growthUser(ctx, userId)
  if (user) await creditRetention(ctx, user)
}

/** Marks each person active on `day` and credits any retention window that day falls in. */
async function creditActive(ctx: MutationCtx, userIds: Iterable<string>, day: string) {
  for (const userId of new Set(userIds)) {
    const userDay = await ctx.db.query('growthUserDays')
      .withIndex('by_userId_day', (q) => q.eq('userId', userId).eq('day', day)).unique()
    if (userDay) continue
    await ctx.db.insert('growthUserDays', { userId, day })
    const user = await growthUser(ctx, userId)
    if (user) await creditRetention(ctx, user)
    else await ctx.db.insert('growthUsers', { userId, w1Active: false, w4Active: false })
  }
}

/** The person behind a workspace principal; agents and services are nobody. */
async function principalUserIds(ctx: MutationCtx, principalIds: Iterable<string>): Promise<string[]> {
  const userIds: string[] = []
  for (const principalId of new Set(principalIds)) {
    const principal = await ctx.db.query('workspacePrincipals')
      .withIndex('by_principalId', (q) => q.eq('principalId', principalId)).first()
    if (principal?.type === 'human' && principal.userId) userIds.push(principal.userId)
  }
  return userIds
}

/** Adds spend to the day's workspace row. Personal billing accounts count in the totals only. */
async function addWorkspaceUsage(
  ctx: MutationCtx,
  day: string,
  usage: Map<string, { cents: number; sandboxSeconds: number }>,
) {
  for (const [billingAccountId, { cents, sandboxSeconds }] of usage) {
    const account = await ctx.db.query('billingAccounts')
      .withIndex('by_billingAccountId', (q) => q.eq('billingAccountId', billingAccountId)).first()
    if (account?.scope !== 'workspace' || !account.workspaceId) continue
    const workspaceId = account.workspaceId
    const row = await ctx.db.query('growthWorkspaceUsage')
      .withIndex('by_day_workspaceId', (q) => q.eq('day', day).eq('workspaceId', workspaceId)).unique()
    if (row) await ctx.db.patch(row._id, { cents: row.cents + cents, sandboxSeconds: row.sandboxSeconds + sandboxSeconds })
    else await ctx.db.insert('growthWorkspaceUsage', { day, workspaceId, cents, sandboxSeconds })
  }
}

function addCharge(
  usage: Map<string, { cents: number; sandboxSeconds: number }>,
  counts: Counts,
  charge: { billingAccountId?: string; cents: number; sandboxSeconds: number },
) {
  counts.usageCents += charge.cents
  counts.sandboxSeconds += charge.sandboxSeconds
  if (!charge.billingAccountId) return
  const total = usage.get(charge.billingAccountId) ?? { cents: 0, sandboxSeconds: 0 }
  total.cents += charge.cents
  total.sandboxSeconds += charge.sandboxSeconds
  usage.set(charge.billingAccountId, total)
}

// ─── Steps ───────────────────────────────────────────────────────────────

type StepInput = { ctx: MutationCtx; state: JobState; day: string; cursor: string | null; counts: Counts }
type StepResult = { isDone: boolean; continueCursor: string }
type Step = (input: StepInput) => Promise<StepResult>

const SKIP: StepResult = { isDone: true, continueCursor: '' }

function isCountedFile(file: Doc<'files'>): boolean {
  if (file.kind) return file.kind === 'note' || file.kind === 'upload'
  return file.type === 'file' && !file.outputType
}

function isPaid(subscription: Doc<'billingAccountSubscriptions'>): boolean {
  return subscription.planKind === 'paid' && (subscription.status === 'active' || subscription.status === 'trialing')
}

/** Steps run in this order for every day. */
const STEPS: Step[] = [
  // Workspace spend is rebuilt from scratch each time a day is counted.
  async ({ ctx, day }) => {
    const rows = await ctx.db.query('growthWorkspaceUsage').withIndex('by_day_workspaceId', (q) => q.eq('day', day)).take(500)
    for (const row of rows) await ctx.db.delete(row._id)
    return { isDone: rows.length < 500, continueCursor: '' }
  },
  async ({ ctx, day, cursor, counts }) => {
    const { start, end } = dayRange(day)
    const page = await ctx.db.query('subscriptions')
      .withIndex('by_creation_time', (q) => q.gte('_creationTime', start).lt('_creationTime', end))
      .paginate({ cursor, numItems: 200 })
    for (const row of page.page) {
      counts.usersCreated += 1
      await recordSignup(ctx, row.userId, day)
    }
    return page
  },
  async ({ ctx, day, cursor, counts }) => {
    const { start, end } = dayRange(day)
    const page = await ctx.db.query('workItems')
      .withIndex('by_creation_time', (q) => q.gte('_creationTime', start).lt('_creationTime', end))
      .paginate({ cursor, numItems: 100 })
    // Who to credit comes from the task's events: an agent creating a task for its owner isn't the owner's work.
    counts.tasksCreated += page.page.length
    return page
  },
  async ({ ctx, day, cursor }) => {
    const { start, end } = dayRange(day)
    const page = await ctx.db.query('workItemEvents')
      .withIndex('by_creation_time', (q) => q.gte('_creationTime', start).lt('_creationTime', end))
      .paginate({ cursor, numItems: 200 })
    await creditActive(ctx, await principalUserIds(ctx, page.page.map((event) => event.actorPrincipalId)), day)
    return page
  },
  async ({ ctx, day, cursor, counts }) => {
    const { start, end } = dayRange(day)
    const page = await ctx.db.query('workspaceAgentDefinitions')
      .withIndex('by_creation_time', (q) => q.gte('_creationTime', start).lt('_creationTime', end))
      .paginate({ cursor, numItems: 100 })
    const agents = page.page.filter((agent) => !agent.isDefault)
    counts.agentsCreated += agents.length
    await creditActive(ctx, await principalUserIds(ctx, agents.map((agent) => agent.createdByPrincipalId)), day)
    return page
  },
  async ({ ctx, day, cursor, counts }) => {
    const { start, end } = dayRange(day)
    const page = await ctx.db.query('automations')
      .withIndex('by_creation_time', (q) => q.gte('_creationTime', start).lt('_creationTime', end))
      .paginate({ cursor, numItems: 100 })
    counts.automationsCreated += page.page.length
    await creditActive(ctx, page.page.map((automation) => automation.userId), day)
    return page
  },
  // Files can carry up to 1 MiB of text each, so their pages stay small.
  async ({ ctx, day, cursor, counts }) => {
    const { start, end } = dayRange(day)
    const page = await ctx.db.query('files')
      .withIndex('by_creation_time', (q) => q.gte('_creationTime', start).lt('_creationTime', end))
      .paginate({ cursor, numItems: 10 })
    const files = page.page.filter(isCountedFile)
    counts.filesCreated += files.length
    // Agent drive files are saved under the owner, who didn't make them.
    await creditActive(ctx, files.filter((file) => !file.createdByAgent).map((file) => file.userId), day)
    return page
  },
  async ({ ctx, day, cursor, counts }) => {
    // Editors were credited in growthUserDays when they saved.
    const page = await ctx.db.query('growthFileEdits').withIndex('by_day', (q) => q.eq('day', day))
      .paginate({ cursor, numItems: 500 })
    counts.filesEdited += page.page.length
    return page
  },
  async ({ ctx, day, cursor, counts }) => {
    const { start, end } = dayRange(day)
    const page = await ctx.db.query('conversations')
      .withIndex('by_creation_time', (q) => q.gte('_creationTime', start).lt('_creationTime', end))
      .paginate({ cursor, numItems: 100 })
    const threads = page.page.filter((thread) => !thread.isAutomation)
    counts.threadsCreated += threads.length
    // A Slack-linked thread's owner may not be the person who wrote in Slack.
    await creditActive(ctx, threads.filter((thread) => !thread.externalPlatform).map((thread) => thread.userId), day)
    return page
  },
  async ({ ctx, day, cursor, counts }) => {
    const { start, end } = dayRange(day)
    const page = await ctx.db.query('conversationMessages')
      .withIndex('by_creation_time', (q) => q.gte('_creationTime', start).lt('_creationTime', end))
      .paginate({ cursor, numItems: 15 })
    const conversations = new Map<string, Doc<'conversations'> | null>()
    const active: string[] = []
    for (const message of page.page) {
      if (message.role !== 'user' || message.importedAuthorName) continue
      if (message.authorKind && message.authorKind !== 'human') continue
      if (!conversations.has(message.conversationId)) {
        conversations.set(message.conversationId, await ctx.db.get(message.conversationId))
      }
      const conversation = conversations.get(message.conversationId)
      // Automation runs post their prompt as a user message; that's the automation, not a person.
      if (conversation?.isAutomation) continue
      counts.messagesSent += 1
      if (!conversation?.externalPlatform) active.push(message.userId)
    }
    await creditActive(ctx, active, day)
    return page
  },
  async ({ ctx, day, cursor, counts }) => {
    const { start, end } = dayRange(day)
    const page = await ctx.db.query('automationRuns')
      .withIndex('by_creation_time', (q) => q.gte('_creationTime', start).lt('_creationTime', end))
      .paginate({ cursor, numItems: 50 })
    const active: string[] = []
    for (const run of page.page) {
      if (run.status === 'skipped') continue
      counts.automationRuns += 1
      if (run.status === 'succeeded' || run.status === 'completed') counts.automationRunsSucceeded += 1
      if (run.status === 'failed' || run.status === 'dead_letter') counts.automationRunsFailed += 1
      // Scheduled runs are the automation working by itself.
      if (run.triggerSource === 'manual' || run.triggerSource === 'retry') active.push(run.userId)
    }
    await creditActive(ctx, active, day)
    return page
  },
  async ({ ctx, day, cursor, counts }) => {
    const { start, end } = dayRange(day)
    const page = await ctx.db.query('budgetTopUps')
      .withIndex('by_creation_time', (q) => q.gte('_creationTime', start).lt('_creationTime', end))
      .paginate({ cursor, numItems: 200 })
    for (const topUp of page.page) {
      // A partly refunded top-up is marked refunded but still kept the rest.
      if (topUp.status !== 'succeeded' && topUp.status !== 'refunded') continue
      const kept = topUp.amountCents - (topUp.refundedAmountCents ?? 0)
      if (kept <= 0) continue
      counts.topUps += 1
      counts.topUpCents += kept
    }
    return page
  },
  // Billed spend matches billing's own totals (billing/usageTotals): finalized
  // reservations, plus usage operations that carry their own charge.
  async ({ ctx, day, cursor, counts }) => {
    const { start, end } = dayRange(day)
    const page = await ctx.db.query('budgetReservations')
      .withIndex('by_creation_time', (q) => q.gte('_creationTime', start).lt('_creationTime', end))
      .paginate({ cursor, numItems: 200 })
    const usage = new Map<string, { cents: number; sandboxSeconds: number }>()
    for (const reservation of page.page) {
      if (reservation.status !== 'finalized') continue
      addCharge(usage, counts, {
        billingAccountId: reservation.billingAccountId,
        cents: reservation.finalizedCents ?? 0,
        sandboxSeconds: reservation.kind === 'sandbox' ? reservation.usageSeconds ?? 0 : 0,
      })
    }
    await addWorkspaceUsage(ctx, day, usage)
    return page
  },
  async ({ ctx, day, cursor, counts }) => {
    const { start, end } = dayRange(day)
    const page = await ctx.db.query('usageOperations')
      .withIndex('by_creation_time', (q) => q.gte('_creationTime', start).lt('_creationTime', end))
      .paginate({ cursor, numItems: 200 })
    const usage = new Map<string, { cents: number; sandboxSeconds: number }>()
    for (const operation of page.page) {
      if (!operation.cents || !operation.kind) continue
      addCharge(usage, counts, {
        billingAccountId: operation.billingAccountId,
        cents: operation.cents,
        sandboxSeconds: operation.kind === 'sandbox' ? operation.usageSeconds ?? 0 : 0,
      })
    }
    await addWorkspaceUsage(ctx, day, usage)
    return page
  },
  async ({ ctx, day, cursor, counts }) => {
    const page = await ctx.db.query('growthUserDays').withIndex('by_day', (q) => q.eq('day', day))
      .paginate({ cursor, numItems: 200 })
    counts.activeUsers += page.page.length
    // Some user-days are written outside this job (file edits), so retention is checked for all of them here.
    for (const userDay of page.page) {
      const user = await growthUser(ctx, userDay.userId)
      if (user) await creditRetention(ctx, user)
      else await ctx.db.insert('growthUsers', { userId: userDay.userId, w1Active: false, w4Active: false })
    }
    return page
  },
  // Weekly/monthly actives look each user's activity up directly, so they're
  // right whichever order days were counted in.
  async ({ ctx, state, day, cursor }) => {
    const monthStart = addDays(day, -29)
    const weekStart = addDays(day, -6)
    const page = await ctx.db.query('growthUsers').paginate({ cursor, numItems: 200 })
    for (const user of page.page) {
      const latest = await ctx.db.query('growthUserDays')
        .withIndex('by_userId_day', (q) => q.eq('userId', user.userId).gte('day', monthStart).lte('day', day))
        .order('desc').first()
      if (!latest) continue
      state.monthlyActiveUsers = (state.monthlyActiveUsers ?? 0) + 1
      if (latest.day >= weekStart) state.weeklyActiveUsers = (state.weeklyActiveUsers ?? 0) + 1
    }
    return page
  },
  // Paid plans are only known as they are now, so the snapshot is taken for yesterday only.
  async ({ ctx, state, day, cursor }) => {
    if (day !== addDays(dayOf(Date.now()), -1)) return SKIP
    // A live night with no paid plans is a real zero, not a missing snapshot.
    if (cursor === null) state.paidSubscriptions = 0
    state.firstPaidSnapshotDay ??= day
    // On the first snapshot every paid account is pre-existing: date it by its subscription, approximately.
    const firstSnapshot = state.firstPaidSnapshotDay === day
    const page = await ctx.db.query('billingAccountSubscriptions').paginate({ cursor, numItems: 500 })
    for (const subscription of page.page) {
      if (!isPaid(subscription)) continue
      state.paidSubscriptions = (state.paidSubscriptions ?? 0) + 1
      const seen = await ctx.db.query('growthPaidAccounts')
        .withIndex('by_billingAccountId', (q) => q.eq('billingAccountId', subscription.billingAccountId)).first()
      if (seen) continue
      await ctx.db.insert('growthPaidAccounts', {
        billingAccountId: subscription.billingAccountId,
        firstPaidDay: firstSnapshot ? dayOf(subscription.createdAt) : day,
        approximate: firstSnapshot,
      })
    }
    return page
  },
]

async function finishDay(ctx: MutationCtx, state: JobState, day: string) {
  const existing = await ctx.db.query('growthDailyTotals').withIndex('by_day', (q) => q.eq('day', day)).unique()
  const topWorkspaces = await ctx.db.query('growthWorkspaceUsage')
    .withIndex('by_day_cents', (q) => q.eq('day', day)).order('desc').take(TOP_WORKSPACES)
  const totals = {
    day,
    ...(state.counts ?? zeroCounts()),
    weeklyActiveUsers: state.weeklyActiveUsers ?? 0,
    monthlyActiveUsers: state.monthlyActiveUsers ?? 0,
    // A recount of an earlier day keeps the snapshot taken on its live night.
    paidSubscriptions: state.paidSubscriptions ?? existing?.paidSubscriptions,
    topWorkspaces: topWorkspaces.map(({ workspaceId, cents, sandboxSeconds }) => ({ workspaceId, cents, sandboxSeconds })),
    computedAt: Date.now(),
  }
  if (existing) await ctx.db.replace(existing._id, totals)
  else await ctx.db.insert('growthDailyTotals', totals)

  const lastCompletedDay = state.lastCompletedDay && state.lastCompletedDay > day ? state.lastCompletedDay : day
  if (state.untilDay && day < state.untilDay) {
    await ctx.db.patch(state._id, { lastCompletedDay })
    await beginDay(ctx, addDays(day, 1))
    return
  }
  await ctx.db.patch(state._id, {
    lastCompletedDay, day: undefined, step: undefined, cursor: undefined, counts: undefined,
    weeklyActiveUsers: undefined, monthlyActiveUsers: undefined, paidSubscriptions: undefined,
    untilDay: undefined, updatedAt: Date.now(),
  })
}

async function beginDay(ctx: MutationCtx, day: string, untilDay?: string) {
  const state = await getState(ctx)
  const fresh = {
    day, step: 0, cursor: undefined, counts: zeroCounts(),
    weeklyActiveUsers: undefined, monthlyActiveUsers: undefined, paidSubscriptions: undefined, updatedAt: Date.now(),
  }
  if (state) await ctx.db.patch(state._id, { ...fresh, ...(untilDay ? { untilDay } : {}) })
  else await ctx.db.insert('growthJobState', { key: 'daily', ...fresh, untilDay })
  await ctx.scheduler.runAfter(0, internal.platform.growth.runStep, { day })
}

// ─── Entry points ────────────────────────────────────────────────────────

/** Counts one page of the current step, then schedules the next. */
export const runStep = internalMutation({
  args: { day: v.string() },
  returns: v.null(),
  handler: async (ctx, { day }) => {
    const state = await getState(ctx)
    // A newer run took over; this scheduled call is left over.
    if (!state || state.day !== day || state.step === undefined) return null
    if (state.step >= STEPS.length) {
      await finishDay(ctx, state, day)
      return null
    }
    const counts = { ...(state.counts ?? zeroCounts()) }
    const working = { ...state }
    const result = await STEPS[state.step]!({ ctx, state: working, day, cursor: state.cursor ?? null, counts })
    await ctx.db.patch(state._id, {
      counts,
      weeklyActiveUsers: working.weeklyActiveUsers,
      monthlyActiveUsers: working.monthlyActiveUsers,
      paidSubscriptions: working.paidSubscriptions,
      firstPaidSnapshotDay: working.firstPaidSnapshotDay,
      step: result.isDone ? state.step + 1 : state.step,
      cursor: result.isDone ? undefined : result.continueCursor,
      updatedAt: Date.now(),
    })
    await ctx.scheduler.runAfter(0, internal.platform.growth.runStep, { day })
    return null
  },
})

/**
 * Nightly cron: counts every day since the last completed one, up to
 * yesterday, re-counting the RECOUNT_DAYS before it.
 */
export const startDaily = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now()
    const yesterday = addDays(dayOf(now), -1)
    const state = await getState(ctx)
    if (state?.day && now - state.updatedAt < STALE_RUN_MS) return null
    if (state?.day) {
      // A stopped run: count that day again from the start.
      await beginDay(ctx, state.day, state.untilDay ?? yesterday)
      return null
    }
    if (state?.lastCompletedDay && state.lastCompletedDay >= yesterday) return null
    const fromDay = state?.lastCompletedDay ? addDays(state.lastCompletedDay, 1 - RECOUNT_DAYS) : yesterday
    await beginDay(ctx, fromDay, yesterday)
    return null
  },
})

/** One-time (or repair) backfill: recounts every day from `fromDay` (default: the first signup) to yesterday. */
export const startBackfill = internalMutation({
  args: { fromDay: v.optional(v.string()), force: v.optional(v.boolean()) },
  returns: v.object({ fromDay: v.union(v.string(), v.null()), untilDay: v.string() }),
  handler: async (ctx, { fromDay, force }) => {
    const now = Date.now()
    const untilDay = addDays(dayOf(now), -1)
    const state = await getState(ctx)
    if (state?.day && now - state.updatedAt < STALE_RUN_MS && !force) {
      throw new Error(`Growth job is already counting ${state.day}; pass force to restart.`)
    }
    const firstSignup = await ctx.db.query('subscriptions').order('asc').first()
    const start = fromDay ?? (firstSignup ? dayOf(firstSignup._creationTime) : null)
    if (!start || start > untilDay) return { fromDay: null, untilDay }
    await beginDay(ctx, start, untilDay)
    return { fromDay: start, untilDay }
  },
})
