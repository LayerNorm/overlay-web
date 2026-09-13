import { beforeAll, describe, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'
import { computeDaytonaRuntimeCost } from '../src/shared/ai/sandbox/daytona-pricing'
import { applyMarkupToCents } from '../src/shared/billing/billing-pricing'

const modules = import.meta.glob('./**/*.ts')

function categoryOf(statement: { categories: Array<{ category: string } & Record<string, unknown>> }, name: string) {
  return statement.categories.find((c) => c.category === name)
}
const serverSecret = 'usage-statement-test-secret'

beforeAll(() => { process.env.INTERNAL_API_SECRET = serverSecret })

const recordBatch = makeFunctionReference<'mutation'>('platform/usage:recordBatch')
const recordToolInvocation = makeFunctionReference<'mutation'>('platform/usage:recordToolInvocation')
const getUsageStatementByServer = makeFunctionReference<'query'>('platform/usage:getUsageStatementByServer')
const listUsageStatementLinesByServer = makeFunctionReference<'query'>('platform/usage:listUsageStatementLinesByServer')
const accrueUsageByServer = makeFunctionReference<'mutation'>('ai/sandbox/daytona:accrueUsageByServer')

async function seedWorkspaceAccount(
  convex: ReturnType<typeof convexTest>,
  { billingAccountId, workspaceId, includedMicros }: { billingAccountId: string; workspaceId: string; includedMicros: number },
) {
  await convex.run(async (ctx) => {
    const now = Date.now()
    await ctx.db.insert('billingAccounts', {
      billingAccountId,
      createdAt: now,
      markupBasisPoints: 2_500,
      pricingVersion: 'markup_25_v1',
      scope: 'workspace',
      status: 'active',
      updatedAt: now,
      userId: 'owner',
      workspaceId,
    })
    await ctx.db.insert('billingAccountBalances', {
      allowanceUsedMicros: 0,
      billingAccountId,
      createdAt: now,
      includedMicros,
      institutionalGrantMicros: 0,
      mode: 'budgeted',
      reservedMicros: 0,
      topUpBalanceMicros: 0,
      topUpPurchasedMicros: 0,
      updatedAt: now,
      usedMicros: 0,
      version: 0,
    })
  })
}

async function balanceFor(convex: ReturnType<typeof convexTest>, billingAccountId: string) {
  return convex.run(async (ctx) => ctx.db.query('billingAccountBalances')
    .withIndex('by_billingAccountId', (q) => q.eq('billingAccountId', billingAccountId))
    .unique())
}

describe('workspace wallet usage statements', () => {
  test('recordBatch debits the workspace balance and itemizes on the statement', async () => {
    const convex = convexTest(schema, modules)
    const billingAccountId = 'ba_ws_record'
    const workspaceId = 'ws_record'
    await seedWorkspaceAccount(convex, { billingAccountId, workspaceId, includedMicros: 5_000_000_000 })

    const now = Date.now()
    await convex.mutation(recordBatch, {
      serverSecret,
      userId: 'member-1',
      operationId: 'op-batch-1',
      events: [
        { type: 'agent', cost: 80, timestamp: now },
        { type: 'ask', cost: 4, timestamp: now, metadata: { toolId: 'composio_x' } },
      ],
      workspaceBilling: { billingAccountId, workspaceId },
    })

    const balance = await balanceFor(convex, billingAccountId)
    expect(balance?.usedMicros).toBe(840_000)

    const statement = await convex.query(getUsageStatementByServer, {
      billingAccountId,
      periodStart: 0,
      serverSecret,
    })
    expect(categoryOf(statement, 'models')!.totalCents).toBe(80)
    expect(categoryOf(statement, 'models')!.lines).toHaveLength(1)
    expect(categoryOf(statement, 'tools')!.totalCents).toBe(4)
    expect(statement.totalCents).toBe(84)

    const lines = await convex.query(listUsageStatementLinesByServer, {
      billingAccountId,
      category: 'models',
      limit: 10,
      offset: 0,
      periodStart: 0,
      serverSecret,
    })
    expect(lines.lines).toHaveLength(1)
    expect(lines.lines[0]?.detail).toBe('op-batch-1')

    const empty = await convex.query(listUsageStatementLinesByServer, {
      billingAccountId,
      category: 'transcription',
      limit: 10,
      offset: 0,
      periodStart: 0,
      serverSecret,
    })
    expect(empty.lines).toHaveLength(0)
    expect(empty.hasMore).toBe(false)
  })

  test('rejects workspace billing accounts bound to a different workspace', async () => {
    const convex = convexTest(schema, modules)
    await seedWorkspaceAccount(convex, {
      billingAccountId: 'ba_ws_mismatch',
      workspaceId: 'ws_actual',
      includedMicros: 5_000_000_000,
    })
    await expect(convex.mutation(recordBatch, {
      serverSecret,
      userId: 'member-1',
      operationId: 'op-mismatch',
      events: [{ type: 'agent', cost: 80, timestamp: Date.now() }],
      workspaceBilling: { billingAccountId: 'ba_ws_mismatch', workspaceId: 'ws_other' },
    })).rejects.toThrow()
    expect((await balanceFor(convex, 'ba_ws_mismatch'))?.usedMicros).toBe(0)
  })

  test('recordToolInvocation debits the workspace wallet; failed calls bill zero', async () => {
    const convex = convexTest(schema, modules)
    const billingAccountId = 'ba_ws_tools'
    const workspaceId = 'ws_tools'
    await seedWorkspaceAccount(convex, { billingAccountId, workspaceId, includedMicros: 5_000_000_000 })

    await convex.mutation(recordToolInvocation, {
      billableCostCents: 0.03,
      costBucket: 'composio',
      mode: 'act',
      providerCostCents: 0.03,
      serverSecret,
      success: true,
      toolId: 'composio_search',
      userId: 'member-1',
      workspaceBillingAccountId: billingAccountId,
      workspaceId,
    })
    await convex.mutation(recordToolInvocation, {
      billableCostCents: 0,
      costBucket: 'composio',
      mode: 'act',
      providerCostCents: 0,
      serverSecret,
      success: false,
      toolId: 'composio_search',
      userId: 'member-1',
      workspaceBillingAccountId: billingAccountId,
      workspaceId,
    })

    expect((await balanceFor(convex, billingAccountId))?.usedMicros).toBe(300)

    const statement = await convex.query(getUsageStatementByServer, {
      billingAccountId,
      periodStart: 0,
      serverSecret,
    })
    expect(categoryOf(statement, 'tools')!.totalCents).toBe(0.03)
    expect(categoryOf(statement, 'tools')!.lines[0]?.label).toBe('composio_search')
    expect(categoryOf(statement, 'tools')!.lines[0]?.success).toBe(true)

    const rows = await convex.run(async (ctx) => ctx.db.query('toolInvocations').collect())
    expect(rows).toHaveLength(2)
  })

  test('daytona accrueUsage debits the workspace wallet and lands on the statement', async () => {
    const convex = convexTest(schema, modules)
    const billingAccountId = 'ba_ws_daytona'
    const workspaceId = 'ws_daytona'
    await seedWorkspaceAccount(convex, { billingAccountId, workspaceId, includedMicros: 5_000_000_000 })

    const now = Date.now()
    const startedAt = now - 3_600_000
    await convex.run(async (ctx) => {
      await ctx.db.insert('daytonaWorkspaces', {
        createdAt: startedAt,
        lastMeteredAt: startedAt,
        mountPath: '/home/user',
        resourceProfile: 'pro',
        sandboxId: 'sb_1',
        sandboxName: 'sb_1',
        state: 'started',
        tier: 'pro',
        updatedAt: startedAt,
        userId: 'member-1',
        volumeId: 'vol_1',
        volumeName: 'vol_1',
      })
    })

    const result = await convex.mutation(accrueUsageByServer, {
      billingAccountId,
      cpu: 1,
      deferUsageCharge: false,
      diskGiB: 0,
      endedAt: now,
      expectedLastMeteredAt: startedAt,
      memoryGiB: 2,
      reason: 'task',
      resourceProfile: 'pro',
      sandboxId: 'sb_1',
      serverSecret,
      startedAt,
      tier: 'pro',
      userId: 'member-1',
    })
    expect(result.success).toBe(true)

    const providerCost = computeDaytonaRuntimeCost({
      cpu: 1,
      diskGiB: 0,
      elapsedSeconds: 3_600,
      memoryGiB: 2,
    })
    const expectedCents = applyMarkupToCents({ providerCostCents: providerCost.costCents })
    const expectedMicros = Math.round(expectedCents * 10_000)
    expect(expectedMicros).toBeGreaterThan(0)

    expect((await balanceFor(convex, billingAccountId))?.usedMicros).toBe(expectedMicros)

    const statement = await convex.query(getUsageStatementByServer, {
      billingAccountId,
      periodEnd: Date.now() + 60_000,
      periodStart: 0,
      serverSecret,
    })
    expect(categoryOf(statement, 'sandbox')!.totalCents).toBe(expectedCents)
    expect(categoryOf(statement, 'sandbox')!.lines[0]?.label).toBe('daytona/sb_1')
    expect(categoryOf(statement, 'sandbox')!.lines[0]?.providerCostUsd).toBe(providerCost.costUsd)
  })
})
