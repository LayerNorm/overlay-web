import { describe, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { api } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const secret = 'overlay-free-test-secret'
process.env.INTERNAL_API_SECRET = secret

const route = (generation: number) => ({
  routeKey: 'gateway:minimax/minimax-m3.1-flash:minimax',
  transport: 'gateway' as const,
  modelId: 'minimax/minimax-m3.1-flash',
  provider: 'minimax',
  capabilitiesJson: JSON.stringify({
    contextWindow: 1_000_000,
    maxOutputTokens: 524_288,
    supportsTools: true,
    supportsVision: true,
    supportsJson: true,
  }),
  pricingJson: JSON.stringify({ input: '0', output: '0' }),
  catalogVerifiedAt: 1,
  catalogExpiresAt: 3_600_001,
  generation,
  canaryVerifiedAt: 1,
  canaryExpiresAt: 3_600_001,
})

async function lockAndPublish(convex: ReturnType<typeof convexTest>, now = 1) {
  const lock = await convex.mutation(api.platform.overlayFreeSafety.acquireRefreshLockByServer, {
    serverSecret: secret, leaseToken: 'refresh-1', now, leaseMs: 300_000, retryMs: 300_000,
  })
  expect(lock).not.toBeNull()
  const row = route(lock!.generation)
  await convex.mutation(api.platform.overlayFreeSafety.publishByServer, {
    serverSecret: secret, generation: lock!.generation, refreshToken: 'refresh-1', now, routes: [row],
  })
  await convex.mutation(api.platform.overlayFreeSafety.releaseRefreshLockByServer, {
    serverSecret: secret, leaseToken: 'refresh-1', now, success: true,
  })
  return row
}

describe('overlay-free durable safety state', () => {
  test('capacity discovery can include busy routes without bypassing their lease', async () => {
    const convex = convexTest(schema, modules)
    const row = await lockAndPublish(convex)
    const claim = { serverSecret: secret, routeKey: row.routeKey, leaseToken: 'first', now: 2,
      leaseMs: 180_000, purpose: 'user' as const, expectedGeneration: row.generation }
    expect((await convex.mutation(api.platform.overlayFreeSafety.claimByServer, claim)).status).toBe('claimed')
    const query = { serverSecret: secret, now: 3, generation: row.generation }
    expect(await convex.query(api.platform.overlayFreeSafety.listEligibleByServer, query)).toEqual([])
    expect(await convex.query(api.platform.overlayFreeSafety.listEligibleByServer, { ...query, includeBusy: true })).toHaveLength(1)
    expect((await convex.mutation(api.platform.overlayFreeSafety.claimByServer, { ...claim, leaseToken: 'second', now: 3 })).status).toBe('busy')
    await convex.mutation(api.platform.overlayFreeSafety.quarantineExpiredLeasesByServer, { serverSecret: secret, now: 180_003 })
    expect(await convex.query(api.platform.overlayFreeSafety.listEligibleByServer, { ...query, now: 180_003, includeBusy: true })).toEqual([])
  })

  test('late settlement quarantines even when no cleanup has run', async () => {
    const convex = convexTest(schema, modules)
    const row = await lockAndPublish(convex)
    await convex.mutation(api.platform.overlayFreeSafety.claimByServer, {
      serverSecret: secret, routeKey: row.routeKey, leaseToken: 'late', now: 2,
      leaseMs: 180_000, purpose: 'user', expectedGeneration: row.generation,
    })
    const settled = await convex.mutation(api.platform.overlayFreeSafety.settleByServer, {
      serverSecret: secret, routeKey: row.routeKey, leaseToken: 'late', now: 180_003,
      receiptJson: JSON.stringify({ safe: true, cost: 0, actualModelId: row.modelId, actualProvider: row.provider }),
      safe: true, cost: 0,
    })
    expect(settled.status).toBe('late')
    const state = await convex.query(api.platform.overlayFreeSafety.getByServer, {
      serverSecret: secret, routeKey: row.routeKey,
    })
    expect(state?.quarantineReason).toBe('missing receipt')
  })

  test('partial OpenRouter initialization leaves full refresh due and hourly refresh is due before expiry', async () => {
    const convex = convexTest(schema, modules)
    await convex.mutation(api.platform.overlayFreeSafety.acquireRefreshLockByServer, {
      serverSecret: secret, leaseToken: 'or-only', now: 1, leaseMs: 300_000, retryMs: 300_000,
    })
    await convex.mutation(api.platform.overlayFreeSafety.releaseRefreshLockByServer, {
      serverSecret: secret, leaseToken: 'or-only', now: 2, success: true, partial: true,
    })
    expect((await convex.query(api.platform.overlayFreeSafety.getRefreshStateByServer, {
      serverSecret: secret, now: 3,
    })).due).toBe(true)
    await convex.mutation(api.platform.overlayFreeSafety.acquireRefreshLockByServer, {
      serverSecret: secret, leaseToken: 'full', now: 3, leaseMs: 300_000, retryMs: 300_000,
    })
    await convex.mutation(api.platform.overlayFreeSafety.releaseRefreshLockByServer, {
      serverSecret: secret, leaseToken: 'full', now: 100_000, success: true,
    })
    expect((await convex.query(api.platform.overlayFreeSafety.getRefreshStateByServer, {
      serverSecret: secret, now: 3_600_000,
    })).due).toBe(true)
  })

  test('authenticates server operations and atomically grants one user lease', async () => {
    const convex = convexTest(schema, modules)
    await expect(convex.mutation(api.platform.overlayFreeSafety.acquireRefreshLockByServer, {
      serverSecret: 'wrong', leaseToken: 'x', now: 1, leaseMs: 300_000, retryMs: 300_000,
    })).rejects.toThrow()
    const row = await lockAndPublish(convex)
    const [first, second] = await Promise.all([
      convex.mutation(api.platform.overlayFreeSafety.claimByServer, {
        serverSecret: secret, routeKey: row.routeKey, leaseToken: 'lease-1', now: 2,
        leaseMs: 180_000, purpose: 'user', expectedGeneration: row.generation,
      }),
      convex.mutation(api.platform.overlayFreeSafety.claimByServer, {
        serverSecret: secret, routeKey: row.routeKey, leaseToken: 'lease-2', now: 3,
        leaseMs: 180_000, purpose: 'user', expectedGeneration: row.generation,
      }),
    ])
    expect(first.status).toBe('claimed')
    expect(first.route?.activeLeaseToken).toBe('lease-1')
    expect(second.status).toBe('busy')
  })

  test('canary claims require the current generation and live refresh token', async () => {
    const convex = convexTest(schema, modules)
    const lock = await convex.mutation(api.platform.overlayFreeSafety.acquireRefreshLockByServer, {
      serverSecret: secret, leaseToken: 'refresh-current', now: 1, leaseMs: 300_000, retryMs: 300_000,
    })
    const row = route(lock!.generation)
    await convex.mutation(api.platform.overlayFreeSafety.publishByServer, {
      serverSecret: secret, generation: lock!.generation, refreshToken: 'refresh-current',
      now: 1, routes: [row],
    })
    const wrongToken = await convex.mutation(api.platform.overlayFreeSafety.claimByServer, {
      serverSecret: secret, routeKey: row.routeKey, leaseToken: 'canary-wrong', now: 2,
      leaseMs: 180_000, purpose: 'canary', expectedGeneration: lock!.generation,
      refreshToken: 'refresh-old',
    })
    const staleGeneration = await convex.mutation(api.platform.overlayFreeSafety.claimByServer, {
      serverSecret: secret, routeKey: row.routeKey, leaseToken: 'canary-stale', now: 2,
      leaseMs: 180_000, purpose: 'canary', expectedGeneration: lock!.generation - 1,
      refreshToken: 'refresh-current',
    })
    expect(wrongToken.status).toBe('missing')
    expect(staleGeneration.status).toBe('missing')
    const current = await convex.mutation(api.platform.overlayFreeSafety.claimByServer, {
      serverSecret: secret, routeKey: row.routeKey, leaseToken: 'canary-current', now: 2,
      leaseMs: 180_000, purpose: 'canary', expectedGeneration: lock!.generation,
      refreshToken: 'refresh-current',
    })
    expect(current.status).toBe('claimed')
    await convex.mutation(api.platform.overlayFreeSafety.settleByServer, {
      serverSecret: secret, routeKey: row.routeKey, leaseToken: 'canary-current', now: 3,
      receiptJson: JSON.stringify({ safe: true, cost: 0, actualModelId: row.modelId, actualProvider: row.provider }),
      safe: true, cost: 0, actualModelId: row.modelId, actualProvider: row.provider,
    })
    await convex.mutation(api.platform.overlayFreeSafety.releaseRefreshLockByServer, {
      serverSecret: secret, leaseToken: 'refresh-current', now: 4, success: true,
    })
    const afterRelease = await convex.mutation(api.platform.overlayFreeSafety.claimByServer, {
      serverSecret: secret, routeKey: row.routeKey, leaseToken: 'canary-late', now: 5,
      leaseMs: 180_000, purpose: 'canary', expectedGeneration: lock!.generation,
      refreshToken: 'refresh-current',
    })
    expect(afterRelease.status).toBe('missing')
  })

  test('user claims reject an expired Gateway canary', async () => {
    const convex = convexTest(schema, modules)
    const lock = await convex.mutation(api.platform.overlayFreeSafety.acquireRefreshLockByServer, {
      serverSecret: secret, leaseToken: 'refresh-1', now: 1, leaseMs: 300_000, retryMs: 300_000,
    })
    const row = { ...route(lock!.generation), canaryExpiresAt: 3 }
    await convex.mutation(api.platform.overlayFreeSafety.publishByServer, {
      serverSecret: secret, generation: lock!.generation, refreshToken: 'refresh-1',
      now: 1, routes: [row],
    })
    const claim = await convex.mutation(api.platform.overlayFreeSafety.claimByServer, {
      serverSecret: secret, routeKey: row.routeKey, leaseToken: 'user-1', now: 4,
      leaseMs: 180_000, purpose: 'user', expectedGeneration: lock!.generation,
    })
    expect(claim.status).toBe('missing')
  })

  test('refresh invalidates old route authorization and stale publishers cannot publish', async () => {
    const convex = convexTest(schema, modules)
    const row = await lockAndPublish(convex)
    const refreshed = await convex.mutation(api.platform.overlayFreeSafety.acquireRefreshLockByServer, {
      serverSecret: secret, leaseToken: 'refresh-2', now: 3_600_002, leaseMs: 300_000, retryMs: 300_000,
    })
    expect(refreshed).not.toBeNull()
    const old = await convex.mutation(api.platform.overlayFreeSafety.claimByServer, {
      serverSecret: secret, routeKey: row.routeKey, leaseToken: 'lease-old', now: 3_600_003,
      leaseMs: 180_000, purpose: 'user', expectedGeneration: row.generation,
    })
    expect(old.status).not.toBe('claimed')
    await convex.mutation(api.platform.overlayFreeSafety.releaseRefreshLockByServer, {
      serverSecret: secret, leaseToken: 'refresh-2', now: 3_600_004, success: true,
    })
    await convex.mutation(api.platform.overlayFreeSafety.publishByServer, {
      serverSecret: secret, generation: refreshed!.generation, refreshToken: 'refresh-2',
      now: 3_600_005, routes: [route(refreshed!.generation)],
    })
    const state = await convex.query(api.platform.overlayFreeSafety.getByServer, {
      serverSecret: secret, routeKey: row.routeKey,
    })
    expect(state?.catalogExpiresAt).toBe(0)
  })

  test('expired unresolved leases quarantine and late safe receipts cannot clear quarantine', async () => {
    const convex = convexTest(schema, modules)
    const row = await lockAndPublish(convex)
    const claimed = await convex.mutation(api.platform.overlayFreeSafety.claimByServer, {
      serverSecret: secret, routeKey: row.routeKey, leaseToken: 'lease-1', now: 2,
      leaseMs: 180_000, purpose: 'user', expectedGeneration: row.generation,
    })
    expect(claimed.status).toBe('claimed')
    await convex.mutation(api.platform.overlayFreeSafety.quarantineExpiredLeasesByServer, {
      serverSecret: secret, now: 180_003,
    })
    const late = await convex.mutation(api.platform.overlayFreeSafety.settleByServer, {
      serverSecret: secret, routeKey: row.routeKey, leaseToken: 'lease-1', now: 180_004,
      receiptJson: JSON.stringify({ safe: true, cost: 0 }), safe: true, cost: 0,
      actualModelId: row.modelId, actualProvider: row.provider,
    })
    expect(late.status).toBe('late')
    const stored = await convex.query(api.platform.overlayFreeSafety.getByServer, {
      serverSecret: secret, routeKey: row.routeKey,
    })
    expect(stored?.quarantineReason).toBe('missing receipt')
  })

  test('refresh cannot clear a permanent quarantine', async () => {
    const convex = convexTest(schema, modules)
    const row = await lockAndPublish(convex)
    const claimed = await convex.mutation(api.platform.overlayFreeSafety.claimByServer, {
      serverSecret: secret, routeKey: row.routeKey, leaseToken: 'lease-1', now: 2,
      leaseMs: 180_000, purpose: 'user', expectedGeneration: row.generation,
    })
    await convex.mutation(api.platform.overlayFreeSafety.settleByServer, {
      serverSecret: secret, routeKey: row.routeKey, leaseToken: 'lease-1', now: 3,
      receiptJson: JSON.stringify({ safe: false, cost: 0, reason: 'unsafe receipt' }),
      safe: false, cost: 0, actualModelId: row.modelId, actualProvider: row.provider,
      reason: 'unsafe receipt',
    })
    expect(claimed.status).toBe('claimed')
    const refreshed = await convex.mutation(api.platform.overlayFreeSafety.acquireRefreshLockByServer, {
      serverSecret: secret, leaseToken: 'refresh-2', now: 3_600_002, leaseMs: 300_000, retryMs: 300_000,
    })
    await convex.mutation(api.platform.overlayFreeSafety.publishByServer, {
      serverSecret: secret, generation: refreshed!.generation, refreshToken: 'refresh-2',
      now: 3_600_003, routes: [route(refreshed!.generation)],
    })
    const stored = await convex.query(api.platform.overlayFreeSafety.getByServer, {
      serverSecret: secret, routeKey: row.routeKey,
    })
    expect(stored?.quarantineReason).toBe('unsafe receipt')
  })

  test('settlement cannot trust a zero top-level cost over a nonzero normalized receipt', async () => {
    const convex = convexTest(schema, modules)
    const row = await lockAndPublish(convex)
    await convex.mutation(api.platform.overlayFreeSafety.claimByServer, {
      serverSecret: secret, routeKey: row.routeKey, leaseToken: 'lease-1', now: 2,
      leaseMs: 180_000, purpose: 'user', expectedGeneration: row.generation,
    })
    await convex.mutation(api.platform.overlayFreeSafety.settleByServer, {
      serverSecret: secret, routeKey: row.routeKey, leaseToken: 'lease-1', now: 3,
      receiptJson: JSON.stringify({
        safe: true, cost: 0.01, reason: 'Nonzero provider charge',
        actualModelId: row.modelId, actualProvider: row.provider,
      }),
      safe: true, cost: 0, actualModelId: row.modelId, actualProvider: row.provider,
    })
    const stored = await convex.query(api.platform.overlayFreeSafety.getByServer, {
      serverSecret: secret, routeKey: row.routeKey,
    })
    expect(stored?.quarantineReason).toBe('Nonzero provider charge')
    expect(stored?.latestReceiptJson).toBe(JSON.stringify({
      safe: true, cost: 0.01, reason: 'Nonzero provider charge',
      actualModelId: row.modelId, actualProvider: row.provider,
    }))
  })
})
