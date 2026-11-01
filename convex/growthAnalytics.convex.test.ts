import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'
import { addDays, daysBetween, weekStartOf } from './platform/growth'
import { recordFileEdit } from './lib/growthFileEdits'

const modules = import.meta.glob('./**/*.ts')
const startBackfill = makeFunctionReference<'mutation'>('platform/growth:startBackfill')
const startDaily = makeFunctionReference<'mutation'>('platform/growth:startDaily')
const updateFile = makeFunctionReference<'mutation'>('files/files:update')
const secret = 'growth-analytics-secret'
beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })

// A Monday, so the signup week starts on DAY1.
const DAY1 = '2026-03-02'
const at = (day: string, hour = 12) => Date.parse(`${day}T${String(hour).padStart(2, '0')}:00:00Z`)

type Convex = ReturnType<typeof convexTest>

async function insertAt(convex: Convex, day: string, write: Parameters<Convex['run']>[0]) {
  vi.setSystemTime(at(day))
  await convex.run(write)
}

async function runAll(convex: Convex) {
  await convex.finishAllScheduledFunctions(vi.runAllTimers, 10_000)
}

const totals = (convex: Convex, day: string) => convex.run(async (ctx) =>
  await ctx.db.query('growthDailyTotals').withIndex('by_day', (q) => q.eq('day', day)).unique())

async function seed(convex: Convex) {
  const now = at(DAY1)
  await insertAt(convex, DAY1, async (ctx) => {
    await ctx.db.insert('subscriptions', { userId: 'user-a' })
    await ctx.db.insert('subscriptions', { userId: 'user-b' })
    await ctx.db.insert('workspacePrincipals', {
      principalId: 'p-a', workspaceId: 'w1', type: 'human', userId: 'user-a', displayName: 'A', createdAt: now, updatedAt: now,
    })
    await ctx.db.insert('workspacePrincipals', {
      principalId: 'p-agent', workspaceId: 'w1', type: 'agent', agentId: 'agent-1', displayName: 'Helper', createdAt: now, updatedAt: now,
    })
    const task = { scope: 'workspace' as const, workspaceId: 'w1', title: 'Task', status: 'todo' as const, blocked: false, priority: 0, rank: 'a', createdAt: now, updatedAt: now }
    const byA = await ctx.db.insert('workItems', { ...task, userId: 'user-a' })
    await ctx.db.insert('workItemEvents', { workItemId: byA, workspaceId: 'w1', actorPrincipalId: 'p-a', kind: 'created', createdAt: now })
    // An agent creates a task owned by user-c: it counts, but user-c did nothing.
    const byAgent = await ctx.db.insert('workItems', { ...task, userId: 'user-c' })
    await ctx.db.insert('workItemEvents', { workItemId: byAgent, workspaceId: 'w1', actorPrincipalId: 'p-agent', kind: 'created', createdAt: now })
    const agent = {
      workspaceId: 'w1', principalId: 'p-agent', instructions: '', harness: 'overlay' as const, modelId: 'm',
      allowedToolIds: [], invocationPolicy: 'mention' as const, createdByPrincipalId: 'p-a', createdAt: now, updatedAt: now,
    }
    await ctx.db.insert('workspaceAgentDefinitions', { ...agent, agentId: 'agent-1', name: 'Helper' })
    await ctx.db.insert('workspaceAgentDefinitions', { ...agent, agentId: 'agent-default', name: 'Overlay', isDefault: true })
    const automationId = await ctx.db.insert('automations', { userId: 'user-b', createdAt: now, updatedAt: now })
    await ctx.db.insert('files', { userId: 'user-a', name: 'Note', type: 'file', kind: 'note', createdAt: now, updatedAt: now })
    await ctx.db.insert('files', { userId: 'user-a', name: 'Folder', type: 'folder', kind: 'folder', createdAt: now, updatedAt: now })
    await ctx.db.insert('files', { userId: 'user-a', name: 'Image', type: 'file', kind: 'output', createdAt: now, updatedAt: now })
    // An agent saves a file under user-c: it counts as created, but user-c did nothing.
    await ctx.db.insert('files', { userId: 'user-c', name: 'Report', type: 'file', kind: 'upload', createdByAgent: true, createdAt: now, updatedAt: now })

    const thread = { title: 'Chat', lastModified: now, createdAt: now, lastMode: 'act' as const, askModelIds: [], actModelId: 'm' }
    const chat = await ctx.db.insert('conversations', { ...thread, userId: 'user-a' })
    const automationThread = await ctx.db.insert('conversations', { ...thread, userId: 'user-b', isAutomation: true })
    const message = { userId: 'user-a', turnId: 't', mode: 'act' as const, content: 'hi', contentType: 'text' as const, createdAt: now }
    // More than one page of messages, so a day split across pages is checked.
    for (let i = 0; i < 20; i += 1) await ctx.db.insert('conversationMessages', { ...message, conversationId: chat, role: 'user' })
    await ctx.db.insert('conversationMessages', { ...message, conversationId: chat, role: 'assistant' })
    await ctx.db.insert('conversationMessages', { ...message, conversationId: chat, role: 'user', importedAuthorName: 'Slack person' })
    await ctx.db.insert('conversationMessages', { ...message, conversationId: automationThread, role: 'user', userId: 'user-b' })

    const run = { automationId, userId: 'user-b', scheduledFor: now, createdAt: now }
    await ctx.db.insert('automationRuns', { ...run, status: 'succeeded', triggerSource: 'manual' })
    await ctx.db.insert('automationRuns', { ...run, status: 'failed' })
    await ctx.db.insert('automationRuns', { ...run, status: 'skipped' })

    const topUp = { userId: 'user-b', billingPeriodStart: now, amountCents: 1_000, source: 'manual' as const, createdAt: now, updatedAt: now }
    // Partly refunded (marked refunded, 800 kept), fully refunded, and pending.
    await ctx.db.insert('budgetTopUps', { ...topUp, status: 'refunded', refundedAmountCents: 200 })
    await ctx.db.insert('budgetTopUps', { ...topUp, status: 'refunded', refundedAmountCents: 1_000 })
    await ctx.db.insert('budgetTopUps', { ...topUp, status: 'pending' })

    await ctx.db.insert('billingAccounts', {
      billingAccountId: 'ba-w1', scope: 'workspace', workspaceId: 'w1', status: 'active', pricingVersion: 'markup_25_v1',
      markupBasisPoints: 2_500, createdAt: now, updatedAt: now,
    })
    await ctx.db.insert('usageOperations', { userId: 'user-a', billingAccountId: 'ba-w1', operationId: 'op-1', recorded: 1, cents: 50, kind: 'ask', createdAt: now })
    await ctx.db.insert('usageOperations', {
      userId: 'user-a', billingAccountId: 'ba-w1', operationId: 'op-2', recorded: 1, cents: 5, kind: 'sandbox', usageSeconds: 30, createdAt: now,
    })
    const reservation = { userId: 'user-a', billingAccountId: 'ba-w1', kind: 'ask' as const, reservedCents: 50, createdAt: now, updatedAt: now }
    await ctx.db.insert('budgetReservations', { ...reservation, reservationId: 'r-1', status: 'finalized', finalizedCents: 20 })
    await ctx.db.insert('budgetReservations', { ...reservation, reservationId: 'r-2', status: 'released' })
    // An operation billed through a reservation carries no charge of its own.
    await ctx.db.insert('usageOperations', { userId: 'user-a', billingAccountId: 'ba-w1', operationId: 'op-3', recorded: 1, kind: 'ask', createdAt: now })
    await ctx.db.insert('billingAccountSubscriptions', {
      billingAccountId: 'ba-w1', provider: 'stripe', planKind: 'paid', planVersion: 'variable_v2', planAmountCents: 2_000,
      markupBasisPoints: 2_500, status: 'active', autoTopUpEnabled: false, autoTopUpAmountCents: 0, createdAt: now, updatedAt: now,
    })
  })

  // A week later: A writes again (W1); B edits a note A owns, and so does A (both W1); an agent overwrites a file (no one credited).
  const day8 = addDays(DAY1, 7)
  await insertAt(convex, day8, async (ctx) => {
    const now = at(day8)
    const chat = await ctx.db.query('conversations').first()
    await ctx.db.insert('conversationMessages', {
      conversationId: chat!._id, userId: 'user-a', turnId: 't2', role: 'user', mode: 'act', content: 'again', contentType: 'text', createdAt: now,
    })
    const note = await ctx.db.query('files').first()
    await recordFileEdit(ctx, note!._id, 'user-b', now)
    await recordFileEdit(ctx, note!._id, 'user-a', now)
    const agentFile = await ctx.db.insert('files', { userId: 'user-a', name: 'Agent file', type: 'file', kind: 'upload', createdAt: now, updatedAt: now })
    await recordFileEdit(ctx, agentFile, undefined, now)
  })
}

describe('growth day helpers', () => {
  test('days and weeks are UTC calendar days', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
    expect(daysBetween('2026-03-02', '2026-03-09')).toBe(7)
    expect(weekStartOf('2026-03-08')).toBe('2026-03-02')
    expect(weekStartOf('2026-03-02')).toBe('2026-03-02')
  })
})

describe('nightly growth rollups', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  test('backfill counts created things, work, usage and actives, and a re-run gives the same answer', async () => {
    const convex = convexTest(schema, modules)
    await seed(convex)
    const day8 = addDays(DAY1, 7)

    vi.setSystemTime(at(addDays(day8, 1), 1))
    await expect(convex.mutation(startBackfill, {})).resolves.toEqual({ fromDay: DAY1, untilDay: day8 })
    await runAll(convex)

    const first = await totals(convex, DAY1)
    expect(first).toMatchObject({
      usersCreated: 2, tasksCreated: 2, agentsCreated: 1, automationsCreated: 1, filesCreated: 2, filesEdited: 0,
      threadsCreated: 1, messagesSent: 20, automationRuns: 2, automationRunsSucceeded: 1, automationRunsFailed: 1,
      topUps: 1, topUpCents: 800, usageCents: 75, sandboxSeconds: 30, activeUsers: 2,
      weeklyActiveUsers: 2, monthlyActiveUsers: 2,
      topWorkspaces: [{ workspaceId: 'w1', cents: 75, sandboxSeconds: 30 }],
    })
    // Paid plans are only known as they are now, so a historic day gets no snapshot.
    expect(first?.paidSubscriptions).toBeUndefined()

    const later = await totals(convex, day8)
    expect(later).toMatchObject({
      messagesSent: 1, filesCreated: 1, filesEdited: 2, activeUsers: 2, weeklyActiveUsers: 2, monthlyActiveUsers: 2, paidSubscriptions: 1,
    })
    // The quiet days in between are still written, with zeros.
    expect(await totals(convex, addDays(DAY1, 3))).toMatchObject({ activeUsers: 0, weeklyActiveUsers: 2, messagesSent: 0 })

    const cohort = () => convex.run(async (ctx) =>
      await ctx.db.query('growthCohortWeeks').withIndex('by_weekStart', (q) => q.eq('weekStart', DAY1)).unique())
    expect(await cohort()).toMatchObject({ users: 2, w1Active: 2, w4Active: 0 })
    const paid = await convex.run(async (ctx) => await ctx.db.query('growthPaidAccounts').collect())
    expect(paid).toMatchObject([{ billingAccountId: 'ba-w1', firstPaidDay: DAY1, approximate: true }])

    await convex.mutation(startBackfill, { fromDay: DAY1 })
    await runAll(convex)
    const { day, usersCreated, messagesSent, activeUsers, weeklyActiveUsers, topUpCents, usageCents, topWorkspaces } = first!
    expect(await totals(convex, DAY1)).toMatchObject({ day, usersCreated, messagesSent, activeUsers, weeklyActiveUsers, topUpCents, usageCents, topWorkspaces })
    expect(await totals(convex, day8)).toMatchObject({ messagesSent: 1, activeUsers: 2, weeklyActiveUsers: 2 })
    expect(await cohort()).toMatchObject({ users: 2, w1Active: 2, w4Active: 0 })
  })

  test('the nightly run counts only yesterday the first time, then each new day once', async () => {
    const convex = convexTest(schema, modules)
    await seed(convex)

    vi.setSystemTime(at(addDays(DAY1, 1), 0))
    await convex.mutation(startDaily, {})
    await runAll(convex)
    expect(await totals(convex, DAY1)).toMatchObject({ usersCreated: 2, activeUsers: 2, paidSubscriptions: 1 })

    // Same night again: nothing new to count.
    await convex.mutation(startDaily, {})
    expect(await convex.run(async (ctx) => await ctx.db.system.query('_scheduled_functions')
      .filter((q) => q.eq(q.field('state.kind'), 'pending')).collect())).toHaveLength(0)

    // A top-up confirmed after the night it was counted.
    await convex.run(async (ctx) => {
      const pending = await ctx.db.query('budgetTopUps').filter((q) => q.eq(q.field('status'), 'pending')).first()
      await ctx.db.patch(pending!._id, { status: 'succeeded' })
    })

    // Two nights missed: both days are counted in order, and the days before are re-counted.
    vi.setSystemTime(at(addDays(DAY1, 3), 0))
    await convex.mutation(startDaily, {})
    await runAll(convex)
    const counted = await convex.run(async (ctx) => (await ctx.db.query('growthDailyTotals').collect()).map((row) => row.day).sort())
    expect(counted).toEqual([addDays(DAY1, -1), DAY1, addDays(DAY1, 1), addDays(DAY1, 2)])
    expect(await totals(convex, DAY1)).toMatchObject({ topUps: 2, topUpCents: 1_800, paidSubscriptions: 1 })
  })

  test('a backfill after the first nightly run still gets weekly actives and dates paid accounts by their subscription', async () => {
    const convex = convexTest(schema, modules)
    await seed(convex)
    const day8 = addDays(DAY1, 7)
    vi.setSystemTime(at(addDays(day8, 1), 0))
    await convex.mutation(startDaily, {})
    await runAll(convex)

    await convex.mutation(startBackfill, {})
    await runAll(convex)
    expect(await totals(convex, DAY1)).toMatchObject({ activeUsers: 2, weeklyActiveUsers: 2, monthlyActiveUsers: 2 })
    expect(await totals(convex, addDays(DAY1, 3))).toMatchObject({ weeklyActiveUsers: 2 })
    expect(await totals(convex, day8)).toMatchObject({ activeUsers: 2, weeklyActiveUsers: 2, monthlyActiveUsers: 2, paidSubscriptions: 1 })
    expect(await convex.run(async (ctx) => await ctx.db.query('growthPaidAccounts').collect()))
      .toMatchObject([{ billingAccountId: 'ba-w1', firstPaidDay: DAY1, approximate: true }])
    expect(await convex.run(async (ctx) =>
      await ctx.db.query('growthCohortWeeks').withIndex('by_weekStart', (q) => q.eq('weekStart', DAY1)).unique()))
      .toMatchObject({ users: 2, w1Active: 2 })
  })

  test('an account that turns paid after the first snapshot is dated by the night it was seen', async () => {
    const convex = convexTest(schema, modules)
    await seed(convex)
    vi.setSystemTime(at(addDays(DAY1, 1), 0))
    await convex.mutation(startDaily, {})
    await runAll(convex)
    await convex.run(async (ctx) => {
      await ctx.db.insert('billingAccountSubscriptions', {
        billingAccountId: 'ba-new', provider: 'stripe', planKind: 'paid', planVersion: 'variable_v2', planAmountCents: 2_000,
        markupBasisPoints: 2_500, status: 'active', autoTopUpEnabled: false, autoTopUpAmountCents: 0, createdAt: at(DAY1), updatedAt: at(DAY1),
      })
    })
    vi.setSystemTime(at(addDays(DAY1, 2), 0))
    await convex.mutation(startDaily, {})
    await runAll(convex)
    const paid = await convex.run(async (ctx) => await ctx.db.query('growthPaidAccounts')
      .withIndex('by_billingAccountId', (q) => q.eq('billingAccountId', 'ba-new')).unique())
    expect(paid).toMatchObject({ firstPaidDay: addDays(DAY1, 1), approximate: false })
  })

  test('a live night with no paid plans records zero, and a recount after a cancellation drops to zero', async () => {
    const convex = convexTest(schema, modules)
    await seed(convex)
    vi.setSystemTime(at(addDays(DAY1, 1), 0))
    await convex.mutation(startDaily, {})
    await runAll(convex)
    expect(await totals(convex, DAY1)).toMatchObject({ paidSubscriptions: 1 })

    await convex.run(async (ctx) => {
      const subscription = await ctx.db.query('billingAccountSubscriptions').first()
      await ctx.db.patch(subscription!._id, { status: 'canceled' })
    })
    await convex.mutation(startBackfill, { fromDay: DAY1 })
    await runAll(convex)
    expect(await totals(convex, DAY1)).toMatchObject({ paidSubscriptions: 0 })
  })

  test('a run that is still going is not started twice', async () => {
    const convex = convexTest(schema, modules)
    await seed(convex)
    vi.setSystemTime(at(addDays(DAY1, 1), 0))
    await convex.mutation(startDaily, {})
    await expect(convex.mutation(startBackfill, {})).rejects.toThrow(/already counting/)
    await convex.mutation(startDaily, {})
    await runAll(convex)
    expect(await totals(convex, DAY1)).toMatchObject({ usersCreated: 2, messagesSent: 20 })
  })
})

describe('file edit tracking', () => {
  test('each text change is kept per file and day with every editor; indexing updates and unchanged saves are not edits', async () => {
    vi.useFakeTimers()
    const convex = convexTest(schema, modules)
    vi.setSystemTime(at(DAY1, 23))
    const fileId = await convex.run(ctx => ctx.db.insert('files', {
      userId: 'user_1', name: 'Note', type: 'file', kind: 'note', content: 'First', createdAt: 1, updatedAt: 1,
    }))
    const edits = () => convex.run(async (ctx) => (await ctx.db.query('growthFileEdits').collect()).map(({ day }) => ({ day })))
    const userDays = () => convex.run(async (ctx) => (await ctx.db.query('growthUserDays').collect())
      .map(({ userId, day }) => `${userId}@${day}`).sort())

    await convex.mutation(updateFile, { userId: 'user_1', serverSecret: secret, fileId, indexStatus: 'indexed' })
    await convex.mutation(updateFile, { userId: 'user_1', serverSecret: secret, fileId, content: 'First' })
    expect(await edits()).toEqual([])

    await convex.mutation(updateFile, { userId: 'user_1', serverSecret: secret, fileId, content: 'Second' })
    await convex.mutation(updateFile, { userId: 'user_1', serverSecret: secret, fileId, content: 'Third' })
    await convex.run(ctx => recordFileEdit(ctx, fileId, 'user_2', Date.now()))
    await convex.run(ctx => recordFileEdit(ctx, fileId, undefined, Date.now()))

    // Text in object storage: the prefix stays the same, the full-text hash changes.
    const large = await convex.run(ctx => ctx.db.insert('files', {
      userId: 'user_1', name: 'Big', type: 'file', kind: 'upload', content: 'prefix', contentHash: 'hash-1',
      textInObjectStore: true, createdAt: 1, updatedAt: 1,
    }))
    await convex.mutation(updateFile, { userId: 'user_1', serverSecret: secret, fileId: large, content: 'prefix', contentHash: 'hash-1' })
    expect((await edits()).length).toBe(1)
    await convex.mutation(updateFile, { userId: 'user_1', serverSecret: secret, fileId: large, content: 'prefix', contentHash: 'hash-2' })
    expect((await edits()).length).toBe(2)
    await convex.run(async (ctx) => {
      const row = await ctx.db.query('growthFileEdits').withIndex('by_fileId_day', (q) => q.eq('fileId', large)).first()
      await ctx.db.delete(row!._id)
      await ctx.db.delete(large)
    })

    // An edit just after midnight starts a new day and leaves yesterday's in place.
    vi.setSystemTime(at(addDays(DAY1, 1), 0))
    await convex.mutation(updateFile, { userId: 'user_1', serverSecret: secret, fileId, content: 'Fourth' })
    expect(await edits()).toEqual([{ day: DAY1 }, { day: addDays(DAY1, 1) }])
    // Every editor is credited for the day they edited; the agent write credits no one.
    expect(await userDays()).toEqual([`user_1@${DAY1}`, `user_1@${addDays(DAY1, 1)}`, `user_2@${DAY1}`])
    vi.useRealTimers()
  })
})

describe('account deletion', () => {
  test("removes the person's growth rows and keeps anonymous totals", async () => {
    vi.useFakeTimers()
    const convex = convexTest(schema, modules)
    await seed(convex)
    vi.setSystemTime(at(addDays(DAY1, 8), 1))
    await convex.mutation(startBackfill, {})
    await runAll(convex)
    const rowsFor = (userId: string) => convex.run(async (ctx) => ({
      users: (await ctx.db.query('growthUsers').withIndex('by_userId', (q) => q.eq('userId', userId)).collect()).length,
      days: (await ctx.db.query('growthUserDays').withIndex('by_userId_day', (q) => q.eq('userId', userId)).collect()).length,
    }))
    expect(await rowsFor('user-b')).toEqual({ users: 1, days: 2 })

    await convex.mutation(makeFunctionReference<'mutation'>('auth/users:deleteUserAccountByServer'), { serverSecret: secret, userId: 'user-b' })
    expect(await rowsFor('user-b')).toEqual({ users: 0, days: 0 })
    expect(await rowsFor('user-a')).toMatchObject({ users: 1 })
    expect(await totals(convex, DAY1)).toMatchObject({ usersCreated: 2, activeUsers: 2 })
    vi.useRealTimers()
  })
})
