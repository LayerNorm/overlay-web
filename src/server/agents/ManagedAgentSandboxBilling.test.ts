import assert from 'node:assert/strict'
import test from 'node:test'
import type { SandboxInstance, SandboxRuntime } from '@overlay/sandbox-runtime'
import { ManagedAgentSandboxBilling, sandboxCostUsd } from './ManagedAgentSandboxBilling'

test('managed sandbox reservation uses the agent spend subject and terminal retries settle once', async () => {
  let usage = { wallTimeMs: 1_000, activeCpuTimeMs: 500 }
  const reservationArgs: Array<Record<string, unknown>> = []
  const finalizedReservations = new Set<string>()
  const usageEvents: Array<Record<string, unknown>> = []
  let leaseUpdateAttempts = 0
  let settlementMarkerWrites = 0
  const policy = {
    reserve: async (args: Record<string, unknown>) => {
      reservationArgs.push(args)
      return { ok: true as const, billingAccountId: 'billing', reservationId: 'sandbox-reservation', reservedCents: 10, entitlements: {} }
    },
    markStarted: async () => ({ success: true as const }),
    release: async () => ({ success: true as const }),
    markForReconcile: async () => ({ success: true as const }),
    finalize: async (args: { reservationId?: string | null; events?: Array<Record<string, unknown>> }) => {
      if (args.reservationId && !finalizedReservations.has(args.reservationId)) {
        finalizedReservations.add(args.reservationId)
        usageEvents.push(...(args.events ?? []))
      }
      return { success: true as const }
    },
  }
  const service = new ManagedAgentSandboxBilling({
    now: () => 5_000,
    policy: policy as never,
    repository: {
      getActiveSandboxLease: async () => ({
        id: 'lease', workspaceId: 'workspace', environmentId: 'environment', provider: 'vercel',
        providerReference: 'sandbox-reference', status: 'running', reservedUntil: 10_000,
        runtimeStartedAt: 1_000, usage: { resources: { vcpus: 2, memoryGiB: 4, diskGiB: 20 } },
        cleanupAttempts: 0, createdAt: 1_000, updatedAt: 1_000,
      }),
      updateSandboxLease: async () => {
        leaseUpdateAttempts += 1
        if (leaseUpdateAttempts === 1) throw new Error('simulated crash after ledger finalization')
        return {
          id: 'lease', workspaceId: 'workspace', environmentId: 'environment', provider: 'vercel',
          providerReference: 'sandbox-reference', status: 'running', reservedUntil: 10_000,
          usage: {}, cleanupAttempts: 0, createdAt: 1_000, updatedAt: 5_000,
        }
      },
      markSandboxSettlementComplete: async () => {
        settlementMarkerWrites += 1
        return true
      },
    } as never,
    runtime: () => runtimeWithUsage(() => usage),
  })
  const billing = await service.reserve({
    agentId: 'agent', entitlements: {} as never, environmentId: 'environment',
    idempotencyKey: 'turn:sandbox', maxRunTimeMs: 60_000, maxSandboxEgressBytes: 1024,
    operationId: 'sandbox:run',
    requestFingerprint: 'fingerprint', userId: 'user', workspaceId: 'workspace',
  })
  assert.equal(reservationArgs[0]?.programmaticSubjectId, 'agent:agent')
  assert.equal(reservationArgs[0]?.kind, 'sandbox')
  usage = { wallTimeMs: 11_000, activeCpuTimeMs: 5_500 }
  const settlement = {
    agentId: 'agent', environmentId: 'environment', forceFreeTierLimits: false,
    inputTokens: 0, modelId: 'openrouter/free', modelUsageBilling: 'byok' as const,
    operationId: 'workspace-agent:turn', outcome: 'completed' as const, outputTokens: 0,
    reservationId: null, runId: 'run', sandboxBilling: billing,
    userId: 'user', workspaceId: 'workspace',
  }
  await assert.rejects(() => service.settle(settlement), /simulated crash after ledger finalization/)
  await service.settle(settlement)
  await service.settle(settlement)
  assert.equal(finalizedReservations.size, 1)
  assert.equal(usageEvents.length, 1)
  assert.equal(settlementMarkerWrites, 2)
  assert.equal(usageEvents[0]?.type, 'sandbox')
  assert.equal(usageEvents[0]?.durationSeconds, 10)
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
    repository: {} as never,
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

function runtimeWithUsage(read: () => { wallTimeMs: number; activeCpuTimeMs: number }): SandboxRuntime {
  const instance = { usage: async () => read() } as SandboxInstance
  return {
    provider: 'vercel', capabilities: {} as never,
    create: async () => instance, reconnect: async () => instance,
    restore: async () => instance, deleteSnapshot: async () => undefined,
  }
}
