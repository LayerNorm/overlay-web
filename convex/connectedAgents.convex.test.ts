import { beforeAll, describe, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'
import type { ConnectedAgentContractRepository } from '../src/shared/agents/connected-agent-repository-contract'
import { verifyConnectedAgentRepositoryContract } from '../src/shared/agents/connected-agent-repository-contract'

const modules = import.meta.glob('./**/*.ts')
const secret = 'connected-agent-contract-secret'

beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })

describe('Convex connected-agent provider contract', () => {
  test('rejects a missing server capability before reading tenant state', async () => {
    const convex = convexTest(schema, modules)
    await expect(convex.mutation(reference('createEnvironmentByServer'), {
      serverSecret: 'wrong-secret', id: 'environment', workspaceId: 'workspace', kind: 'local',
      name: 'Host', status: 'online', capabilities: {}, now: 1,
    })).rejects.toThrow(/Unauthorized/)
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
