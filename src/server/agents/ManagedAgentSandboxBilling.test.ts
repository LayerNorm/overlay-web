import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentSandboxLease } from '@overlay/workspace-contracts'
import type { SandboxInstance, SandboxRuntime, SandboxUsage } from '@overlay/sandbox-runtime'
import {
  ManagedAgentSandboxBilling,
  SANDBOX_METER_DELAY_ALERT_MS,
  sandboxCostUsd,
} from './ManagedAgentSandboxBilling'
import type { SandboxAlertContext, SandboxAlertType } from '@/server/observability/sandbox-alerts'
import { E2B_COMPUTE_PRICE } from './sandbox-execution-accounting'

test('execution metering settles completed E2B time and reserves resumed time with actual resources', async () => {
  const calls: Array<Record<string, unknown>> = []
  const first = { id: 'sandbox-reference:0', startedAt: 0, wallTimeMs: 30_000, complete: false, resources: { vcpus: 2, memoryGiB: 0.5 } }
  const lease = leaseFixture({
    provider: 'e2b',
    usage: {
      resources: { vcpus: 8, memoryGiB: 16, diskGiB: 20 },
      meteredUsage: { executionCursor: { [first.id]: first }, executionPrice: E2B_COMPUTE_PRICE },
      meteredProviderReference: 'sandbox-reference', meterVersion: 1,
      lastPayer: { scope: 'workspace', userId: 'user', workspaceId: 'workspace', billingAccountId: 'billing' },
    },
  })
  const sample = {
    executions: [
      { ...first, wallTimeMs: 60_000, complete: true },
      { ...first, id: 'sandbox-reference:100000', startedAt: 100_000, wallTimeMs: 20_000 },
    ],
    wallTimeMs: 20_000,
  }
  const service = new ManagedAgentSandboxBilling({
    now: () => 120_000, policy: {} as never,
    runtime: () => ({ ...runtimeWithUsage(() => sample), provider: 'e2b' }),
    repository: {
      meterSandboxLease: async (input: Record<string, unknown>) => { calls.push(input); return { applied: true, meterVersion: 2 } },
    } as never,
  })
  await service.meterLease(lease, { idleStop: 'none' })
  const charge = calls[0]?.charge as { providerCostUsd: number; durationSeconds: number }
  assert.equal(charge.durationSeconds, 60)
  assert.ok(Math.abs(charge.providerCostUsd - 0.001815) < 1e-12)
  const holdCents = calls[0]?.runtimeHoldCents as number
  assert.ok(holdCents >= 0.00968 * 125)
  assert.equal(calls[0]?.expectedMeterVersion, 1)
})

test('authoritative weighted Boat seconds are never replaced by unweighted wall-clock estimates', async () => {
  const calls: Array<Record<string, unknown>> = []
  const snapshot = {
    wallTimeMs: 30_000,
    providerMetrics: {
      authoritativeCounter: true, reportedUsd: 0, secondsPerDollar: 100_000,
      billingMultiplier: 1, running: false,
    },
  }
  const lease = leaseFixture({
    provider: 'box', usage: {
      meteredUsage: snapshot, meterVersion: 1, meteredAt: 60_000,
      meteredProviderReference: 'sandbox-reference',
      lastPayer: { scope: 'personal', userId: 'user', billingAccountId: 'billing' },
    },
  })
  const service = new ManagedAgentSandboxBilling({
    now: () => 120_000, policy: {} as never,
    runtime: () => ({ ...runtimeWithUsage(() => snapshot), provider: 'box' }),
    repository: {
      meterSandboxLease: async (input: Record<string, unknown>) => { calls.push(input); return { applied: true, meterVersion: 2 } },
    } as never,
  })
  await service.meterLease(lease, { idleStop: 'none' })
  assert.equal(calls[0]?.charge, undefined)
  assert.equal((calls[0]?.meteredUsage as { wallTimeMs: number }).wallTimeMs, 30_000)
})

test('only a successfully reserved runtime tick renews the provider safety fence', async () => {
  const renewals: number[] = []
  let applied = true
  const lease = leaseFixture({ provider: 'e2b', reservedUntil: 1_000_000, usage: {
    meteredUsage: {}, meteredProviderReference: 'sandbox-reference', meterVersion: 0,
    lastPayer: { scope: 'workspace', userId: 'user', workspaceId: 'workspace', billingAccountId: 'billing' },
  } })
  const service = new ManagedAgentSandboxBilling({
    now: () => 120_000, policy: {} as never,
    runtime: () => ({ ...runtimeWithUsage(() => ({ wallTimeMs: 20_000 })), provider: 'e2b', reconnect: async () => ({
      status: async () => 'running',
      usage: async () => ({ executions: [{ id: 'sandbox-reference:100000', startedAt: 100_000, wallTimeMs: 20_000, complete: false, resources: { vcpus: 2, memoryGiB: 0.5 } }] }),
      renewRuntime: async (ms: number) => { renewals.push(ms) },
    }) as SandboxInstance }),
    repository: { meterSandboxLease: async () => applied ? { applied: true, meterVersion: 1 } : { applied: false, reason: 'insufficient_budget' } } as never,
  })
  await service.meterLease(lease, { idleStop: 'none' })
  assert.deepEqual(renewals, [240_000])
  applied = false
  await service.meterLease(lease, { idleStop: 'none' })
  assert.deepEqual(renewals, [240_000])
})

test('an active Computer action still meters and renews after four minutes', async () => {
  const renewals: number[] = []
  const lease = leaseFixture({
    provider: 'box', computerId: 'computer-1', status: 'running', reservedUntil: 2_000_000,
    usage: {
      meteredAt: 0, meteredUsage: {}, meteredProviderReference: 'sandbox-reference', meterVersion: 0,
      lastPayer: { scope: 'workspace', userId: 'user', workspaceId: 'workspace', billingAccountId: 'billing' },
    },
  })
  const usage = boatUsage(300_000)
  const runtime = {
    ...runtimeWithUsage(() => usage),
    reconnect: async () => ({
      status: async () => 'running' as const,
      usage: async () => usage,
      renewRuntime: async (ms: number) => { renewals.push(ms) },
    }) as SandboxInstance,
  }
  let claimed = false
  let meterCalls = 0
  const service = new ManagedAgentSandboxBilling({
    now: () => 300_000, policy: {} as never, runtime: () => runtime,
    computerLeaseHandler: async (_lease, reason) => ({
      leaseId: 'computer:computer-1', outcome: 'skipped', reason: reason === 'idle_check' ? 'computer_active' : reason,
    }),
    repository: {
      claimSandboxLeases: async () => {
        if (claimed) return { leases: [], deferred: false }
        claimed = true
        return { leases: [lease], deferred: false }
      },
      getSandboxLease: async () => lease,
      finishSandboxLeaseClaim: async () => true,
      meterSandboxLease: async () => { meterCalls += 1; return { applied: true, meterVersion: 1 } },
    } as never,
  })
  const { ticks } = await service.meterLeases()
  assert.equal(ticks[0]?.outcome, 'adopted')
  assert.equal(meterCalls, 1)
  assert.deepEqual(renewals, [240_000])
})

test('active Computer leases reconcile lifecycle intents before ordinary metering', async () => {
  const now = 300_000
  const leases = [
    leaseFixture({
      id: 'computer:live-reserved', computerId: 'live-reserved', status: 'reserved',
      usage: { computerLifecycle: { maintenance: { kind: 'provision', token: 'live', expiresAt: now + 1_000 } } },
    }),
    leaseFixture({
      id: 'computer:live-provisioning', computerId: 'live-provisioning', status: 'provisioning',
      usage: { computerLifecycle: { maintenance: { kind: 'wake', token: 'live', expiresAt: now + 1_000 } } },
    }),
    leaseFixture({
      id: 'computer:expired-provision', computerId: 'expired-provision', status: 'reserved',
      usage: { computerLifecycle: { maintenance: { kind: 'provision', token: 'expired', expiresAt: now - 1 } } },
    }),
    leaseFixture({
      id: 'computer:expired-wake', computerId: 'expired-wake', status: 'provisioning',
      usage: { computerLifecycle: { maintenance: { kind: 'wake', token: 'expired', expiresAt: now - 1 } } },
    }),
  ]
  const handlerCalls: Array<{ id: string; reason?: string }> = []
  const recoveryResults = new Map([
    ['computer:live-reserved', { leaseId: 'computer:live-reserved', outcome: 'skipped' as const, reason: 'maintenance_in_progress' }],
    ['computer:live-provisioning', { leaseId: 'computer:live-provisioning', outcome: 'skipped' as const, reason: 'maintenance_in_progress' }],
    ['computer:expired-provision', { leaseId: 'computer:expired-provision', outcome: 'adopted' as const, reason: 'provision_recovered' }],
    ['computer:expired-wake', { leaseId: 'computer:expired-wake', outcome: 'killed' as const, reason: 'expired_wake_paused' }],
  ])
  let providerProbes = 0
  let renewals = 0
  let meterCalls = 0
  let claimConsumed = false
  const runtime: SandboxRuntime = {
    provider: 'box', capabilities: {} as never,
    create: async () => { throw new Error('unexpected create') },
    reconnect: async () => {
      providerProbes += 1
      return {
        status: async () => 'stopped' as const,
        usage: async () => boatUsage(300_000, false),
        renewRuntime: async () => { renewals += 1 },
      } as SandboxInstance
    },
    restore: async () => { throw new Error('unexpected restore') },
    deleteSnapshot: async () => undefined,
  }
  const service = new ManagedAgentSandboxBilling({
    now: () => now, policy: {} as never, runtime: () => runtime,
    computerLeaseHandler: async (lease, reason) => {
      handlerCalls.push({ id: lease.id, reason })
      return recoveryResults.get(lease.id)!
    },
    repository: {
      claimSandboxLeases: async () => {
        if (claimConsumed) return { leases: [], deferred: false }
        claimConsumed = true
        return { leases, deferred: false }
      },
      getSandboxLease: async ({ leaseId }: { leaseId: string }) => leases.find((lease) => lease.id === leaseId) ?? null,
      finishSandboxLeaseClaim: async () => true,
      meterSandboxLease: async () => { meterCalls += 1; return { applied: true, meterVersion: 1 } },
    } as never,
  })

  const { ticks } = await service.meterLeases()

  assert.deepEqual(handlerCalls.map(({ id, reason }) => ({ id, reason })).sort((a, b) => a.id.localeCompare(b.id)), [
    { id: 'computer:expired-provision', reason: 'idle_check' },
    { id: 'computer:expired-wake', reason: 'idle_check' },
    { id: 'computer:live-provisioning', reason: 'idle_check' },
    { id: 'computer:live-reserved', reason: 'idle_check' },
  ])
  assert.deepEqual(ticks.map(({ leaseId, outcome, reason }) => ({ leaseId, outcome, reason })).sort((a, b) => a.leaseId.localeCompare(b.leaseId)), [
    { leaseId: 'computer:expired-provision', outcome: 'adopted', reason: 'provision_recovered' },
    { leaseId: 'computer:expired-wake', outcome: 'killed', reason: 'expired_wake_paused' },
    { leaseId: 'computer:live-provisioning', outcome: 'skipped', reason: 'maintenance_in_progress' },
    { leaseId: 'computer:live-reserved', outcome: 'skipped', reason: 'maintenance_in_progress' },
  ])
  assert.equal(providerProbes, 0)
  assert.equal(renewals, 0)
  assert.equal(meterCalls, 0)
})

test('meterLeases drains 45 leases in bounded batches and caps provider concurrency at five', async () => {
  const leases = Array.from({ length: 45 }, (_, index) => leaseFixture({
    id: `lease-${index}`,
    status: 'running',
    reservedUntil: 10_000_000,
    usage: {
      meteredAt: 0, meteredUsage: {}, meteredProviderReference: 'sandbox-reference', meterVersion: 0,
      lastPayer: { scope: 'workspace', userId: 'user', workspaceId: 'workspace', billingAccountId: 'billing' },
    },
  }))
  const batches: number[] = []
  const meteredLeaseIds: string[] = []
  let cursor = 0
  let providerCalls = 0
  let peakProviderCalls = 0
  const providerCall = async <T,>(result: T): Promise<T> => {
    providerCalls += 1
    peakProviderCalls = Math.max(peakProviderCalls, providerCalls)
    await new Promise((resolve) => setTimeout(resolve, 1))
    providerCalls -= 1
    return result
  }
  const usage = boatUsage(300_000)
  const instance = {
    status: async () => await providerCall('running' as const),
    usage: async () => await providerCall(usage),
    renewRuntime: async () => { await providerCall(undefined) },
  } as SandboxInstance
  const runtime: SandboxRuntime = {
    provider: 'box', capabilities: {} as never,
    create: async () => instance,
    reconnect: async () => instance,
    restore: async () => instance,
    deleteSnapshot: async () => undefined,
  }
  const service = new ManagedAgentSandboxBilling({
    now: () => 300_000,
    idleFallbackDue: () => false,
    policy: {} as never,
    runtime: () => runtime,
    repository: {
      claimSandboxLeases: async ({ limit }: { limit: number }) => {
        batches.push(limit)
        const claimed = leases.slice(cursor, cursor + limit)
        cursor += claimed.length
        return { leases: claimed, deferred: false }
      },
      getSandboxLease: async ({ leaseId }: { leaseId: string }) => leases.find((lease) => lease.id === leaseId) ?? null,
      finishSandboxLeaseClaim: async () => true,
      meterSandboxLease: async ({ leaseId }: { leaseId: string }) => {
        meteredLeaseIds.push(leaseId)
        return { applied: true, meterVersion: 1, remainingCents: 1_000 }
      },
    } as never,
  })

  const { ticks } = await service.meterLeases({ limit: 45 })

  assert.equal(ticks.length, 45)
  assert.equal(new Set(ticks.map((tick) => tick.leaseId)).size, 45)
  assert.deepEqual(batches, [20, 20, 5])
  assert.equal(new Set(meteredLeaseIds).size, 45)
  assert.ok(batches.every((batch) => batch <= 20))
  assert.ok(peakProviderCalls <= 5)
})

test('final stopped evidence settles after the provider resource disappears', async () => {
  const calls: Array<Record<string, unknown>> = []
  const final = { id: 'sandbox-reference:0', startedAt: 0, wallTimeMs: 60_000, complete: true, resources: { vcpus: 2, memoryGiB: 0.5 } }
  const lease = leaseFixture({ provider: 'e2b', status: 'cleanup_failed', usage: {
    meteredUsage: {}, meteredProviderReference: 'sandbox-reference', meterVersion: 0,
    lastProviderEvidence: { stopped: true, providerReference: 'sandbox-reference', observedAt: 100_000, usage: { executions: [final] } },
    lastPayer: { scope: 'workspace', userId: 'user', workspaceId: 'workspace', billingAccountId: 'billing' },
  } })
  const service = new ManagedAgentSandboxBilling({
    now: () => 120_000, policy: {} as never,
    runtime: () => ({ ...runtimeWithUsage(() => ({ wallTimeMs: 0 })), provider: 'e2b', reconnect: async () => { throw new Error('gone') } }),
    repository: {
      getActiveSandboxLease: async () => null,
      meterSandboxLease: async (input: Record<string, unknown>) => { calls.push(input); return { applied: true, meterVersion: 1 } },
    } as never,
  })
  const result = await service.meterLease(lease, { idleStop: 'none' })
  assert.equal(result.applied, true)
  assert.ok(Math.abs((calls[0]?.charge as { providerCostUsd: number }).providerCostUsd - 0.001815) < 1e-12)
  assert.equal(calls[0]?.runtimeHoldCents, 0)
})

test('reserve holds a bootstrap reservation and records the payer on the lease', async () => {
  const reservationArgs: Array<Record<string, unknown>> = []
  const usagePatches: Array<Record<string, unknown>> = []
  const policy = {
    reserve: async (args: Record<string, unknown>) => {
      reservationArgs.push(args)
      return { ok: true as const, billingAccountId: 'billing', reservationId: 'sandbox-reservation', reservedCents: 10, entitlements: {} }
    },
  }
  const service = new ManagedAgentSandboxBilling({
    now: () => 5_000,
    policy: policy as never,
    repository: {
      environmentHasActiveRuns: async () => false,
      getActiveSandboxLease: async () => leaseFixture({
        usage: { resources: { vcpus: 2, memoryGiB: 4, diskGiB: 20 }, meteredUsage: {}, meterVersion: 0 },
      }),
      patchSandboxLeaseUsage: async (args: { patch: Record<string, unknown> }) => {
        usagePatches.push(args.patch)
        return leaseFixture({})
      },
    } as never,
    runtime: () => runtimeWithUsage(() => ({ wallTimeMs: 1_000, activeCpuTimeMs: 500 })),
  })
  const billing = await service.reserve({
    agentId: 'agent', entitlements: {} as never, environmentId: 'environment',
    idempotencyKey: 'turn:sandbox', operationId: 'sandbox:run',
    requestFingerprint: 'fingerprint', userId: 'user', workspaceId: 'workspace',
  })
  assert.equal(reservationArgs[0]?.kind, 'sandbox')
  assert.equal(reservationArgs[0]?.programmaticSubjectId, 'agent:agent')
  // The hold is markup(coverage) + the $1 low-balance floor — a few dollars,
  // not the ~$15 worst-case 24h reservation.
  const providerCostUsd = reservationArgs[0]?.providerCostUsd as number
  assert.equal(providerCostUsd > 0.8 && providerCostUsd < 2.5, true)
  assert.equal(billing.leaseId, 'lease')
  // The payer write is best-effort: resolving needs the app context, which is
  // absent under test — either zero or one patch, never a throw.
  assert.equal(usagePatches.length <= 1, true)
  // A starting turn cancels the machine's idle timer.
  if (usagePatches[0]) assert.equal(usagePatches[0].idleToken, null)
})

test('meterLease debits the usage delta against the lease cursor', async () => {
  const meterCalls: Array<Record<string, unknown>> = []
  const usage = {
    wallTimeMs: 130_000, activeCpuTimeMs: 60_000,
    providerMetrics: { ...boatUsage(130_000).providerMetrics, reportedUsd: 0.01 },
  }
  const lease = leaseFixture({
    usage: {
      resources: { vcpus: 2, memoryGiB: 4, diskGiB: 20 },
      meteredUsage: {
        wallTimeMs: 60_000, activeCpuTimeMs: 30_000,
        providerMetrics: { ...boatUsage(60_000).providerMetrics, reportedUsd: 0 },
        boatCursor: boatCursor(60, 0, 60_000),
      },
      meteredProviderReference: 'sandbox-reference',
      meteredAt: 60_000,
      meterVersion: 3,
      lastPayer: { scope: 'personal', userId: 'user', billingAccountId: 'billing' },
    },
  })
  const service = new ManagedAgentSandboxBilling({
    now: () => 190_000,
    policy: {} as never,
    repository: {
      patchSandboxLeaseUsage: async () => null,
      environmentHasActiveRuns: async () => false,
      meterSandboxLease: async (args: Record<string, unknown>) => {
        meterCalls.push(args)
        return { applied: true as const, meterVersion: 4, remainingCents: 500 }
      },
    } as never,
    runtime: () => runtimeWithUsage(() => usage),
  })
  const result = await service.meterLease(lease)
  assert.equal(result.applied, true)
  const call = meterCalls[0]!
  assert.equal(call.expectedMeterVersion, 3)
  const meteredUsage = call.meteredUsage as Record<string, unknown>
  assert.equal(meteredUsage.wallTimeMs, usage.wallTimeMs)
  assert.equal((meteredUsage.boatCursor as { billableSeconds: number }).billableSeconds, 130)
  assert.equal(call.meteredProviderReference, 'sandbox-reference')
  assert.equal(call.minRemainingCents, 100)
  const charge = call.charge as { costCents: number; providerCostUsd: number; durationSeconds: number }
  // Delta: 70s wall + 30s CPU since the cursor.
  assert.equal(charge.durationSeconds, 70)
  assert.equal(charge.providerCostUsd > 0, true)
  assert.equal(charge.costCents > 0, true)
})

test('meterLease adopts current counters for a legacy lease without charging', async () => {
  const meterCalls: Array<Record<string, unknown>> = []
  const lease = leaseFixture({
    usage: {
      resources: { vcpus: 2, memoryGiB: 4, diskGiB: 20 },
      lastPayer: { scope: 'personal', userId: 'user', billingAccountId: 'billing' },
    },
  })
  const service = new ManagedAgentSandboxBilling({
    now: () => 190_000,
    policy: {} as never,
    repository: {
      patchSandboxLeaseUsage: async () => null,
      environmentHasActiveRuns: async () => false,
      meterSandboxLease: async (args: Record<string, unknown>) => {
        meterCalls.push(args)
        return { applied: true as const, meterVersion: 1 }
      },
      getEnvironment: async () => null,
    } as never,
    runtime: () => runtimeWithUsage(() => ({ wallTimeMs: 3_600_000, activeCpuTimeMs: 60_000 })),
  })
  const result = await service.meterLease(lease)
  assert.equal(result.applied, true)
  assert.equal(meterCalls[0]!.charge, undefined)
  const meteredUsage = meterCalls[0]!.meteredUsage as Record<string, unknown>
  assert.equal(meteredUsage.wallTimeMs, 3_600_000)
  assert.equal((meteredUsage.boatCursor as { billableSeconds: number }).billableSeconds, 3_600)
})

test('meterLease bills a repointed sandbox from zero', async () => {
  const meterCalls: Array<Record<string, unknown>> = []
  const lease = leaseFixture({
    providerReference: 'recreated-sandbox',
    usage: {
      resources: { vcpus: 2, memoryGiB: 4, diskGiB: 20 },
      meteredUsage: { wallTimeMs: 3_600_000 },
      meteredProviderReference: 'destroyed-sandbox',
      meterVersion: 7,
      lastPayer: { scope: 'personal', userId: 'user', billingAccountId: 'billing' },
    },
  })
  const service = new ManagedAgentSandboxBilling({
    now: () => 190_000,
    policy: {} as never,
    repository: {
      patchSandboxLeaseUsage: async () => null,
      environmentHasActiveRuns: async () => false,
      meterSandboxLease: async (args: Record<string, unknown>) => {
        meterCalls.push(args)
        return { applied: true as const, meterVersion: 8, remainingCents: 900 }
      },
    } as never,
    runtime: () => runtimeWithUsage(() => ({
      wallTimeMs: 120_000,
      providerMetrics: { ...boatUsage(120_000).providerMetrics, reportedUsd: 0.01 },
    })),
  })
  const result = await service.meterLease(lease)
  assert.equal(result.applied, true)
  const charge = meterCalls[0]!.charge as { durationSeconds: number }
  assert.equal(charge.durationSeconds, 120)
})

for (const [declined, expected] of [['insufficient_budget', 'budget_exhausted'], ['paid_plan_required', 'paid_plan_required']] as const) test(`meterLeases kills a lease when the meter debit is declined (${declined})`, async () => {
  const deletes: string[] = []
  const stopped: string[] = []
  const released: Array<Record<string, unknown>> = []
  const lease = leaseFixture({
    reservedUntil: 1_000_000,
    usage: {
      meteredUsage: { wallTimeMs: 0 },
      meteredProviderReference: 'sandbox-reference',
      meterVersion: 2,
      lastPayer: { scope: 'personal', userId: 'user', billingAccountId: 'billing' },
    },
  })
  const runtime: SandboxRuntime = {
    provider: 'box', capabilities: {} as never,
    create: async () => { throw new Error('unreachable') },
    reconnect: async () => ({
      status: async () => 'stopped' as const,
      usage: async () => boatUsage(60_000, false),
      delete: async () => { deletes.push('sandbox-reference') },
    }) as SandboxInstance,
    restore: async () => { throw new Error('unreachable') },
    deleteSnapshot: async () => undefined,
  }
  let stopping = false
  const service = new ManagedAgentSandboxBilling({
    now: () => 190_000,
    policy: {} as never,
    repository: {
      patchSandboxLeaseUsage: async () => null,
      environmentHasActiveRuns: async () => false,
      listSandboxLeases: async (args: { statuses: string[] }) => args.statuses.includes('running') ? [lease] : [],
      getSandboxLease: async () => lease,
      meterSandboxLease: async () => ({ applied: false as const, reason: declined, remainingCents: 12 }),
      stopSandboxLease: async () => { stopping = true; stopped.push('lease'); return { ...lease, status: 'stopping' as const } },
      updateSandboxLease: async (args: Record<string, unknown>) => {
        released.push(args)
        return { ...lease, status: args.status }
      },
    } as never,
    runtime: () => runtime,
  })
  const { ticks } = await service.meterLeases()
  assert.equal(ticks[0]?.outcome, 'killed')
  assert.equal(ticks[0]?.reason, expected)
  assert.equal(stopping, true)
  assert.deepEqual(deletes, [])
  assert.equal(released.at(-1)?.status, 'cleanup_failed', 'Unsettled final cost retains the resource reference for reconciliation')
})

test('meterLeases kills a lease when remaining balance falls under the floor', async () => {
  const lease = leaseFixture({
    reservedUntil: 1_000_000,
    usage: {
      meteredUsage: { wallTimeMs: 0 },
      meteredProviderReference: 'sandbox-reference',
      meterVersion: 0,
      lastPayer: { scope: 'personal', userId: 'user', billingAccountId: 'billing' },
    },
  })
  const runtime: SandboxRuntime = {
    provider: 'box', capabilities: {} as never,
    create: async () => { throw new Error('unreachable') },
    reconnect: async () => ({
      status: async () => 'stopped' as const,
      usage: async () => boatUsage(30_000, false),
      delete: async () => undefined,
    }) as SandboxInstance,
    restore: async () => { throw new Error('unreachable') },
    deleteSnapshot: async () => undefined,
  }
  const stopReasons: string[] = []
  const service = new ManagedAgentSandboxBilling({
    now: () => 190_000,
    policy: {} as never,
    repository: {
      patchSandboxLeaseUsage: async () => null,
      environmentHasActiveRuns: async () => false,
      listSandboxLeases: async (args: { statuses: string[] }) => args.statuses.includes('running') ? [lease] : [],
      getSandboxLease: async () => lease,
      meterSandboxLease: async () => ({ applied: true as const, meterVersion: 1, remainingCents: 42 }),
      stopSandboxLease: async (args: { reason: string }) => { stopReasons.push(args.reason); return { ...lease, status: 'stopping' as const } },
      updateSandboxLease: async () => lease,
    } as never,
    runtime: () => runtime,
  })
  const { ticks } = await service.meterLeases()
  assert.equal(ticks[0]?.outcome, 'killed')
  assert.equal(ticks[0]?.reason, 'low_balance')
  assert.deepEqual(stopReasons, ['low_balance'])
})

test('cleanup requires stopped-state proof before final metering and deletion', async () => {
  const updates: Array<Record<string, unknown>> = []
  const deletes: string[] = []
  const lease = leaseFixture({ status: 'stopping', cleanupAfter: 100_000 })
  const runtime: SandboxRuntime = {
    provider: 'box', capabilities: {} as never,
    create: async () => { throw new Error('unreachable') },
    reconnect: async () => ({
      usage: async () => boatUsage(60_000, false),
      delete: async () => { deletes.push('sandbox-reference') },
    }) as SandboxInstance,
    restore: async () => { throw new Error('unreachable') },
    deleteSnapshot: async () => undefined,
  }
  const service = new ManagedAgentSandboxBilling({
    now: () => 190_000,
    policy: {} as never,
    repository: {
      patchSandboxLeaseUsage: async () => null,
      environmentHasActiveRuns: async () => false,
      listSandboxLeases: async (args: { statuses: string[] }) => args.statuses.includes('stopping') ? [lease] : [],
      getSandboxLease: async () => lease,
      meterSandboxLease: async () => ({ applied: true as const, meterVersion: 2 }),
      updateSandboxLease: async (args: Record<string, unknown>) => {
        updates.push(args)
        return { ...lease, status: args.status }
      },
    } as never,
    runtime: () => runtime,
  })
  const { ticks } = await service.meterLeases()
  assert.equal(ticks[0]?.outcome, 'cleanup_failed')
  assert.equal(updates.at(-1)?.status, 'cleanup_failed')
  assert.deepEqual(deletes, [])
})

test('meterLeases reaps a running lease past its reserved window even when the sandbox answers', async () => {
  // A lease past reservedUntil hit the hard runtime limit: the sandbox may
  // still be reachable, but billing attempts must stop and the lease reaped.
  const events: string[] = []
  const lease = leaseFixture({
    reservedUntil: 100_000,
    usage: {
      meteredUsage: { wallTimeMs: 60_000 },
      meteredProviderReference: 'sandbox-reference',
      meterVersion: 1,
      lastPayer: { scope: 'personal', userId: 'user', billingAccountId: 'billing' },
    },
  })
  const runtime: SandboxRuntime = {
    provider: 'box', capabilities: {} as never,
    create: async () => { throw new Error('unreachable') },
    reconnect: async () => ({
      status: async () => 'stopped' as const,
      stop: async () => { events.push('stop') },
      usage: async () => boatUsage(90_000, false),
      delete: async () => { events.push('delete') },
    }) as SandboxInstance,
    restore: async () => { throw new Error('unreachable') },
    deleteSnapshot: async () => undefined,
  }
  const service = new ManagedAgentSandboxBilling({
    now: () => 190_000,
    policy: {} as never,
    repository: {
      patchSandboxLeaseUsage: async () => null,
      environmentHasActiveRuns: async () => false,
      listSandboxLeases: async (args: { statuses: string[] }) => args.statuses.includes('running') ? [lease] : [],
      getSandboxLease: async () => lease,
      meterSandboxLease: async () => ({ applied: true as const, meterVersion: 2 }),
      stopSandboxLease: async () => ({ ...lease, status: 'stopping' as const }),
      updateSandboxLease: async (args: Record<string, unknown>) => ({ ...lease, status: args.status }),
    } as never,
    runtime: () => runtime,
  })
  const { ticks } = await service.meterLeases()
  assert.equal(ticks[0]?.outcome, 'killed')
  assert.equal(ticks[0]?.reason, 'lease_expired')
  // The reap path still captured the post-stop read and deleted it.
  assert.deepEqual(events, ['delete'])
})

test('meterLeases reaps stopping leases and retries provider cleanup', async () => {
  const updates: Array<Record<string, unknown>> = []
  const alerts: Array<{ type: SandboxAlertType; context: SandboxAlertContext }> = []
  const stoppingLease = leaseFixture({ status: 'stopping', cleanupAfter: 100_000 })
  const runtime: SandboxRuntime = {
    provider: 'box', capabilities: {} as never,
    create: async () => { throw new Error('unreachable') },
    reconnect: async () => ({
      status: async () => 'stopped' as const,
      usage: async () => boatUsage(60_000, false),
      delete: async () => { throw new Error('provider 500') },
    }) as SandboxInstance,
    restore: async () => { throw new Error('unreachable') },
    deleteSnapshot: async () => undefined,
  }
  const service = new ManagedAgentSandboxBilling({
    now: () => 190_000,
    policy: {} as never,
    repository: {
      patchSandboxLeaseUsage: async () => null,
      environmentHasActiveRuns: async () => false,
      listSandboxLeases: async (args: { statuses: string[]; cleanupBefore?: number }) =>
        args.statuses.includes('stopping') ? [stoppingLease] : [],
      getSandboxLease: async () => stoppingLease,
      meterSandboxLease: async () => ({ applied: true as const, meterVersion: 2 }),
      updateSandboxLease: async (args: Record<string, unknown>) => { updates.push(args); return stoppingLease },
    } as never,
    runtime: () => runtime,
    reportSandboxAlert: (type, context) => { alerts.push({ type, context }) },
  })
  const { ticks } = await service.meterLeases()
  assert.equal(ticks[0]?.outcome, 'cleanup_failed')
  assert.equal(updates[0]?.status, 'cleanup_failed')
  assert.equal(typeof updates[0]?.cleanupAfter, 'number')
  assert.equal((updates[0]?.cleanupAfter as number) > 190_000, true)
  assert.deepEqual(alerts.map(({ type }) => type), ['cleanup_failed', 'cleanup_failed'])
  assert.equal(alerts[0]?.context.leaseId, stoppingLease.id)
  assert.equal('providerReference' in (alerts[0]?.context ?? {}), false)
})

test('meterLeases alerts for a delayed running lease using runtime start as the fallback meter time', async () => {
  const alerts: Array<{ type: SandboxAlertType; context: SandboxAlertContext }> = []
  const lease = leaseFixture({
    provider: 'e2b',
    computerId: 'computer-1',
    runtimeStartedAt: 1_000,
    status: 'running',
    usage: { resources: { vcpus: 2, memoryGiB: 4, diskGiB: 20 } },
  })
  const service = new ManagedAgentSandboxBilling({
    now: () => 1_000 + SANDBOX_METER_DELAY_ALERT_MS + 1,
    policy: {} as never,
    computerLeaseHandler: async () => ({
      leaseId: lease.id,
      outcome: 'skipped',
      reason: 'test',
    }),
    repository: {
      listSandboxLeases: async (args: { statuses: string[] }) =>
        args.statuses.includes('running') ? [lease] : [],
      getSandboxLease: async () => lease,
    } as never,
    reportSandboxAlert: (type, context) => { alerts.push({ type, context }) },
  })
  await service.meterLeases()
  assert.deepEqual(alerts.map(({ type }) => type), ['metering_delayed'])
  assert.equal(alerts[0]?.context.reason, 'last_metered_more_than_15_minutes_ago')
})

test('meter tick failures emit a metering alert alongside the existing warning', async () => {
  const alerts: Array<{ type: SandboxAlertType; context: SandboxAlertContext }> = []
  const lease = leaseFixture({
    provider: 'e2b',
    status: 'running',
    runtimeStartedAt: 1_000,
    usage: {
      meteredAt: 1_000,
      meteredUsage: {},
      meterVersion: 1,
      meteredProviderReference: 'sandbox-reference',
    },
  })
  const runtime: SandboxRuntime = {
    provider: 'e2b',
    capabilities: {} as never,
    create: async () => { throw new Error('unreachable') },
    reconnect: async () => { throw new Error('meter request failed') },
    restore: async () => { throw new Error('unreachable') },
    deleteSnapshot: async () => undefined,
  }
  const service = new ManagedAgentSandboxBilling({
    now: () => 2_000,
    policy: {} as never,
    runtime: () => runtime,
    repository: {
      listSandboxLeases: async (args: { statuses: string[] }) =>
        args.statuses.includes('running') ? [lease] : [],
      getSandboxLease: async () => lease,
    } as never,
    reportSandboxAlert: (type, context) => { alerts.push({ type, context }) },
  })
  const { ticks } = await service.meterLeases()
  assert.equal(ticks[0]?.outcome, 'error')
  assert.deepEqual(alerts.map(({ type }) => type), ['meter_tick_failed'])
  assert.equal(alerts[0]?.context.leaseId, lease.id)
})

test('pre-delete stop failures alert as stop failures and cleanup failures', async () => {
  const alerts: Array<{ type: SandboxAlertType; context: SandboxAlertContext }> = []
  const stoppingLease = leaseFixture({ provider: 'e2b', status: 'stopping', cleanupAfter: 100_000 })
  const runtime: SandboxRuntime = {
    provider: 'e2b',
    capabilities: {} as never,
    create: async () => { throw new Error('unreachable') },
    reconnect: async () => ({
      status: async () => 'running' as const,
      stop: async () => { throw new Error('stop request failed') },
    }) as SandboxInstance,
    restore: async () => { throw new Error('unreachable') },
    deleteSnapshot: async () => undefined,
  }
  const service = new ManagedAgentSandboxBilling({
    now: () => 190_000,
    policy: {} as never,
    runtime: () => runtime,
    repository: {
      listSandboxLeases: async (args: { statuses: string[] }) =>
        args.statuses.includes('stopping') ? [stoppingLease] : [],
      getSandboxLease: async () => stoppingLease,
      updateSandboxLease: async () => stoppingLease,
    } as never,
    reportSandboxAlert: (type, context) => { alerts.push({ type, context }) },
  })
  const { ticks } = await service.meterLeases()
  assert.equal(ticks[0]?.outcome, 'cleanup_failed')
  assert.deepEqual(alerts.map(({ type }) => type), ['stop_failed', 'cleanup_failed'])
})

test('Computer cleanup failures from killLease emit cleanup alerts', async () => {
  const alerts: Array<{ type: SandboxAlertType; context: SandboxAlertContext }> = []
  const lease = leaseFixture({
    provider: 'e2b',
    computerId: 'computer-1',
    status: 'running',
    reservedUntil: 1_000,
  })
  const service = new ManagedAgentSandboxBilling({
    now: () => 2_000,
    policy: {} as never,
    computerLeaseHandler: async (_lease, reason) => reason === 'idle_check'
      ? { leaseId: lease.id, outcome: 'skipped', reason: 'computer_active' }
      : { leaseId: lease.id, outcome: 'cleanup_failed', reason: 'computer_stop_failed' },
    repository: {
      listSandboxLeases: async (args: { statuses: string[] }) =>
        args.statuses.includes('running') ? [lease] : [],
      getSandboxLease: async () => lease,
    } as never,
    reportSandboxAlert: (type, context) => { alerts.push({ type, context }) },
  })
  const { ticks } = await service.meterLeases()
  assert.equal(ticks[0]?.outcome, 'cleanup_failed')
  assert.deepEqual(alerts.map(({ type }) => type), ['cleanup_failed'])
  assert.equal(alerts[0]?.context.computerId, 'computer-1')
})

test('metered settle runs a final tick, releases the bootstrap hold, and tolerates a missing marker', async () => {
  const released: Array<Record<string, unknown>> = []
  const patches: Array<Record<string, unknown>> = []
  const idleChecks: number[] = []
  const lease = leaseFixture({
    usage: {
      meteredUsage: { wallTimeMs: 60_000 },
      meteredProviderReference: 'sandbox-reference',
      meterVersion: 5,
      lastPayer: { scope: 'personal', userId: 'user', billingAccountId: 'billing' },
    },
  })
  const service = new ManagedAgentSandboxBilling({
    now: () => 190_000,
    policy: {
      release: async (args: Record<string, unknown>) => { released.push(args); return { success: true as const } },
      markForReconcile: async () => { throw new Error('must not reconcile') },
    } as never,
    repository: {
      environmentHasActiveRuns: async () => false,
      getSandboxLease: async () => lease,
      meterSandboxLease: async () => ({ applied: true as const, meterVersion: 6, remainingCents: 800 }),
      markSandboxSettlementComplete: async () => false,
      patchSandboxLeaseUsage: async (args: { patch: Record<string, unknown>; idleCheckInMs?: number }) => {
        patches.push(args.patch)
        if (args.idleCheckInMs !== undefined) idleChecks.push(args.idleCheckInMs)
        return lease
      },
    } as never,
    runtime: () => runtimeWithUsage(() => ({ wallTimeMs: 90_000 })),
  })
  await service.settle({
    agentId: 'agent', environmentId: 'environment', forceFreeTierLimits: false,
    inputTokens: 0, modelId: 'openrouter/free', modelUsageBilling: 'byok', operationId: 'op',
    outcome: 'completed', outputTokens: 0, reservationId: null, runId: 'run', userId: 'user',
    workspaceId: 'workspace',
    sandboxBilling: {
      baselineUsage: {}, leaseId: 'lease', provider: 'box', providerReference: 'sandbox-reference',
      reservationId: 'sandbox-reservation', resources: { vcpus: 2, memoryGiB: 4, diskGiB: 20 }, startedAt: 60_000,
    },
  })
  assert.deepEqual(released, [{ reservationId: 'sandbox-reservation', userId: 'user', reason: 'sandbox_metered' }])
  // The run's end starts the machine's idle timer for one full window.
  assert.deepEqual(idleChecks, [600_000])
  assert.equal(typeof (patches[0]?.lastSettlement as Record<string, unknown>)?.providerCostUsd, 'number')
})

test('managed sandbox settlement failure marks its reservation for reconciliation', async () => {
  let reconciled = ''
  const service = new ManagedAgentSandboxBilling({
    policy: {
      markForReconcile: async (args: { reservationId?: string | null }) => {
        reconciled = args.reservationId ?? ''
        return { success: true as const }
      },
    } as never,
    repository: {
      patchSandboxLeaseUsage: async () => null,
      environmentHasActiveRuns: async () => false,
      getSandboxLease: async () => null,
    } as never,
    runtime: () => { throw new Error('provider unavailable') },
  })
  await assert.rejects(() => service.settle({
    agentId: 'agent', environmentId: 'environment', forceFreeTierLimits: false,
    inputTokens: 0, modelId: 'openrouter/free', modelUsageBilling: 'byok', operationId: 'op',
    outcome: 'timeout', outputTokens: 0, reservationId: null, runId: 'run', userId: 'user',
    workspaceId: 'workspace', sandboxBilling: {
      baselineUsage: {}, leaseId: 'lease', provider: 'box', providerReference: 'sandbox', reservationId: 'sandbox-reservation',
      resources: { vcpus: 2, memoryGiB: 4, diskGiB: 20 }, startedAt: Date.now(),
    },
  }), /provider unavailable/)
  assert.equal(reconciled, 'sandbox-reservation')
})

test('legacy settle follows a repointed lease and seeds the meter cursor', async () => {
  // Reset/expiry leaves the lease running but its providerReference dead; the
  // turn's acquire step recreates the sandbox and repoints the same lease.
  const reconnects: string[] = []
  const runtime: SandboxRuntime = {
    provider: 'box', capabilities: {} as never,
    create: async () => { throw new Error('unreachable') },
    reconnect: async (reference: string) => {
      reconnects.push(reference)
      if (reference === 'destroyed-sandbox') throw new Error('404 Named sandbox not found')
      return { usage: async () => boatUsage(60_000) } as SandboxInstance
    },
    restore: async () => { throw new Error('unreachable') },
    deleteSnapshot: async () => undefined,
  }
  const usageEvents: Array<Record<string, unknown>> = []
  const patches: Array<Record<string, unknown>> = []
  const repository = {
    getActiveSandboxLease: async () => leaseFixture({ providerReference: 'destroyed-sandbox' }),
    getSandboxLease: async () => leaseFixture({ providerReference: 'recreated-sandbox' }),
    patchSandboxLeaseUsage: async (args: { patch: Record<string, unknown> }) => {
      patches.push(args.patch)
      return leaseFixture({ providerReference: 'recreated-sandbox' })
    },
    markSandboxSettlementComplete: async () => true,
  }
  const service = new ManagedAgentSandboxBilling({
    now: () => 5_000,
    policy: {
      reserve: async () => ({ ok: true as const, billingAccountId: 'billing', reservationId: 'sandbox-reservation', reservedCents: 10, entitlements: {} }),
      markStarted: async () => ({ success: true as const }),
      release: async () => ({ success: true as const }),
      markForReconcile: async () => ({ success: true as const }),
      finalize: async (args: { events?: Array<Record<string, unknown>> }) => {
        usageEvents.push(...(args.events ?? []))
        return { success: true as const }
      },
    } as never,
    repository: repository as never,
    runtime: () => runtime,
  })
  const billing = await service.reserve({
    agentId: 'agent', entitlements: {} as never, environmentId: 'environment',
    idempotencyKey: 'turn:sandbox', operationId: 'sandbox:run',
    requestFingerprint: 'fingerprint', userId: 'user', workspaceId: 'workspace',
  })
  assert.equal(billing.providerReference, 'destroyed-sandbox')
  assert.deepEqual(billing.baselineUsage, {})
  await service.settle({
    agentId: 'agent', environmentId: 'environment', forceFreeTierLimits: false,
    inputTokens: 0, modelId: 'openrouter/free', modelUsageBilling: 'byok', operationId: 'op',
    outcome: 'completed', outputTokens: 0, reservationId: null, runId: 'run', userId: 'user',
    workspaceId: 'workspace', sandboxBilling: billing,
  })
  // reserve reconnected to the dead ref once (baseline attempt); settle must
  // have reconnected to the recreated ref, never the dead snapshot.
  assert.deepEqual(reconnects, ['destroyed-sandbox', 'recreated-sandbox'])
  assert.equal(usageEvents.length, 1)
  assert.equal(usageEvents[0]?.type, 'sandbox')
  // reserve marks the turn as activity; settle seeds the meter cursor and ends it.
  assert.equal(patches[0]?.lastActiveAt, 5_000)
  assert.equal(patches.at(-1)?.activeUntil, 0)
  const settledUsage = patches.at(-1)?.meteredUsage as Record<string, unknown>
  assert.equal(settledUsage.wallTimeMs, 60_000)
  assert.equal((settledUsage.providerMetrics as { authoritativeCounter: boolean }).authoritativeCounter, true)
  assert.equal(patches.at(-1)?.meteredProviderReference, 'recreated-sandbox')
})

test('meterLease stops a lease whose authoritative provider counter is stalled', async () => {
  const stoppedLeases: Array<Record<string, unknown>> = []
  const meterCalls: Array<Record<string, unknown>> = []
  const lease = leaseFixture({
    usage: {
      meteredUsage: {
        wallTimeMs: 60_000,
        providerMetrics: { ...boatUsage(60_000).providerMetrics, reportedUsd: 0.0006 },
        boatCursor: boatCursor(60, 0.0006, 60_000),
      },
      meteredProviderReference: 'sandbox-reference',
      meteredAt: 60_000,
      meterVersion: 3,
      lastPayer: { scope: 'personal', userId: 'user', billingAccountId: 'billing' },
    },
  })
  const reconnectOptions: Array<Record<string, unknown> | undefined> = []
  const runtime: SandboxRuntime = {
    provider: 'box', capabilities: {} as never,
    create: async () => { throw new Error('unreachable') },
    reconnect: async (_reference: string, options?: { resume?: boolean }) => {
      reconnectOptions.push(options)
      // Provider counters have not advanced within the stale-counter window.
      return {
        status: async () => 'running' as const,
        usage: async () => boatUsage(60_000, true, 0.0006),
      } as SandboxInstance
    },
    restore: async () => { throw new Error('unreachable') },
    deleteSnapshot: async () => undefined,
  }
  const service = new ManagedAgentSandboxBilling({
    now: () => 190_000,
    policy: {} as never,
    repository: {
      patchSandboxLeaseUsage: async () => null,
      environmentHasActiveRuns: async () => false,
      meterSandboxLease: async (args: Record<string, unknown>) => {
        meterCalls.push(args)
        return { applied: true as const, meterVersion: 4, remainingCents: 500 }
      },
      stopSandboxLease: async (args: Record<string, unknown>) => {
        stoppedLeases.push(args)
        return { ...lease, status: 'stopping' as const }
      },
    } as never,
    runtime: () => runtime,
  })
  const result = await service.meterLease(lease)
  assert.deepEqual(result, { applied: false, reason: 'provider_usage_stalled' })
  // Meter reads must never resume a stopped session.
  assert.deepEqual(reconnectOptions, [{ resume: false }])
  const call = meterCalls[0]!
  assert.equal(call.charge, undefined)
  assert.ok(Number(call.runtimeHoldCents) > 0)
  assert.equal((call.meteredUsage as { wallTimeMs: number }).wallTimeMs, 60_000)
  assert.equal(stoppedLeases[0]?.reason, 'provider_usage_stalled')
})

test('meterLease bills real counter totals on a stopped instance without elapsed fallback', async () => {
  const meterCalls: Array<Record<string, unknown>> = []
  const lease = leaseFixture({
    usage: {
      meteredUsage: {
        wallTimeMs: 120_000,
        providerMetrics: { ...boatUsage(120_000).providerMetrics, reportedUsd: 0.008 },
        boatCursor: boatCursor(120, 0.008, 60_000),
      },
      meteredProviderReference: 'sandbox-reference',
      meteredAt: 60_000,
      meterVersion: 3,
      lastPayer: { scope: 'personal', userId: 'user', billingAccountId: 'billing' },
    },
  })
  const runtime: SandboxRuntime = {
    provider: 'box', capabilities: {} as never,
    create: async () => { throw new Error('unreachable') },
    reconnect: async () => ({
      status: async () => 'stopped' as const,
      usage: async () => ({ ...boatUsage(150_000, false, 0.01), egressBytes: 1_000_000 }),
    }) as SandboxInstance,
    restore: async () => { throw new Error('unreachable') },
    deleteSnapshot: async () => undefined,
  }
  const service = new ManagedAgentSandboxBilling({
    now: () => 190_000,
    policy: {} as never,
    repository: {
      patchSandboxLeaseUsage: async () => null,
      environmentHasActiveRuns: async () => false,
      meterSandboxLease: async (args: Record<string, unknown>) => {
        meterCalls.push(args)
        return { applied: true as const, meterVersion: 4, remainingCents: 500 }
      },
    } as never,
    runtime: () => runtime,
  })
  const result = await service.meterLease(lease)
  assert.equal(result.applied, true)
  // Post-stop totals are real: 150s - 120s cursor = 30s — no elapsed top-up
  // even though 130s passed since the last tick.
  assert.equal((meterCalls[0]!.charge as { durationSeconds: number }).durationSeconds, 30)
  assert.equal((meterCalls[0]!.meteredUsage as { wallTimeMs: number }).wallTimeMs, 150_000)
})

test('meterLease idle-stops a running sandbox whose lease shows no recent activity', async () => {
  // Vercel has no provider idle-stop, so the meter enforces the lease's idle
  // window: a sandbox idle past idleTimeoutMs is stopped while the lease stays
  // running — the next turn's acquire resumes it.
  const events: string[] = []
  const lease = leaseFixture({
    usage: {
      lastActiveAt: 60_000,
      idleTimeoutMs: 600_000,
      meteredUsage: { wallTimeMs: 60_000 },
      meteredProviderReference: 'sandbox-reference',
      meteredAt: 60_000,
      meterVersion: 3,
      lastPayer: { scope: 'personal', userId: 'user', billingAccountId: 'billing' },
    },
  })
  const runtime: SandboxRuntime = {
    provider: 'box', capabilities: {} as never,
    create: async () => { throw new Error('unreachable') },
    reconnect: async () => ({
      status: async () => 'running' as const,
      stop: async () => { events.push('stop') },
      usage: async () => boatUsage(60_000),
    }) as SandboxInstance,
    restore: async () => { throw new Error('unreachable') },
    deleteSnapshot: async () => undefined,
  }
  const service = new ManagedAgentSandboxBilling({
    idleFallbackDue: () => true,
    now: () => 1_000_000,
    policy: {} as never,
    repository: {
      patchSandboxLeaseUsage: async () => null,
      environmentHasActiveRuns: async () => false,
      meterSandboxLease: async () => ({ applied: true as const, meterVersion: 4, remainingCents: 500 }),
    } as never,
    runtime: () => runtime,
  })
  const result = await service.meterLease(lease)
  assert.equal(result.applied, true)
  assert.deepEqual(events, ['stop'])
})

test('meterLease leaves a recently-active sandbox running', async () => {
  const events: string[] = []
  const lease = leaseFixture({
    usage: {
      lastActiveAt: 990_000,
      idleTimeoutMs: 600_000,
      meteredUsage: { wallTimeMs: 60_000 },
      meteredProviderReference: 'sandbox-reference',
      meteredAt: 60_000,
      meterVersion: 3,
      lastPayer: { scope: 'personal', userId: 'user', billingAccountId: 'billing' },
    },
  })
  const runtime: SandboxRuntime = {
    provider: 'box', capabilities: {} as never,
    create: async () => { throw new Error('unreachable') },
    reconnect: async () => ({
      status: async () => 'running' as const,
      stop: async () => { events.push('stop') },
      usage: async () => boatUsage(60_000),
    }) as SandboxInstance,
    restore: async () => { throw new Error('unreachable') },
    deleteSnapshot: async () => undefined,
  }
  const service = new ManagedAgentSandboxBilling({
    now: () => 1_000_000,
    policy: {} as never,
    repository: {
      patchSandboxLeaseUsage: async () => null,
      environmentHasActiveRuns: async () => false,
      meterSandboxLease: async () => ({ applied: true as const, meterVersion: 4, remainingCents: 500 }),
    } as never,
    runtime: () => runtime,
  })
  const result = await service.meterLease(lease)
  assert.equal(result.applied, true)
  assert.deepEqual(events, [])
})

test('meterLease does not idle-stop a sandbox while a run is still going', async () => {
  const events: string[] = []
  const lease = leaseFixture({
    usage: {
      lastActiveAt: 60_000,
      activeUntil: 2_000_000,
      idleTimeoutMs: 600_000,
      meteredUsage: { wallTimeMs: 60_000 },
      meteredProviderReference: 'sandbox-reference',
      meteredAt: 60_000,
      meterVersion: 3,
      lastPayer: { scope: 'personal', userId: 'user', billingAccountId: 'billing' },
    },
  })
  const runtime: SandboxRuntime = {
    provider: 'box', capabilities: {} as never,
    create: async () => { throw new Error('unreachable') },
    reconnect: async () => ({
      status: async () => 'running' as const,
      stop: async () => { events.push('stop') },
      usage: async () => boatUsage(60_000),
    }) as SandboxInstance,
    restore: async () => { throw new Error('unreachable') },
    deleteSnapshot: async () => undefined,
  }
  const service = new ManagedAgentSandboxBilling({
    now: () => 1_000_000,
    policy: {} as never,
    repository: {
      patchSandboxLeaseUsage: async () => null,
      environmentHasActiveRuns: async () => true,
      meterSandboxLease: async () => ({ applied: true as const, meterVersion: 4, remainingCents: 500 }),
    } as never,
    runtime: () => runtime,
  })
  await service.meterLease(lease)
  assert.deepEqual(events, [])
})

test('reaped leases stop the sandbox before the final usage read and delete', async () => {
  const events: string[] = []
  let running = true
  const stoppingLease = leaseFixture({ status: 'stopping', cleanupAfter: 100_000 })
  const runtime: SandboxRuntime = {
    provider: 'box', capabilities: {} as never,
    create: async () => { throw new Error('unreachable') },
    reconnect: async () => ({
      status: async () => running ? 'running' as const : 'stopped' as const,
      stop: async () => { running = false; events.push('stop') },
      usage: async () => boatUsage(300_000, false),
      delete: async () => { events.push('delete') },
    }) as SandboxInstance,
    restore: async () => { throw new Error('unreachable') },
    deleteSnapshot: async () => undefined,
  }
  const meterCalls: Array<Record<string, unknown>> = []
  const service = new ManagedAgentSandboxBilling({
    now: () => 190_000,
    policy: {} as never,
    repository: {
      patchSandboxLeaseUsage: async () => null,
      environmentHasActiveRuns: async () => false,
      listSandboxLeases: async (args: { statuses: string[]; cleanupBefore?: number }) =>
        args.statuses.includes('stopping') ? [stoppingLease] : [],
      getSandboxLease: async () => stoppingLease,
      meterSandboxLease: async (args: Record<string, unknown>) => {
        meterCalls.push(args)
        events.push('meter')
        return { applied: true as const, meterVersion: 1 }
      },
      updateSandboxLease: async (args: Record<string, unknown>) => ({ ...stoppingLease, status: args.status }),
    } as never,
    runtime: () => runtime,
  })
  const { ticks } = await service.meterLeases()
  assert.equal(ticks[0]?.outcome, 'released')
  // stop → final meter read → delete: usage is captured before teardown.
  assert.deepEqual(events, ['stop', 'meter', 'delete'])
  // The final tick is charge-free-of-floor: a low-balance wallet still pays
  // the tail usage it already consumed.
  assert.equal(meterCalls[0]?.minRemainingCents, 0)
})

test('provider pricing uses provider-native runtime dimensions', () => {
  assert.throws(() => sandboxCostUsd({
    provider: 'daytona', resources: { vcpus: 2, memoryGiB: 4, diskGiB: 20 },
    usage: { wallTimeMs: 60_000 },
  }), /MANAGED_SANDBOX_PROVIDER_UNPRICED/)
  assert.equal(sandboxCostUsd({
    provider: 'box', resources: { vcpus: 2, memoryGiB: 4, diskGiB: 20 },
    usage: { wallTimeMs: 60_000, activeCpuTimeMs: 30_000 },
  }) > 0, true)
})

test('box pricing prefers provider-reported dollars over the seconds rate card', () => {
  // Provider-reported delta is authoritative even when it diverges from the
  // list-price estimate (plan seconds, refused-stop exclusion, rounding).
  assert.equal(sandboxCostUsd({
    provider: 'box', resources: { vcpus: 2, memoryGiB: 4, diskGiB: 20 },
    usage: { wallTimeMs: 60_000, providerMetrics: { reportedUsd: 0.0123 } },
  }), 0.0123)
  // A zero delta is honest: no new billable spend reported (e.g. stopped).
  assert.equal(sandboxCostUsd({
    provider: 'box', resources: { vcpus: 2, memoryGiB: 4, diskGiB: 20 },
    usage: { wallTimeMs: 0, providerMetrics: { reportedUsd: 0 } },
  }), 0)
  // Without providerMetrics (or without dollars in it) the rate card applies:
  // billable seconds at list price — 100_000 seconds per dollar.
  assert.equal(sandboxCostUsd({
    provider: 'box', resources: { vcpus: 2, memoryGiB: 4, diskGiB: 20 },
    usage: { wallTimeMs: 100_000_000 },
  }), 1)
  assert.equal(sandboxCostUsd({
    provider: 'box', resources: { vcpus: 2, memoryGiB: 4, diskGiB: 20 },
    usage: { wallTimeMs: 50_000_000, providerMetrics: { running: true } },
  }), 0.5)
})

test('meterLease bills the provider-reported dollar delta on a box lease', async () => {
  const meterCalls: Array<Record<string, unknown>> = []
  const usage = {
    wallTimeMs: 3_700_000,
    providerMetrics: {
      authoritativeCounter: true, reportedUsd: 0.037, secondsPerDollar: 100_000,
      billingMultiplier: 1, running: true,
    },
  }
  const lease = leaseFixture({
    provider: 'box',
    usage: {
      resources: { vcpus: 2, memoryGiB: 4, diskGiB: 20 },
      meteredUsage: {
        wallTimeMs: 3_600_000,
        providerMetrics: {
          authoritativeCounter: true, reportedUsd: 0.036, secondsPerDollar: 100_000,
          billingMultiplier: 1, running: true,
        },
        boatCursor: boatCursor(3_600, 0.036, 60_000),
      },
      meteredProviderReference: 'sandbox-reference',
      meteredAt: 60_000,
      meterVersion: 3,
      lastPayer: { scope: 'personal', userId: 'user', billingAccountId: 'billing' },
    },
  })
  const service = new ManagedAgentSandboxBilling({
    now: () => 190_000,
    policy: {} as never,
    repository: {
      patchSandboxLeaseUsage: async () => null,
      environmentHasActiveRuns: async () => false,
      meterSandboxLease: async (args: Record<string, unknown>) => {
        meterCalls.push(args)
        return { applied: true as const, meterVersion: 4, remainingCents: 500 }
      },
    } as never,
    runtime: () => ({ ...runtimeWithUsage(() => usage), provider: 'box' }),
  })
  const result = await service.meterLease(lease)
  assert.equal(result.applied, true)
  const charge = meterCalls[0]!.charge as { providerCostUsd: number; durationSeconds: number }
  // Delta: 100s billable + $0.001 provider-reported — the reported dollars win.
  assert.ok(Math.abs(charge.providerCostUsd - 0.001) < 1e-9)
  assert.equal(charge.durationSeconds, 100)
})

function leaseFixture(overrides: Partial<AgentSandboxLease>): AgentSandboxLease {
  return {
    id: 'lease', workspaceId: 'workspace', environmentId: 'environment', provider: 'box',
    providerReference: 'sandbox-reference', status: 'running', reservedUntil: 10_000,
    runtimeStartedAt: 1_000, usage: { resources: { vcpus: 2, memoryGiB: 4, diskGiB: 20 } },
    cleanupAttempts: 0, createdAt: 1_000, updatedAt: 1_000,
    ...overrides,
  }
}

function runtimeWithUsage(read: () => { wallTimeMs: number; activeCpuTimeMs?: number; providerMetrics?: SandboxUsage['providerMetrics'] }): SandboxRuntime {
  const instance = {
    usage: async () => {
      const usage = read()
      return {
        ...usage,
        providerMetrics: { ...boatUsage(usage.wallTimeMs).providerMetrics, ...usage.providerMetrics },
      }
    },
  } as SandboxInstance
  return {
    provider: 'box', capabilities: {} as never,
    create: async () => instance, reconnect: async () => instance,
    restore: async () => instance, deleteSnapshot: async () => undefined,
  }
}

function boatUsage(wallTimeMs: number, running = true, reportedUsd = 0) {
  return {
    wallTimeMs,
    providerMetrics: {
      authoritativeCounter: true,
      reportedUsd,
      secondsPerDollar: 100_000,
      billingMultiplier: 1,
      running,
    },
  }
}

function boatCursor(billableSeconds: number, dollars: number, advancedAt: number) {
  return {
    billableSeconds, dollars, advancedAt,
    price: { secondsPerDollar: 100_000, billingMultiplier: 1 },
    running: true, pendingBillingMultiplier: 1,
  }
}

/** A lease with the timer state under test, a fake provider that records stops, and a repository that records patches. */
function idleHarness(options: {
  now: number
  usage: Record<string, unknown>
  activeRuns?: boolean
  status?: string
  fallbackDue?: boolean
  stopFails?: boolean
}) {
  const events: string[] = []
  const patches: Array<{ patch: Record<string, unknown>; idleCheckInMs?: number }> = []
  const alerts: Array<{ type: SandboxAlertType; context: SandboxAlertContext }> = []
  const lease = leaseFixture({
    status: options.status ?? 'running',
    usage: {
      idleTimeoutMs: 600_000,
      meteredUsage: { wallTimeMs: 60_000 },
      meteredProviderReference: 'sandbox-reference',
      meteredAt: 60_000,
      meterVersion: 3,
      lastPayer: { scope: 'personal', userId: 'user', billingAccountId: 'billing' },
      ...options.usage,
    },
  } as never)
  const runtime: SandboxRuntime = {
    provider: 'box', capabilities: {} as never,
    create: async () => { throw new Error('unreachable') },
    reconnect: async () => ({
      status: async () => 'running' as const,
      stop: async () => {
        events.push('stop')
        if (options.stopFails) throw new Error('SANDBOX_STOP_NOT_CONFIRMED')
      },
      usage: async () => boatUsage(60_000),
    }) as SandboxInstance,
    restore: async () => { throw new Error('unreachable') },
    deleteSnapshot: async () => undefined,
  }
  const service = new ManagedAgentSandboxBilling({
    now: () => options.now,
    idleFallbackDue: () => options.fallbackDue !== false,
    policy: {} as never,
    repository: {
      getSandboxLease: async () => lease,
      getActiveSandboxLease: async () => lease,
      environmentHasActiveRuns: async () => options.activeRuns === true,
      patchSandboxLeaseUsage: async (args: { patch: Record<string, unknown>; idleCheckInMs?: number }) => { patches.push(args); return lease },
      meterSandboxLease: async () => ({ applied: true as const, meterVersion: 4, remainingCents: 500 }),
    } as never,
    runtime: () => runtime,
    reportSandboxAlert: (type, context) => { alerts.push({ type, context }) },
  })
  return { service, lease, events, patches, alerts }
}

test('idleCheck ignores a timer whose token was replaced', async () => {
  const { service, events, patches } = idleHarness({ now: 1_000_000, usage: { lastActiveAt: 100_000, idleToken: 'current', idleCheckAt: 700_000 } })
  assert.deepEqual(await service.idleCheck({ workspaceId: 'workspace', leaseId: 'lease', token: 'old' }), { outcome: 'stale' })
  assert.deepEqual(events, [])
  assert.deepEqual(patches, [])
})

test('idleCheck stops a machine that was idle for the whole window', async () => {
  const { service, events } = idleHarness({ now: 1_000_000, usage: { lastActiveAt: 100_000, idleToken: 'current', idleCheckAt: 700_000 } })
  assert.deepEqual(await service.idleCheck({ workspaceId: 'workspace', leaseId: 'lease', token: 'current' }), { outcome: 'checked' })
  assert.deepEqual(events, ['stop'])
})

test('idleCheck moves to the end of the window when something happened since it was scheduled', async () => {
  const { service, events, patches } = idleHarness({ now: 1_000_000, usage: { lastActiveAt: 700_000, idleToken: 'current', idleCheckAt: 700_000 } })
  assert.deepEqual(await service.idleCheck({ workspaceId: 'workspace', leaseId: 'lease', token: 'current' }), { outcome: 'rescheduled' })
  assert.deepEqual(events, [])
  assert.equal(patches[0]?.idleCheckInMs, 300_000)
})

test('idleCheck leaves a machine alone while a run is going', async () => {
  const { service, events } = idleHarness({ now: 1_000_000, usage: { lastActiveAt: 100_000, idleToken: 'current', idleCheckAt: 700_000 }, activeRuns: true })
  assert.deepEqual(await service.idleCheck({ workspaceId: 'workspace', leaseId: 'lease', token: 'current' }), { outcome: 'busy' })
  assert.deepEqual(events, [])
})

test('idleCheck does nothing for a lease that is gone or no longer running', async () => {
  const { service, events } = idleHarness({ now: 1_000_000, usage: { idleToken: 'current' }, status: 'stopping' })
  assert.deepEqual(await service.idleCheck({ workspaceId: 'workspace', leaseId: 'lease', token: 'current' }), { outcome: 'gone' })
  assert.deepEqual(events, [])
})

test('the sweep starts a missing idle timer for an idle machine and does not stop it before the grace period', async () => {
  const { service, lease, events, patches } = idleHarness({ now: 1_000_000, usage: { lastActiveAt: 450_000 } })
  await service.meterLease(lease)
  assert.deepEqual(events, [], 'idle for 550s of a 600s window: not yet')
  assert.equal(patches.length, 1)
  assert.equal(patches[0]?.idleCheckInMs, 50_000, 'timer set for the rest of the window')
})

test('the sweep stops a machine whose timer was lost, once past the grace period', async () => {
  const { service, lease, events } = idleHarness({ now: 1_000_000, usage: { lastActiveAt: 100_000, idleToken: 'lost', idleCheckAt: 700_000 } })
  await service.meterLease(lease)
  assert.deepEqual(events, ['stop'])
})

test('idle stop failures emit an alert and retain the normal meter flow', async () => {
  const { service, lease, events, alerts } = idleHarness({
    now: 1_000_000,
    usage: { lastActiveAt: 100_000, idleToken: 'lost', idleCheckAt: 700_000 },
    stopFails: true,
  })
  const result = await service.meterLease(lease)
  assert.deepEqual(events, ['stop'])
  assert.equal(result.applied, true)
  assert.deepEqual(alerts.map(({ type }) => type), ['idle_stop_failed'])
})

test('the sweep leaves a machine with a live timer to its timer', async () => {
  const { service, lease, events, patches } = idleHarness({ now: 1_000_000, usage: { lastActiveAt: 450_000, idleToken: 'live', idleCheckAt: 1_050_000 } })
  await service.meterLease(lease)
  assert.deepEqual(events, [])
  assert.deepEqual(patches, [])
})

test('between its 10-minute ticks the sweep neither starts timers nor stops machines', async () => {
  const { service, lease, events, patches } = idleHarness({ now: 1_000_000, usage: { lastActiveAt: 100_000, idleToken: 'lost', idleCheckAt: 700_000 }, fallbackDue: false })
  await service.meterLease(lease)
  assert.deepEqual(events, [])
  assert.deepEqual(patches, [])
})

test('by default the idle fallback runs only in the first 90 seconds of each 10-minute block', async () => {
  const run = async (now: number) => {
    const events: string[] = []
    const lease = leaseFixture({ usage: { idleTimeoutMs: 600_000, lastActiveAt: now - 5_000_000, idleToken: 'lost', idleCheckAt: now - 4_000_000, meteredUsage: { wallTimeMs: 60_000 }, meteredProviderReference: 'sandbox-reference', meteredAt: 60_000, meterVersion: 3, lastPayer: { scope: 'personal', userId: 'user', billingAccountId: 'billing' } } } as never)
    const runtime: SandboxRuntime = {
      provider: 'box', capabilities: {} as never,
      create: async () => { throw new Error('unreachable') },
      reconnect: async () => ({ status: async () => 'running' as const, stop: async () => { events.push('stop') }, usage: async () => boatUsage(60_000) }) as SandboxInstance,
      restore: async () => { throw new Error('unreachable') },
      deleteSnapshot: async () => undefined,
    }
    const service = new ManagedAgentSandboxBilling({
      now: () => now, policy: {} as never, runtime: () => runtime,
      repository: { getActiveSandboxLease: async () => lease, environmentHasActiveRuns: async () => false, patchSandboxLeaseUsage: async () => null, meterSandboxLease: async () => ({ applied: true as const, meterVersion: 4, remainingCents: 500 }) } as never,
    })
    await service.meterLease(lease)
    return events
  }
  assert.deepEqual(await run(6_000_000 + 30_000), ['stop'], 'inside the window')
  assert.deepEqual(await run(6_000_000 + 300_000), [], 'between windows')
})
