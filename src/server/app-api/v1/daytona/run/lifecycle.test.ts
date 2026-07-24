import assert from 'node:assert/strict'
import test from 'node:test'
import type { Entitlements } from '@/shared/app/app-contracts'
import { finalizeDaytonaRunMetering, reserveDaytonaRunBudget } from './lifecycle'

const paidEntitlements = {
  tier: 'pro',
  planKind: 'paid',
  creditsUsed: 0,
  creditsTotal: 0,
  dailyUsage: { ask: 0, write: 0, agent: 0 },
} as Entitlements
const requestIdentity = {
  operationId: 'sandbox.daytona-run',
  requestFingerprint: 'daytona-test-fingerprint',
}

test('reserveDaytonaRunBudget preserves auth and paid-plan error payloads', async () => {
  assert.deepEqual(await reserveDaytonaRunBudget({
    userId: 'user_1',
    maxDurationSeconds: 300,
    ...requestIdentity,
    deps: { getEntitlementsByServer: async () => null },
  }), {
    ok: false,
    payload: { error: 'Unauthorized', message: 'Could not verify subscription. Try signing out and back in.' },
    status: 401,
  })

  assert.deepEqual(await reserveDaytonaRunBudget({
    userId: 'user_1',
    maxDurationSeconds: 300,
    ...requestIdentity,
    deps: {
      getEntitlementsByServer: async () => paidEntitlements,
      isPaidPlan: () => false,
    },
  }), {
    ok: false,
    payload: { error: 'sandbox_not_allowed', message: 'Daytona sandbox execution requires a paid plan.' },
    status: 403,
  })
})

test('reserveDaytonaRunBudget preserves insufficient-credit and provider-reservation responses', async () => {
  const insufficient = await reserveDaytonaRunBudget({
    userId: 'user_1',
    maxDurationSeconds: 300,
    ...requestIdentity,
    deps: {
      getEntitlementsByServer: async () => paidEntitlements,
      isPaidPlan: () => true,
      getBudgetTotals: (() => ({ remainingCents: 0 })) as never,
      ensureBudgetAvailable: (async () => ({ entitlements: paidEntitlements })) as never,
    },
  })
  assert.equal(insufficient.ok, false)
  assert.equal(insufficient.ok ? null : insufficient.status, 402)
  assert.equal(insufficient.ok ? null : insufficient.payload.error, 'insufficient_credits')
  assert.equal(
    insufficient.ok ? null : insufficient.payload.message,
    'No budget remaining. Please top up your account.',
  )

  assert.deepEqual(await reserveDaytonaRunBudget({
    userId: 'user_1',
    maxDurationSeconds: 300,
    ...requestIdentity,
    deps: {
      getEntitlementsByServer: async () => paidEntitlements,
      isPaidPlan: () => true,
      getBudgetTotals: (() => ({ remainingCents: 10 })) as never,
      reserveProviderBudget: (async () => ({
        ok: false,
        code: 'budget_exceeded',
        payload: { message: 'Budget exceeded' },
        status: 402,
      })) as never,
    },
  }), {
    ok: false,
    payload: { message: 'Budget exceeded', error: 'budget_exceeded' },
    status: 402,
  })
})

test('reserveDaytonaRunBudget reserves sandbox budget with current entitlement snapshot', async () => {
  const reserveCalls: Array<Record<string, unknown>> = []
  const result = await reserveDaytonaRunBudget({
    userId: 'user_1',
    maxDurationSeconds: 300,
    ...requestIdentity,
    deps: {
      getEntitlementsByServer: async () => paidEntitlements,
      isPaidPlan: () => true,
      getBudgetTotals: (() => ({ remainingCents: 25 })) as never,
      reserveProviderBudget: (async (args: Record<string, unknown>) => {
        reserveCalls.push(args)
        return { ok: true, reservationId: 'reservation_1' }
      }) as never,
    },
  })

  assert.deepEqual(result, { ok: true, reservationId: 'reservation_1' })
  assert.equal(reserveCalls.length, 1)
  assert.equal(reserveCalls[0]?.userId, 'user_1')
  assert.equal(reserveCalls[0]?.kind, 'sandbox')
  assert.equal(reserveCalls[0]?.modelId, 'daytona/pro')
  assert.equal(typeof reserveCalls[0]?.providerCostUsd, 'number')
})

test('finalizeDaytonaRunMetering releases budget when metered spend is accrued', async () => {
  const releases: Array<Record<string, unknown>> = []

  await finalizeDaytonaRunMetering({
    workspaceRun: { workspace: { id: 'workspace_1' }, sandbox: { id: 'sandbox_1' } } as never,
    meteringStartedAt: 100,
    meteringEndedAt: 200,
    reservationId: 'reservation_1',
    userId: 'user_1',
    deps: {
      accrueWorkspaceSpend: (async () => ({ success: true })) as never,
      releaseProviderBudgetReservation: (async (args: Record<string, unknown>) => {
        releases.push(args)
      }) as never,
    },
  })

  assert.deepEqual(releases, [{
    userId: 'user_1',
    reservationId: 'reservation_1',
    reason: 'daytona_actual_usage_accrued',
  }])
})

test('finalizeDaytonaRunMetering preserves reconcile and no-meter fallback paths', async () => {
  const originalConsoleError = console.error
  console.error = () => {}
  const reconciles: Array<Record<string, unknown>> = []
  const releases: Array<Record<string, unknown>> = []
  try {
    await finalizeDaytonaRunMetering({
      workspaceRun: { workspace: { id: 'workspace_1' }, sandbox: { id: 'sandbox_1' } } as never,
      meteringStartedAt: 100,
      meteringEndedAt: 200,
      reservationId: 'reservation_1',
      userId: 'user_1',
      deps: {
        accrueWorkspaceSpend: (async () => {
          throw new Error('metering failed')
        }) as never,
        markProviderBudgetReconcile: (async (args: Record<string, unknown>) => {
          reconciles.push(args)
        }) as never,
      },
    })

    await finalizeDaytonaRunMetering({
      workspaceRun: null,
      meteringStartedAt: null,
      meteringEndedAt: null,
      reservationId: 'reservation_2',
      userId: 'user_1',
      deps: {
        releaseProviderBudgetReservation: (async (args: Record<string, unknown>) => {
          releases.push(args)
        }) as never,
      },
    })
  } finally {
    console.error = originalConsoleError
  }

  assert.deepEqual(reconciles, [{
    userId: 'user_1',
    reservationId: 'reservation_1',
    errorMessage: 'metering failed',
  }])
  assert.deepEqual(releases, [{
    userId: 'user_1',
    reservationId: 'reservation_2',
    reason: 'daytona_no_metered_runtime',
  }])
})
