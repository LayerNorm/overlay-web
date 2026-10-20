import { beforeAll, describe, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'
import type { ConnectedAgentContractRepository } from '../src/shared/agents/connected-agent-repository-contract'
import { verifyConnectedAgentRepositoryContract } from '../src/shared/agents/connected-agent-repository-contract'
import { prepareSandboxSpendLimits } from './lib/sandboxSpendLimits'

const modules = import.meta.glob('./**/*.ts')
const secret = 'connected-agent-contract-secret'

beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })

describe('Convex connected-agent provider contract', () => {
  test('runtime holds reserve workspace and subject credit, then settle only authoritative execution cost', async () => {
    const convex = convexTest(schema, modules)
    const workspaceId = 'runtime_workspace'
    const payer = { scope: 'workspace', billingAccountId: 'runtime_wallet', userId: 'user', workspaceId, spendSubjectKind: 'programmatic', spendSubjectId: 'agent:a1' }
    const call = (name: string, args: Record<string, unknown>) => convex.mutation(reference(name), { ...args, serverSecret: secret })
    await call('createEnvironmentByServer', { id: 'runtime_env', workspaceId, kind: 'managed', name: 'Runtime', status: 'online', capabilities: {}, now: 1 })
    await call('createSandboxLeaseByServer', {
      id: 'runtime_lease', workspaceId, environmentId: 'runtime_env', provider: 'e2b', providerReference: 'sandbox', status: 'running', reservedUntil: 1_000_000,
      usage: { meteredUsage: {}, meterVersion: 0, lastPayer: payer }, cleanupAttempts: 0, now: 1,
    })
    const ids = await convex.run(async (ctx) => {
      await ctx.db.insert('billingAccounts', {
        billingAccountId: 'runtime_wallet', workspaceId, scope: 'workspace', status: 'active', pricingVersion: 'markup_25_v1', markupBasisPoints: 2_500, createdAt: 1, updatedAt: 1,
      })
      const balance = await ctx.db.insert('billingAccountBalances', {
        billingAccountId: 'runtime_wallet', mode: 'budgeted', includedMicros: 10_000_000, institutionalGrantMicros: 0, allowanceUsedMicros: 0,
        topUpPurchasedMicros: 0, topUpBalanceMicros: 0, usedMicros: 0, reservedMicros: 500_000, version: 1, createdAt: 1, updatedAt: 1,
      })
      const limit = await ctx.db.insert('billingAccountSpendLimits', {
        billingAccountId: 'runtime_wallet', subjectKind: 'programmatic', subjectId: 'agent:a1', limitMicros: 5_000_000,
        usedMicros: 0, reservedMicros: 200_000, periodStart: 0, periodEnd: 1_000_000, version: 1, createdAt: 1, updatedAt: 1,
      })
      const member = await ctx.db.insert('billingAccountSpendLimits', {
        billingAccountId: 'runtime_wallet', subjectKind: 'member', subjectId: 'user', limitMicros: 6_000_000,
        usedMicros: 0, reservedMicros: 100_000, periodStart: 0, periodEnd: 1_000_000, version: 1, createdAt: 1, updatedAt: 1,
      })
      return { balance, limit, member }
    })
    const tick = (version: number, holdCents: number, costCents = 0, overrides = {}) => call('meterSandboxLeaseDebitByServer', {
      workspaceId, leaseId: 'runtime_lease', now: version + 10, meteredAt: version + 10,
      expectedMeterVersion: version, meteredProviderReference: 'sandbox', meteredUsage: { wallTimeMs: version * 1_000 },
      payer, runtimeHoldCents: holdCents, minRemainingCents: 0,
      ...(costCents ? { charge: { costCents, providerCostUsd: costCents / 125, durationSeconds: 1, modelId: 'sandbox/e2b', metadata: {} } } : {}),
      ...overrides,
    })
    expect(await tick(0, 200)).toMatchObject({ applied: true, remainingCents: 750, meterVersion: 1 })
    expect(await tick(0, 200)).toMatchObject({ applied: false, reason: 'lease_conflict' })
    expect(await tick(1, 300)).toMatchObject({ applied: true, remainingCents: 650, meterVersion: 2 })
    await convex.run(async (ctx) => {
      expect(await ctx.db.get(ids.member)).toMatchObject({ usedMicros: 0, reservedMicros: 3_100_000 })
      await ctx.db.patch(ids.member, { limitMicros: 3_500_000 })
    })
    expect(await tick(2, 400)).toMatchObject({ applied: false, reason: 'insufficient_budget', remainingCents: 340 })
    await convex.run(async (ctx) => { await ctx.db.patch(ids.member, { limitMicros: 6_000_000 }) })
    await expect(tick(2, 300, 0, { payer: { ...payer, spendSubjectId: 'agent:other' } })).rejects.toThrow('sandbox_runtime_hold_identity_changed')
    await expect(tick(2, 300, 0, { payer: { ...payer, userId: 'another-member' } })).rejects.toThrow('sandbox_runtime_hold_identity_changed')
    expect(await tick(2, 600, 0, { providerEvidence: { usage: { finalSeconds: 5 }, stopped: true } }))
      .toMatchObject({ applied: false, reason: 'insufficient_budget', remainingCents: 480 })
    await convex.run(async (ctx) => {
      expect(await ctx.db.get(ids.balance)).toMatchObject({ usedMicros: 0, reservedMicros: 3_500_000 })
      expect(await ctx.db.get(ids.limit)).toMatchObject({ usedMicros: 0, reservedMicros: 3_200_000 })
      const lease = await ctx.db.query('agentSandboxLeases').withIndex('by_leaseId', (q) => q.eq('leaseId', 'runtime_lease')).unique()
      expect(lease?.usage).toMatchObject({ meterVersion: 2, lastProviderEvidence: { usage: { finalSeconds: 5 }, stopped: true, providerReference: 'sandbox' } })
    })
    expect(await tick(2, 50, 100)).toMatchObject({ applied: true, remainingCents: 800, meterVersion: 3 })
    await convex.run(async (ctx) => { await ctx.db.patch(ids.member, { limitMicros: 1 }) })
    expect(await tick(3, 0, 20)).toMatchObject({ applied: true, remainingCents: 830, meterVersion: 4 })
    await convex.run(async (ctx) => {
      expect(await ctx.db.get(ids.balance)).toMatchObject({ usedMicros: 1_200_000, allowanceUsedMicros: 1_200_000, reservedMicros: 500_000 })
      expect(await ctx.db.get(ids.limit)).toMatchObject({ usedMicros: 1_200_000, reservedMicros: 200_000 })
      expect(await ctx.db.get(ids.member)).toMatchObject({ usedMicros: 1_200_000, reservedMicros: 100_000 })
      const operations = await ctx.db.query('usageOperations').collect()
      expect(operations).toHaveLength(2)
      expect(operations[0]?.sandboxEvidence).toMatchObject({ category: 'compute', provider: 'e2b', providerCostUsd: 0.8, pricingVersion: 'markup_25_v1' })
    })
  })

  test('a previous-period runtime hold cannot consume another reservation after limit rollover', async () => {
    const convex = convexTest(schema, modules)
    await convex.run(async (ctx) => {
      const limit = await ctx.db.insert('billingAccountSpendLimits', {
        billingAccountId: 'wallet', subjectKind: 'member', subjectId: 'user', limitMicros: 600,
        usedMicros: 100, reservedMicros: 200, periodStart: 100, periodEnd: 1_000, version: 2, createdAt: 1, updatedAt: 100,
      })
      const result = await prepareSandboxSpendLimits(ctx, {
        billingAccountId: 'wallet', userId: 'user', now: 200,
        usage: { runtimeHoldLimits: [{ id: limit, periodStart: 0 }] },
        previousHoldMicros: 500, holdMicros: 350, chargeMicros: 0,
      })
      expect(result).toEqual({ ok: false, remainingMicros: 300 })
      expect(await ctx.db.get(limit)).toMatchObject({ usedMicros: 100, reservedMicros: 200 })
    })
  })

  test('rejects a missing server capability before reading tenant state', async () => {
    const convex = convexTest(schema, modules)
    await expect(convex.mutation(reference('createEnvironmentByServer'), {
      serverSecret: 'wrong-secret', id: 'environment', workspaceId: 'workspace', kind: 'local',
      name: 'Host', status: 'online', capabilities: {}, now: 1,
    })).rejects.toThrow(/Unauthorized/)
  })

  test('claims meter batches by due time and makes overlapping sweeps disjoint', async () => {
    const convex = convexTest(schema, modules)
    const call = (name: string, args: Record<string, unknown>) => convex.mutation(reference(name), { ...args, serverSecret: secret })
    for (let index = 0; index < 45; index += 1) {
      await call('createEnvironmentByServer', {
        id: `env-${index}`, workspaceId: 'fair-ws', kind: 'managed', name: 'Fair lease',
        status: 'online', capabilities: {}, now: 1,
      })
      await call('createSandboxLeaseByServer', {
        id: `fair-${index}`, workspaceId: 'fair-ws',
        environmentId: `env-${index}`, provider: 'box', status: 'running',
        reservedUntil: 500_000, usage: { meteredUsage: {}, meterVersion: 0 },
        cleanupAttempts: 0, now: 1, nextMeterAt: index === 0 ? undefined : 1,
      })
    }
    const claim = (token: string) => call('claimSandboxLeasesByServer', {
      statuses: ['running'], now: 10_000, limit: 20, claimToken: token, claimUntil: 40_000,
    })
    const [firstResult, overlappingResult] = await Promise.all([claim('sweep-a'), claim('sweep-b')]) as Array<{
      leases: Array<{ id: string }>
      deferred: boolean
    }>
    const first = firstResult.leases
    const overlapping = overlappingResult.leases
    const firstIds = new Set([...first, ...overlapping].map((lease) => lease.id))
    expect(first.length + overlapping.length).toBe(40)
    expect(firstIds.size).toBe(40)
    const remaining = (await claim('sweep-c') as { leases: Array<{ id: string }> }).leases
    expect(remaining).toHaveLength(5)
    expect(remaining.some((lease) => firstIds.has(lease.id))).toBe(false)
    const last = await claim('sweep-d') as { leases: Array<{ id: string }> }
    expect(last.leases).toHaveLength(0)
  })

  test('defers blocked cleanup heads so due leases behind more than one batch become claimable', async () => {
    const convex = convexTest(schema, modules)
    const call = (name: string, args: Record<string, unknown>) => convex.mutation(reference(name), { ...args, serverSecret: secret })
    for (let index = 0; index < 33; index += 1) {
      await call('createEnvironmentByServer', {
        id: `blocked-env-${index}`, workspaceId: 'defer-ws', kind: 'managed', name: 'Deferred lease',
        status: 'online', capabilities: {}, now: 1,
      })
      await call('createSandboxLeaseByServer', {
        id: `defer-${index}`, workspaceId: 'defer-ws',
        environmentId: `blocked-env-${index}`, provider: 'box', status: 'running',
        reservedUntil: 500_000, usage: { meteredUsage: {}, meterVersion: 0 },
        cleanupAttempts: 0, cleanupAfter: index < 30 ? 20_000 : undefined, now: 1,
      })
    }
    const claim = (token: string) => call('claimSandboxLeasesByServer', {
      statuses: ['running'], now: 10_000, limit: 20, claimToken: token, claimUntil: 40_000,
    }) as Promise<{ leases: Array<{ id: string }>; deferred: boolean }>
    const deferred = await claim('blocked-a')
    expect(deferred.leases).toHaveLength(0)
    expect(deferred.deferred).toBe(true)
    const due = await claim('blocked-b')
    expect(due.leases.map((lease) => lease.id)).toEqual(['defer-30', 'defer-31', 'defer-32'])
  })

  test('passes shared lifecycle, tenancy, ordering and deletion semantics', async () => {
    const convex = convexTest(schema, modules)
    const call = async <T>(operation: string, args: Record<string, unknown>): Promise<T> => {
      return await convex.mutation(reference(operation), { ...args, serverSecret: secret }) as T
    }
    const read = async <T>(operation: string, args: Record<string, unknown>): Promise<T> => {
      return await convex.query(queryReference(operation), { ...args, serverSecret: secret }) as T
    }
    const controlCall = async <T>(operation: string, args: Record<string, unknown>): Promise<T> => {
      return await convex.mutation(controlReference(operation), { ...args, serverSecret: secret }) as T
    }
    const controlRead = async <T>(operation: string, args: Record<string, unknown>): Promise<T> => {
      return await convex.query(controlQueryReference(operation), { ...args, serverSecret: secret }) as T
    }
    const repository: ConnectedAgentContractRepository = {
      createEnrollmentSession: (input) => controlCall('createEnrollmentSessionByServer', input),
      redeemEnrollmentSession: (input) => controlCall('redeemEnrollmentSessionByServer', input),
      listEnvironments: (input) => controlRead('listEnvironmentsByServer', input),
      getEnvironment: (input) => controlRead('getEnvironmentByServer', input),
      getEnvironmentEnrollment: (input) => controlRead('getEnvironmentEnrollmentByServer', input),
      approveEnvironment: (input) => controlCall('approveEnvironmentByServer', input),
      updateEnvironmentFilesystemGrant: (input) => controlCall('updateEnvironmentFilesystemGrantByServer', input),
      getEnvironmentProofChallenge: (input) => controlRead('getEnvironmentProofChallengeByServer', input),
      issueEnvironmentCredential: (input) => controlCall('issueEnvironmentCredentialByServer', input),
      findEnvironmentCredential: (input) => controlRead('findEnvironmentCredentialByServer', input),
      consumeEnvironmentProofNonce: (input) => controlCall('consumeEnvironmentProofNonceByServer', input),
      rotateEnvironmentCredential: (input) => controlCall('rotateEnvironmentCredentialByServer', input),
      heartbeatEnvironment: (input) => controlCall('heartbeatEnvironmentByServer', input),
      updateEnvironmentCapabilities: (input) => controlCall('updateEnvironmentCapabilitiesByServer', input),
      createEnvironment: (input) => call('createEnvironmentByServer', input),
      createBinding: (input) => call('createBindingByServer', input),
      createRemoteSession: (input) => call('createRemoteSessionByServer', input),
      enqueueCommand: (input) => call('enqueueCommandByServer', input),
      claimCommands: (input) => call('claimCommandsByServer', input),
      acknowledgeCommand: (input) => call('acknowledgeCommandByServer', input),
      createApprovalRequest: (input) => call('createApprovalRequestByServer', input),
      resolveApprovalRequest: (input) => call('resolveApprovalRequestByServer', input),
      createArtifact: (input) => call('createArtifactByServer', input),
      getArtifact: (input) => read('getArtifactByServer', input),
      finalizeArtifact: (input) => call('finalizeArtifactByServer', input),
      listArtifactsForCleanup: (input) => read('listArtifactsForCleanupByServer', input),
      markArtifactDeleted: (input) => call('markArtifactDeletedByServer', input),
      createSandboxLease: (input) => call('createSandboxLeaseByServer', input),
      updateSandboxLease: (input) => call('updateSandboxLeaseByServer', input),
      getHarnessSession: (input) => read('getHarnessSessionByServer', input),
      upsertHarnessSession: (input) => call('upsertHarnessSessionByServer', input),
      deleteHarnessSessionsForBinding: (input) => call('deleteHarnessSessionsForBindingByServer', input),
      applyRemoteEvents: (input) => call('applyRemoteEventsByServer', input),
      revokeEnvironment: (input) => call('revokeEnvironmentByServer', input),
      deleteWorkspaceData: (input) => call('deleteWorkspaceDataByServer', input),
    }
    await verifyConnectedAgentRepositoryContract({
      repository, prefix: 'convex_contract', workspaceId: 'workspace_owner',
      otherWorkspaceId: 'workspace_foreign', runId: 'run_owner',
    })
  })

  test('sandbox lease meter debits only the usage delta and enforces the low-balance floor', async () => {
    const convex = convexTest(schema, modules)
    const call = async <T>(operation: string, args: Record<string, unknown>): Promise<T> => {
      return await convex.mutation(reference(operation), { ...args, serverSecret: secret }) as T
    }
    const read = async <T>(operation: string, args: Record<string, unknown>): Promise<T> => {
      return await convex.query(queryReference(operation), { ...args, serverSecret: secret }) as T
    }
    const workspaceId = 'meter_workspace'
    await call('createEnvironmentByServer', {
      id: 'meter_env', workspaceId, kind: 'managed', name: 'Managed', status: 'online',
      capabilities: {}, approvedByUserId: 'user_meter', now: 1,
    })
    await call('createSandboxLeaseByServer', {
      id: 'meter_lease', workspaceId, environmentId: 'meter_env', provider: 'vercel',
      providerReference: 'sandbox-1', status: 'running', reservedUntil: 86_400_000,
      runtimeStartedAt: 0, usage: {
        resources: { vcpus: 2, memoryGiB: 4, diskGiB: 20 },
        meteredUsage: { wallTimeMs: 60_000 },
        meteredProviderReference: 'sandbox-1',
        meterVersion: 0,
        lastPayer: {
          scope: 'workspace', billingAccountId: 'billing_meter', userId: 'user_meter',
          workspaceId, spendSubjectKind: 'programmatic', spendSubjectId: 'agent:a1',
        },
      },
      cleanupAttempts: 0, now: 1,
    })
    await convex.run(async (ctx) => {
      await ctx.db.insert('billingAccounts', {
        billingAccountId: 'billing_meter', scope: 'workspace', workspaceId,
        status: 'active', pricingVersion: 'markup_25_v1', markupBasisPoints: 2_500,
        createdAt: 1, updatedAt: 1,
      })
      // $10 funded: $10 = 1000 cents = 10_000_000 micros.
      await ctx.db.insert('billingAccountBalances', {
        billingAccountId: 'billing_meter', mode: 'budgeted',
        includedMicros: 10_000_000, institutionalGrantMicros: 0, allowanceUsedMicros: 0,
        topUpPurchasedMicros: 0, topUpBalanceMicros: 0, usedMicros: 0, reservedMicros: 0,
        version: 1, createdAt: 1, updatedAt: 1,
      })
    })

    // Tick 1: 60s→130s of wall time billed at $2 with the $1 floor — applied.
    const first = await call<{ applied: boolean; meterVersion: number; remainingCents?: number }>(
      'meterSandboxLeaseDebitByServer', {
        workspaceId, leaseId: 'meter_lease', now: 200,
        expectedMeterVersion: 0,
        meteredUsage: { wallTimeMs: 130_000 },
        meteredProviderReference: 'sandbox-1',
        meteredAt: 200,
        payer: {
          scope: 'workspace', billingAccountId: 'billing_meter', userId: 'user_meter',
          workspaceId, spendSubjectKind: 'programmatic', spendSubjectId: 'agent:a1',
        },
        charge: { costCents: 200, durationSeconds: 70, modelId: 'sandbox/vercel', providerCostUsd: 1.6, metadata: {} },
        minRemainingCents: 100,
      })
    expect(first).toMatchObject({ applied: true, meterVersion: 1, remainingCents: 800 })

    // A retried tick replays with a stale cursor version — conflict, no double charge.
    const replay = await call<{ applied: boolean; reason?: string }>(
      'meterSandboxLeaseDebitByServer', {
        workspaceId, leaseId: 'meter_lease', now: 201,
        expectedMeterVersion: 0,
        meteredUsage: { wallTimeMs: 130_000 },
        meteredProviderReference: 'sandbox-1',
        meteredAt: 201,
        charge: { costCents: 200, durationSeconds: 70, modelId: 'sandbox/vercel', providerCostUsd: 1.6, metadata: {} },
        minRemainingCents: 100,
      })
    expect(replay).toMatchObject({ applied: false, reason: 'lease_conflict' })

    // Tick 2: charge + $9 floor exceeds the $8 remaining — declined, nothing billed.
    const declined = await call<{ applied: boolean; reason?: string; remainingCents?: number }>(
      'meterSandboxLeaseDebitByServer', {
        workspaceId, leaseId: 'meter_lease', now: 300,
        expectedMeterVersion: 1,
        meteredUsage: { wallTimeMs: 200_000 },
        meteredProviderReference: 'sandbox-1',
        meteredAt: 300,
        payer: {
          scope: 'workspace', billingAccountId: 'billing_meter', userId: 'user_meter',
          workspaceId, spendSubjectKind: 'programmatic', spendSubjectId: 'agent:a1',
        },
        charge: { costCents: 100, durationSeconds: 70, modelId: 'sandbox/vercel', providerCostUsd: 0.8, metadata: {} },
        minRemainingCents: 900,
      })
    expect(declined).toMatchObject({ applied: false, reason: 'insufficient_budget', remainingCents: 800 })

    const limitId = await convex.run(async (ctx) => {
      await ctx.db.insert('billingAccounts', {
        billingAccountId: 'foreign_wallet', scope: 'workspace', workspaceId: 'foreign_workspace',
        status: 'active', pricingVersion: 'markup_25_v1', markupBasisPoints: 2_500, createdAt: 1, updatedAt: 1,
      })
      await ctx.db.insert('billingAccountBalances', {
        billingAccountId: 'foreign_wallet', mode: 'budgeted', includedMicros: 10_000_000,
        institutionalGrantMicros: 0, allowanceUsedMicros: 0, topUpPurchasedMicros: 0,
        topUpBalanceMicros: 0, usedMicros: 0, reservedMicros: 0, version: 1, createdAt: 1, updatedAt: 1,
      })
      return await ctx.db.insert('billingAccountSpendLimits', {
        billingAccountId: 'billing_meter', subjectKind: 'programmatic', subjectId: 'agent:a1',
        limitMicros: 1_000_000, usedMicros: 990_000, reservedMicros: 10_000,
        periodStart: 0, periodEnd: 1_000, version: 1, createdAt: 1, updatedAt: 1,
      })
    })
    const nextTick = {
      workspaceId, leaseId: 'meter_lease', now: 301, expectedMeterVersion: 1,
      meteredUsage: { wallTimeMs: 200_000 }, meteredAt: 301,
      meteredProviderReference: 'sandbox-1', minRemainingCents: 0,
      charge: { costCents: 1, durationSeconds: 1, modelId: 'sandbox/box', providerCostUsd: 0.008, metadata: {} },
    }
    await expect(call('meterSandboxLeaseDebitByServer', {
      ...nextTick, payer: { scope: 'workspace', billingAccountId: 'foreign_wallet', userId: 'user_meter', workspaceId: 'foreign_workspace' },
    })).rejects.toThrow('workspace_billing_account_mismatch')
    const limited = await call('meterSandboxLeaseDebitByServer', {
      ...nextTick, payer: { scope: 'workspace', billingAccountId: 'billing_meter', userId: 'user_meter', workspaceId, spendSubjectKind: 'programmatic', spendSubjectId: 'agent:a1' },
    })
    expect(limited).toMatchObject({ applied: false, reason: 'insufficient_budget', remainingCents: 0 })
    expect(await read('getSandboxLeaseByServer', { workspaceId, leaseId: 'meter_lease' })).toMatchObject({ usage: { meterVersion: 1 } })
    await convex.run(async (ctx) => {
      const foreign = await ctx.db.query('billingAccountBalances').withIndex('by_billingAccountId', (q) => q.eq('billingAccountId', 'foreign_wallet')).unique()
      expect(foreign?.usedMicros).toBe(0)
      await ctx.db.delete(limitId)
    })

    // Stop the lease: status flips to stopping, still meterable for the tail.
    const stopped = await call<{ status: string }>('stopSandboxLeaseByServer', {
      workspaceId, leaseId: 'meter_lease', reason: 'low_balance', now: 400,
    })
    expect(stopped.status).toBe('stopping')

    // Final tick on a stopping lease with no floor: bills the tail and still
    // reports the remaining balance.
    const final = await call<{ applied: boolean; meterVersion: number; remainingCents?: number }>(
      'meterSandboxLeaseDebitByServer', {
        workspaceId, leaseId: 'meter_lease', now: 500,
        expectedMeterVersion: 1,
        meteredUsage: { wallTimeMs: 200_000 },
        meteredProviderReference: 'sandbox-1',
        meteredAt: 500,
        payer: {
          scope: 'workspace', billingAccountId: 'billing_meter', userId: 'user_meter',
          workspaceId, spendSubjectKind: 'programmatic', spendSubjectId: 'agent:a1',
        },
        charge: { costCents: 100, durationSeconds: 70, modelId: 'sandbox/vercel', providerCostUsd: 0.8, metadata: {} },
        minRemainingCents: 0,
      })
    expect(final).toMatchObject({ applied: true, meterVersion: 2, remainingCents: 700 })

    const lease = await read<{ status: string; usage: { meterVersion: number; meteredUsage: { wallTimeMs: number } } }>(
      'getSandboxLeaseByServer', { workspaceId, leaseId: 'meter_lease' })
    expect(lease.status).toBe('stopping')
    expect(lease.usage.meterVersion).toBe(2)
    expect(lease.usage.meteredUsage.wallTimeMs).toBe(200_000)
  })
})

function reference(operation: string) {
  return makeFunctionReference<'mutation'>(`agents/connectedAgents:${operation}`)
}

function queryReference(operation: string) {
  return makeFunctionReference<'query'>(`agents/connectedAgents:${operation}`)
}

function controlReference(operation: string) {
  return makeFunctionReference<'mutation'>(`agents/environmentControlPlane:${operation}`)
}

function controlQueryReference(operation: string) {
  return makeFunctionReference<'query'>(`agents/environmentControlPlane:${operation}`)
}
