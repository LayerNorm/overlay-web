import { beforeAll, describe, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'
import type { ConnectedAgentContractRepository } from '../src/shared/agents/connected-agent-repository-contract'
import { verifyConnectedAgentRepositoryContract } from '../src/shared/agents/connected-agent-repository-contract'
import { chargeSandboxSpendLimits } from './lib/sandboxSpendLimits'

const modules = import.meta.glob('./**/*.ts')
const secret = 'connected-agent-contract-secret'

beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })

describe('Convex connected-agent provider contract', () => {
  test('observed machine usage is charged with no hold, capped at the balance, and reports budget low and spend limits', async () => {
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
      await ctx.db.insert('billingAccountSubscriptions', subscriptionRow('runtime_wallet'))
      // $10 budget: the 2% stop line is 20 cents.
      const balance = await ctx.db.insert('billingAccountBalances', {
        billingAccountId: 'runtime_wallet', mode: 'budgeted', includedMicros: 10_000_000, institutionalGrantMicros: 0, allowanceUsedMicros: 0,
        topUpPurchasedMicros: 0, topUpBalanceMicros: 0, usedMicros: 0, reservedMicros: 0, version: 1, createdAt: 1, updatedAt: 1,
      })
      const limit = await ctx.db.insert('billingAccountSpendLimits', {
        billingAccountId: 'runtime_wallet', subjectKind: 'programmatic', subjectId: 'agent:a1', limitMicros: 50_000_000,
        usedMicros: 0, reservedMicros: 0, periodStart: 0, periodEnd: 1_000_000, version: 1, createdAt: 1, updatedAt: 1,
      })
      const member = await ctx.db.insert('billingAccountSpendLimits', {
        billingAccountId: 'runtime_wallet', subjectKind: 'member', subjectId: 'user', limitMicros: 60_000_000,
        usedMicros: 0, reservedMicros: 0, periodStart: 0, periodEnd: 1_000_000, version: 1, createdAt: 1, updatedAt: 1,
      })
      return { balance, limit, member }
    })
    const tick = (version: number, costCents: number, overrides = {}) => call('meterSandboxLeaseDebitByServer', {
      workspaceId, leaseId: 'runtime_lease', now: version + 10, meteredAt: version + 10,
      expectedMeterVersion: version, meteredProviderReference: 'sandbox', meteredUsage: { wallTimeMs: version * 1_000 },
      payer,
      charge: { costCents, providerCostUsd: costCents / 125, durationSeconds: 1, modelId: 'sandbox/e2b', metadata: {} },
      ...overrides,
    })
    expect(await tick(0, 100)).toMatchObject({ applied: true, remainingCents: 900, meterVersion: 1, budgetLow: false, spendLimitReached: false })
    expect(await tick(0, 100)).toMatchObject({ applied: false, reason: 'lease_conflict' })
    await convex.run(async (ctx) => { await ctx.db.patch(ids.member, { limitMicros: 1_500_000 }) })
    // An admin spend limit is enforced when charging: the usage is recorded and the caller stops the machine.
    expect(await tick(1, 50)).toMatchObject({ applied: true, remainingCents: 850, spendLimitReached: true, budgetLow: false })
    await convex.run(async (ctx) => { await ctx.db.patch(ids.member, { limitMicros: 60_000_000 }) })
    // A charge that leaves under 2% (15 of 1000 cents) is applied and reports budgetLow.
    expect(await tick(2, 835)).toMatchObject({ applied: true, remainingCents: 15, budgetLow: true, spendLimitReached: false })
    // Overshoot: the charge is capped at what is left and the balance never goes negative.
    expect(await tick(3, 500)).toMatchObject({ applied: true, remainingCents: 0, budgetLow: true, meterVersion: 4 })
    await convex.run(async (ctx) => {
      expect(await ctx.db.get(ids.balance)).toMatchObject({ usedMicros: 10_000_000, allowanceUsedMicros: 10_000_000, reservedMicros: 0 })
      expect(await ctx.db.get(ids.limit)).toMatchObject({ usedMicros: 10_000_000, reservedMicros: 0 })
      expect(await ctx.db.get(ids.member)).toMatchObject({ usedMicros: 10_000_000, reservedMicros: 0 })
      const operations = await ctx.db.query('usageOperations').collect()
      expect(operations).toHaveLength(4)
      expect(operations[0]?.sandboxEvidence).toMatchObject({ category: 'compute', provider: 'e2b', providerCostUsd: 0.8, pricingVersion: 'markup_25_v1' })
      expect(operations[3]).toMatchObject({ cents: 15 })
      const lease = await ctx.db.query('agentSandboxLeases').withIndex('by_leaseId', (q) => q.eq('leaseId', 'runtime_lease')).unique()
      expect((lease?.usage as Record<string, unknown>).runtimeHoldMicros).toBeUndefined()
    })
  })

  test('a hold a lease kept from before holds were removed is released on its next tick', async () => {
    const convex = convexTest(schema, modules)
    const workspaceId = 'legacy_workspace'
    const payer = { scope: 'workspace', billingAccountId: 'legacy_wallet', userId: 'user', workspaceId, spendSubjectKind: 'member', spendSubjectId: 'user' }
    const call = (name: string, args: Record<string, unknown>) => convex.mutation(reference(name), { ...args, serverSecret: secret })
    await call('createEnvironmentByServer', { id: 'legacy_env', workspaceId, kind: 'managed', name: 'Legacy', status: 'online', capabilities: {}, now: 1 })
    const ids = await convex.run(async (ctx) => {
      await ctx.db.insert('billingAccounts', {
        billingAccountId: 'legacy_wallet', workspaceId, scope: 'workspace', status: 'active', pricingVersion: 'markup_25_v1', markupBasisPoints: 2_500, createdAt: 1, updatedAt: 1,
      })
      await ctx.db.insert('billingAccountSubscriptions', subscriptionRow('legacy_wallet'))
      const balance = await ctx.db.insert('billingAccountBalances', {
        billingAccountId: 'legacy_wallet', mode: 'budgeted', includedMicros: 10_000_000, institutionalGrantMicros: 0, allowanceUsedMicros: 0,
        topUpPurchasedMicros: 0, topUpBalanceMicros: 0, usedMicros: 0, reservedMicros: 300_000, version: 1, createdAt: 1, updatedAt: 1,
      })
      const member = await ctx.db.insert('billingAccountSpendLimits', {
        billingAccountId: 'legacy_wallet', subjectKind: 'member', subjectId: 'user', limitMicros: 6_000_000,
        usedMicros: 0, reservedMicros: 300_000, periodStart: 0, periodEnd: 1_000_000, version: 1, createdAt: 1, updatedAt: 1,
      })
      return { balance, member }
    })
    await call('createSandboxLeaseByServer', {
      id: 'legacy_lease', workspaceId, environmentId: 'legacy_env', provider: 'box', providerReference: 'sandbox', status: 'running', reservedUntil: 1_000_000,
      usage: {
        meteredUsage: {}, meterVersion: 0, lastPayer: payer, runtimeHoldMicros: 300_000, runtimeHoldPayer: payer,
        runtimeHoldLimits: [{ id: ids.member, periodStart: 0 }],
      }, cleanupAttempts: 0, now: 1,
    })
    expect(await call('meterSandboxLeaseDebitByServer', {
      workspaceId, leaseId: 'legacy_lease', now: 10, meteredAt: 10, expectedMeterVersion: 0,
      meteredProviderReference: 'sandbox', meteredUsage: {}, payer,
      charge: { costCents: 10, providerCostUsd: 0.08, durationSeconds: 1, modelId: 'sandbox/box', metadata: {} },
    })).toMatchObject({ applied: true, remainingCents: 990, budgetLow: false })
    await convex.run(async (ctx) => {
      expect(await ctx.db.get(ids.balance)).toMatchObject({ usedMicros: 100_000, reservedMicros: 0 })
      expect(await ctx.db.get(ids.member)).toMatchObject({ usedMicros: 100_000, reservedMicros: 0 })
      const lease = await ctx.db.query('agentSandboxLeases').withIndex('by_leaseId', (q) => q.eq('leaseId', 'legacy_lease')).unique()
      expect(lease?.usage).toMatchObject({ runtimeHoldMicros: 0, runtimeHoldPayer: null })
    })
  })

  test('without a paid plan, live machine time is refused but confirmed-stopped usage still settles', async () => {
    const convex = convexTest(schema, modules)
    const workspaceId = 'downgrade_workspace'
    const payer = { scope: 'workspace', billingAccountId: 'downgrade_wallet', userId: 'user', workspaceId }
    const call = (name: string, args: Record<string, unknown>) => convex.mutation(reference(name), { ...args, serverSecret: secret })
    await call('createEnvironmentByServer', { id: 'downgrade_env', workspaceId, kind: 'managed', name: 'Downgrade', status: 'online', capabilities: {}, now: 1 })
    await call('createSandboxLeaseByServer', {
      id: 'downgrade_lease', workspaceId, environmentId: 'downgrade_env', provider: 'box', providerReference: 'sandbox', status: 'running', reservedUntil: 1_000_000,
      usage: { meteredUsage: {}, meterVersion: 0, meteredProviderReference: 'sandbox', lastPayer: payer }, cleanupAttempts: 0, now: 1,
    })
    await convex.run(async (ctx) => {
      await ctx.db.insert('billingAccounts', {
        billingAccountId: 'downgrade_wallet', workspaceId, scope: 'workspace', status: 'active', pricingVersion: 'markup_25_v1', markupBasisPoints: 2_500, createdAt: 1, updatedAt: 1,
      })
      await ctx.db.insert('billingAccountSubscriptions', subscriptionRow('downgrade_wallet', 'free'))
      await ctx.db.insert('billingAccountBalances', {
        billingAccountId: 'downgrade_wallet', mode: 'budgeted', includedMicros: 10_000_000, institutionalGrantMicros: 0, allowanceUsedMicros: 0,
        topUpPurchasedMicros: 0, topUpBalanceMicros: 0, usedMicros: 0, reservedMicros: 0, version: 1, createdAt: 1, updatedAt: 1,
      })
    })
    const charge = { costCents: 50, providerCostUsd: 0.4, durationSeconds: 60, modelId: 'sandbox/box', metadata: {} }
    const tick = (overrides: Record<string, unknown>) => call('meterSandboxLeaseDebitByServer', {
      workspaceId, leaseId: 'downgrade_lease', now: 10, meteredAt: 10, expectedMeterVersion: 0,
      meteredProviderReference: 'sandbox', meteredUsage: { wallTimeMs: 60_000 }, payer, ...overrides,
    })
    expect(await tick({ charge, providerEvidence: { usage: {}, stopped: false } })).toMatchObject({ applied: false, reason: 'paid_plan_required' })
    expect(await tick({ charge, providerEvidence: { usage: {}, stopped: true } })).toMatchObject({ applied: true, meterVersion: 1, remainingCents: 950 })
    await convex.run(async (ctx) => {
      expect(await ctx.db.query('usageOperations').collect()).toHaveLength(1)
    })
  })

  test('a previous-period legacy hold is not released from a new spend-limit period', async () => {
    const convex = convexTest(schema, modules)
    await convex.run(async (ctx) => {
      const limit = await ctx.db.insert('billingAccountSpendLimits', {
        billingAccountId: 'wallet', subjectKind: 'member', subjectId: 'user', limitMicros: 600,
        usedMicros: 100, reservedMicros: 200, periodStart: 100, periodEnd: 1_000, version: 2, createdAt: 1, updatedAt: 100,
      })
      const result = await chargeSandboxSpendLimits(ctx, {
        billingAccountId: 'wallet', userId: 'user', now: 200,
        usage: { runtimeHoldLimits: [{ id: limit, periodStart: 0 }] },
        previousHoldMicros: 500, chargeMicros: 0,
      })
      expect(result).toEqual({ limitReached: false })
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

  test('retired Cloud transactions reject starts, preserve only inert controls, and neutralize queued work', async () => {
    const convex = convexTest(schema, modules)
    const call = (name: string, args: Record<string, unknown>) => convex.mutation(reference(name), { ...args, serverSecret: secret })
    await convex.run(async (ctx) => {
      await ctx.db.insert('agentEnvironments', {
        environmentId: 'retired-cloud', workspaceId: 'retired-ws', kind: 'overlay_cloud',
        name: 'Legacy', status: 'online', capabilities: {}, createdAt: 1, updatedAt: 1,
      })
      await ctx.db.insert('agentRunCommands', {
        commandId: 'old-start', workspaceId: 'retired-ws', environmentId: 'retired-cloud',
        runId: 'old-run', type: 'start', sequence: 1, payload: { adapterId: 'codex' },
        status: 'pending', createdAt: 1, updatedAt: 1,
      })
    })
    await expect(call('createRemoteSessionByServer', {
      id: 'session', workspaceId: 'retired-ws', environmentId: 'retired-cloud',
      bindingId: 'missing-binding', runId: 'old-run', status: 'running', commandCursor: 0,
      eventCursor: 0, capabilitySnapshot: {}, now: 2,
    })).rejects.toThrow('HOSTED_RUNTIME_RETIRED')
    await expect(call('enqueueCommandByServer', {
      id: 'new-start', workspaceId: 'retired-ws', environmentId: 'retired-cloud',
      runId: 'old-run', type: 'start', payload: {}, now: 2,
    })).rejects.toThrow('HOSTED_RUNTIME_RETIRED')
    for (const [index, type] of ['observe', 'cancel', 'shutdown'].entries()) {
      await call('enqueueCommandByServer', {
        id: `safe-${type}`, workspaceId: 'retired-ws', environmentId: 'retired-cloud',
        runId: 'old-run', type, payload: {}, now: 3 + index,
      })
    }
    const claimed = await call('claimCommandsByServer', {
      workspaceId: 'retired-ws', environmentId: 'retired-cloud', now: 10, leaseMs: 10_000, limit: 10,
    }) as Array<{ id: string }>
    expect(claimed.map((command) => command.id)).toEqual(['safe-observe', 'safe-cancel', 'safe-shutdown'])
    await convex.run(async (ctx) => {
      const oldStart = await ctx.db.query('agentRunCommands')
        .withIndex('by_commandId', (q) => q.eq('commandId', 'old-start')).unique()
      expect(oldStart?.status).toBe('cancelled')
    })
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
      await ctx.db.insert('billingAccountSubscriptions', subscriptionRow('billing_meter'))
      // $10 funded: $10 = 1000 cents = 10_000_000 micros.
      await ctx.db.insert('billingAccountBalances', {
        billingAccountId: 'billing_meter', mode: 'budgeted',
        includedMicros: 10_000_000, institutionalGrantMicros: 0, allowanceUsedMicros: 0,
        topUpPurchasedMicros: 0, topUpBalanceMicros: 0, usedMicros: 0, reservedMicros: 0,
        version: 1, createdAt: 1, updatedAt: 1,
      })
    })

    // Tick 1: 60s→130s of wall time billed at $2 — applied, nothing held, no floor.
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
      })
    expect(first).toMatchObject({ applied: true, meterVersion: 1, remainingCents: 800, budgetLow: false })

    // A retried tick replays with a stale cursor version — conflict, no double charge.
    const replay = await call<{ applied: boolean; reason?: string }>(
      'meterSandboxLeaseDebitByServer', {
        workspaceId, leaseId: 'meter_lease', now: 201,
        expectedMeterVersion: 0,
        meteredUsage: { wallTimeMs: 130_000 },
        meteredProviderReference: 'sandbox-1',
        meteredAt: 201,
        charge: { costCents: 200, durationSeconds: 70, modelId: 'sandbox/vercel', providerCostUsd: 1.6, metadata: {} },
      })
    expect(replay).toMatchObject({ applied: false, reason: 'lease_conflict' })

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
      meteredProviderReference: 'sandbox-1',
      charge: { costCents: 1, durationSeconds: 1, modelId: 'sandbox/box', providerCostUsd: 0.008, metadata: {} },
    }
    await expect(call('meterSandboxLeaseDebitByServer', {
      ...nextTick, payer: { scope: 'workspace', billingAccountId: 'foreign_wallet', userId: 'user_meter', workspaceId: 'foreign_workspace' },
    })).rejects.toThrow('workspace_billing_account_mismatch')
    const limited = await call('meterSandboxLeaseDebitByServer', {
      ...nextTick, payer: { scope: 'workspace', billingAccountId: 'billing_meter', userId: 'user_meter', workspaceId, spendSubjectKind: 'programmatic', spendSubjectId: 'agent:a1' },
    })
    // The used-up agent limit is enforced when charging: the observed cent is recorded and the machine must stop.
    expect(limited).toMatchObject({ applied: true, meterVersion: 2, spendLimitReached: true, remainingCents: 799 })
    expect(await read('getSandboxLeaseByServer', { workspaceId, leaseId: 'meter_lease' })).toMatchObject({ usage: { meterVersion: 2 } })
    await convex.run(async (ctx) => {
      const foreign = await ctx.db.query('billingAccountBalances').withIndex('by_billingAccountId', (q) => q.eq('billingAccountId', 'foreign_wallet')).unique()
      expect(foreign?.usedMicros).toBe(0)
      await ctx.db.delete(limitId)
    })

    // Stop the lease: status flips to stopping, still meterable for the tail.
    const stopped = await call<{ status: string }>('stopSandboxLeaseByServer', {
      workspaceId, leaseId: 'meter_lease', reason: 'budget_exhausted', now: 400,
    })
    expect(stopped.status).toBe('stopping')

    // Final tick on a stopping lease: bills the tail and still reports the remaining balance.
    const final = await call<{ applied: boolean; meterVersion: number; remainingCents?: number }>(
      'meterSandboxLeaseDebitByServer', {
        workspaceId, leaseId: 'meter_lease', now: 500,
        expectedMeterVersion: 2,
        meteredUsage: { wallTimeMs: 200_000 },
        meteredProviderReference: 'sandbox-1',
        meteredAt: 500,
        payer: {
          scope: 'workspace', billingAccountId: 'billing_meter', userId: 'user_meter',
          workspaceId, spendSubjectKind: 'programmatic', spendSubjectId: 'agent:a1',
        },
        charge: { costCents: 100, durationSeconds: 70, modelId: 'sandbox/vercel', providerCostUsd: 0.8, metadata: {} },
      })
    expect(final).toMatchObject({ applied: true, meterVersion: 3, remainingCents: 699 })

    const lease = await read<{ status: string; usage: { meterVersion: number; meteredUsage: { wallTimeMs: number } } }>(
      'getSandboxLeaseByServer', { workspaceId, leaseId: 'meter_lease' })
    expect(lease.status).toBe('stopping')
    expect(lease.usage.meterVersion).toBe(3)
    expect(lease.usage.meteredUsage.wallTimeMs).toBe(200_000)
  })
})

function subscriptionRow(billingAccountId: string, planKind: 'free' | 'paid' = 'paid') {
  return {
    billingAccountId, provider: 'test', planKind, planVersion: 'variable_v2' as const, planAmountCents: planKind === 'paid' ? 500 : 0,
    markupBasisPoints: 2_500, status: 'active' as const, autoTopUpEnabled: false, autoTopUpAmountCents: 0, createdAt: 1, updatedAt: 1,
  }
}

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
