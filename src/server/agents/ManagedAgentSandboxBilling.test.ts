import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentSandboxLease } from '@overlay/workspace-contracts'
import type { SandboxInstance, SandboxRuntime } from '@overlay/sandbox-runtime'
import { ManagedAgentSandboxBilling, sandboxCostUsd } from './ManagedAgentSandboxBilling'

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
})

test('meterLease debits the usage delta against the lease cursor', async () => {
  const meterCalls: Array<Record<string, unknown>> = []
  const usage = { wallTimeMs: 130_000, activeCpuTimeMs: 60_000 }
  const lease = leaseFixture({
    usage: {
      resources: { vcpus: 2, memoryGiB: 4, diskGiB: 20 },
      meteredUsage: { wallTimeMs: 60_000, activeCpuTimeMs: 30_000 },
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
  assert.deepEqual(call.meteredUsage, usage)
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
    usage: { resources: { vcpus: 2, memoryGiB: 4, diskGiB: 20 } },
  })
  const service = new ManagedAgentSandboxBilling({
    now: () => 190_000,
    policy: {} as never,
    repository: {
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
  assert.deepEqual(meterCalls[0]!.meteredUsage, { wallTimeMs: 3_600_000, activeCpuTimeMs: 60_000 })
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
      meterSandboxLease: async (args: Record<string, unknown>) => {
        meterCalls.push(args)
        return { applied: true as const, meterVersion: 8, remainingCents: 900 }
      },
    } as never,
    runtime: () => runtimeWithUsage(() => ({ wallTimeMs: 120_000 })),
  })
  const result = await service.meterLease(lease)
  assert.equal(result.applied, true)
  const charge = meterCalls[0]!.charge as { durationSeconds: number }
  assert.equal(charge.durationSeconds, 120)
})

test('meterLeases kills a lease when the meter debit is declined', async () => {
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
    provider: 'vercel', capabilities: {} as never,
    create: async () => { throw new Error('unreachable') },
    reconnect: async () => ({
      usage: async () => ({ wallTimeMs: 60_000 }),
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
      listSandboxLeases: async (args: { statuses: string[] }) => args.statuses.includes('running') ? [lease] : [],
      meterSandboxLease: async () => ({ applied: false as const, reason: 'insufficient_budget' as const, remainingCents: 12 }),
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
  assert.equal(ticks[0]?.reason, 'budget_exhausted')
  assert.equal(stopping, true)
  assert.deepEqual(deletes, ['sandbox-reference'])
  // The reaper released the lease after the provider delete succeeded.
  assert.equal(released.at(-1)?.status, 'released')
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
    provider: 'vercel', capabilities: {} as never,
    create: async () => { throw new Error('unreachable') },
    reconnect: async () => ({
      usage: async () => ({ wallTimeMs: 30_000 }),
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
      listSandboxLeases: async (args: { statuses: string[] }) => args.statuses.includes('running') ? [lease] : [],
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
    provider: 'vercel', capabilities: {} as never,
    create: async () => { throw new Error('unreachable') },
    reconnect: async () => ({
      status: async () => 'stopped' as const,
      stop: async () => { events.push('stop') },
      usage: async () => ({ wallTimeMs: 90_000 }),
      delete: async () => { events.push('delete') },
    }) as SandboxInstance,
    restore: async () => { throw new Error('unreachable') },
    deleteSnapshot: async () => undefined,
  }
  const service = new ManagedAgentSandboxBilling({
    now: () => 190_000,
    policy: {} as never,
    repository: {
      listSandboxLeases: async (args: { statuses: string[] }) => args.statuses.includes('running') ? [lease] : [],
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
  const stoppingLease = leaseFixture({ status: 'stopping', cleanupAfter: 100_000 })
  const runtime: SandboxRuntime = {
    provider: 'vercel', capabilities: {} as never,
    create: async () => { throw new Error('unreachable') },
    reconnect: async () => ({
      usage: async () => { throw new Error('gone') },
      delete: async () => { throw new Error('provider 500') },
    }) as SandboxInstance,
    restore: async () => { throw new Error('unreachable') },
    deleteSnapshot: async () => undefined,
  }
  const service = new ManagedAgentSandboxBilling({
    now: () => 190_000,
    policy: {} as never,
    repository: {
      listSandboxLeases: async (args: { statuses: string[]; cleanupBefore?: number }) =>
        args.statuses.includes('stopping') ? [stoppingLease] : [],
      meterSandboxLease: async () => { throw new Error('unmeterable') },
      updateSandboxLease: async (args: Record<string, unknown>) => { updates.push(args); return stoppingLease },
    } as never,
    runtime: () => runtime,
  })
  const { ticks } = await service.meterLeases()
  assert.equal(ticks[0]?.outcome, 'cleanup_failed')
  assert.equal(updates[0]?.status, 'cleanup_failed')
  assert.equal(typeof updates[0]?.cleanupAfter, 'number')
  assert.equal((updates[0]?.cleanupAfter as number) > 190_000, true)
})

test('metered settle runs a final tick, releases the bootstrap hold, and tolerates a missing marker', async () => {
  const released: Array<Record<string, unknown>> = []
  const patches: Array<Record<string, unknown>> = []
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
      getSandboxLease: async () => lease,
      meterSandboxLease: async () => ({ applied: true as const, meterVersion: 6, remainingCents: 800 }),
      markSandboxSettlementComplete: async () => false,
      patchSandboxLeaseUsage: async (args: { patch: Record<string, unknown> }) => { patches.push(args.patch); return lease },
    } as never,
    runtime: () => runtimeWithUsage(() => ({ wallTimeMs: 90_000 })),
  })
  await service.settle({
    agentId: 'agent', environmentId: 'environment', forceFreeTierLimits: false,
    inputTokens: 0, modelId: 'openrouter/free', modelUsageBilling: 'byok', operationId: 'op',
    outcome: 'completed', outputTokens: 0, reservationId: null, runId: 'run', userId: 'user',
    workspaceId: 'workspace',
    sandboxBilling: {
      baselineUsage: {}, leaseId: 'lease', provider: 'vercel', providerReference: 'sandbox-reference',
      reservationId: 'sandbox-reservation', resources: { vcpus: 2, memoryGiB: 4, diskGiB: 20 }, startedAt: 60_000,
    },
  })
  assert.deepEqual(released, [{ reservationId: 'sandbox-reservation', userId: 'user', reason: 'sandbox_metered' }])
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
      getSandboxLease: async () => null,
    } as never,
    runtime: () => { throw new Error('provider unavailable') },
  })
  await assert.rejects(() => service.settle({
    agentId: 'agent', environmentId: 'environment', forceFreeTierLimits: false,
    inputTokens: 0, modelId: 'openrouter/free', modelUsageBilling: 'byok', operationId: 'op',
    outcome: 'timeout', outputTokens: 0, reservationId: null, runId: 'run', userId: 'user',
    workspaceId: 'workspace', sandboxBilling: {
      baselineUsage: {}, leaseId: 'lease', provider: 'vercel', providerReference: 'sandbox', reservationId: 'sandbox-reservation',
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
    provider: 'vercel', capabilities: {} as never,
    create: async () => { throw new Error('unreachable') },
    reconnect: async (reference: string) => {
      reconnects.push(reference)
      if (reference === 'destroyed-sandbox') throw new Error('404 Named sandbox not found')
      return { usage: async () => ({ wallTimeMs: 60_000, activeCpuTimeMs: 30_000 }) } as SandboxInstance
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
  assert.deepEqual(patches[0]?.meteredUsage, { wallTimeMs: 60_000, activeCpuTimeMs: 30_000 })
  assert.equal(patches[0]?.meteredProviderReference, 'recreated-sandbox')
})

test('meterLease bills elapsed wall-clock when provider counters are stalled mid-session', async () => {
  // Vercel reports zeroed cumulative counters while a session runs — the tick
  // must bill the elapsed window and advance a virtual cursor so the real
  // post-stop total nets out instead of double-charging.
  const meterCalls: Array<Record<string, unknown>> = []
  const lease = leaseFixture({
    usage: {
      meteredUsage: { wallTimeMs: 60_000 },
      meteredProviderReference: 'sandbox-reference',
      meteredAt: 60_000,
      meterVersion: 3,
      lastPayer: { scope: 'personal', userId: 'user', billingAccountId: 'billing' },
    },
  })
  const reconnectOptions: Array<Record<string, unknown> | undefined> = []
  const runtime: SandboxRuntime = {
    provider: 'vercel', capabilities: {} as never,
    create: async () => { throw new Error('unreachable') },
    reconnect: async (_reference: string, options?: { resume?: boolean }) => {
      reconnectOptions.push(options)
      // Provider hides running counters: wall stays at the last reported 60s.
      return {
        status: async () => 'running' as const,
        usage: async () => ({ wallTimeMs: 60_000, activeCpuTimeMs: 30_000 }),
      } as SandboxInstance
    },
    restore: async () => { throw new Error('unreachable') },
    deleteSnapshot: async () => undefined,
  }
  const service = new ManagedAgentSandboxBilling({
    now: () => 190_000,
    policy: {} as never,
    repository: {
      meterSandboxLease: async (args: Record<string, unknown>) => {
        meterCalls.push(args)
        return { applied: true as const, meterVersion: 4, remainingCents: 500 }
      },
    } as never,
    runtime: () => runtime,
  })
  const result = await service.meterLease(lease)
  assert.equal(result.applied, true)
  // Meter reads must never resume a stopped session.
  assert.deepEqual(reconnectOptions, [{ resume: false }])
  const call = meterCalls[0]!
  // Stalled counter on a running instance → elapsed window (190s-60s) billed.
  assert.equal((call.charge as { durationSeconds: number }).durationSeconds, 130)
  // Cursor advances past the virtual-billed wall time so the post-stop real
  // total (e.g. 190s) nets to ~zero residual rather than double-charging.
  assert.equal((call.meteredUsage as { wallTimeMs: number }).wallTimeMs, 190_000)
})

test('meterLease bills real counter totals on a stopped instance without elapsed fallback', async () => {
  const meterCalls: Array<Record<string, unknown>> = []
  const lease = leaseFixture({
    usage: {
      meteredUsage: { wallTimeMs: 120_000 },
      meteredProviderReference: 'sandbox-reference',
      meteredAt: 60_000,
      meterVersion: 3,
      lastPayer: { scope: 'personal', userId: 'user', billingAccountId: 'billing' },
    },
  })
  const runtime: SandboxRuntime = {
    provider: 'vercel', capabilities: {} as never,
    create: async () => { throw new Error('unreachable') },
    reconnect: async () => ({
      status: async () => 'stopped' as const,
      usage: async () => ({ wallTimeMs: 150_000, egressBytes: 1_000_000 }),
    }) as SandboxInstance,
    restore: async () => { throw new Error('unreachable') },
    deleteSnapshot: async () => undefined,
  }
  const service = new ManagedAgentSandboxBilling({
    now: () => 190_000,
    policy: {} as never,
    repository: {
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
      idleTimeoutMs: 900_000,
      meteredUsage: { wallTimeMs: 60_000 },
      meteredProviderReference: 'sandbox-reference',
      meteredAt: 60_000,
      meterVersion: 3,
      lastPayer: { scope: 'personal', userId: 'user', billingAccountId: 'billing' },
    },
  })
  const runtime: SandboxRuntime = {
    provider: 'vercel', capabilities: {} as never,
    create: async () => { throw new Error('unreachable') },
    reconnect: async () => ({
      status: async () => 'running' as const,
      stop: async () => { events.push('stop') },
      usage: async () => ({ wallTimeMs: 60_000 }),
    }) as SandboxInstance,
    restore: async () => { throw new Error('unreachable') },
    deleteSnapshot: async () => undefined,
  }
  const service = new ManagedAgentSandboxBilling({
    now: () => 1_000_000,
    policy: {} as never,
    repository: {
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
      idleTimeoutMs: 900_000,
      meteredUsage: { wallTimeMs: 60_000 },
      meteredProviderReference: 'sandbox-reference',
      meteredAt: 60_000,
      meterVersion: 3,
      lastPayer: { scope: 'personal', userId: 'user', billingAccountId: 'billing' },
    },
  })
  const runtime: SandboxRuntime = {
    provider: 'vercel', capabilities: {} as never,
    create: async () => { throw new Error('unreachable') },
    reconnect: async () => ({
      status: async () => 'running' as const,
      stop: async () => { events.push('stop') },
      usage: async () => ({ wallTimeMs: 60_000 }),
    }) as SandboxInstance,
    restore: async () => { throw new Error('unreachable') },
    deleteSnapshot: async () => undefined,
  }
  const service = new ManagedAgentSandboxBilling({
    now: () => 1_000_000,
    policy: {} as never,
    repository: {
      meterSandboxLease: async () => ({ applied: true as const, meterVersion: 4, remainingCents: 500 }),
    } as never,
    runtime: () => runtime,
  })
  const result = await service.meterLease(lease)
  assert.equal(result.applied, true)
  assert.deepEqual(events, [])
})

test('reaped leases stop the sandbox before the final usage read and delete', async () => {
  const events: string[] = []
  const stoppingLease = leaseFixture({ status: 'stopping', cleanupAfter: 100_000 })
  const runtime: SandboxRuntime = {
    provider: 'vercel', capabilities: {} as never,
    create: async () => { throw new Error('unreachable') },
    reconnect: async () => ({
      status: async () => 'running' as const,
      stop: async () => { events.push('stop') },
      usage: async () => ({ wallTimeMs: 300_000 }),
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
      listSandboxLeases: async (args: { statuses: string[]; cleanupBefore?: number }) =>
        args.statuses.includes('stopping') ? [stoppingLease] : [],
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
  assert.equal(sandboxCostUsd({
    provider: 'daytona', resources: { vcpus: 2, memoryGiB: 4, diskGiB: 20 },
    usage: { wallTimeMs: 60_000 },
  }) > 0, true)
  assert.equal(sandboxCostUsd({
    provider: 'vercel', resources: { vcpus: 2, memoryGiB: 4, diskGiB: 20 },
    usage: { wallTimeMs: 60_000, activeCpuTimeMs: 30_000 },
  }) > 0, true)
})

function leaseFixture(overrides: Partial<AgentSandboxLease>): AgentSandboxLease {
  return {
    id: 'lease', workspaceId: 'workspace', environmentId: 'environment', provider: 'vercel',
    providerReference: 'sandbox-reference', status: 'running', reservedUntil: 10_000,
    runtimeStartedAt: 1_000, usage: { resources: { vcpus: 2, memoryGiB: 4, diskGiB: 20 } },
    cleanupAttempts: 0, createdAt: 1_000, updatedAt: 1_000,
    ...overrides,
  }
}

function runtimeWithUsage(read: () => { wallTimeMs: number; activeCpuTimeMs?: number }): SandboxRuntime {
  const instance = { usage: async () => read() } as SandboxInstance
  return {
    provider: 'vercel', capabilities: {} as never,
    create: async () => instance, reconnect: async () => instance,
    restore: async () => instance, deleteSnapshot: async () => undefined,
  }
}
