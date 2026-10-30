import { beforeAll, describe, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const secret = 'computers-contract-secret'

beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })

const baseRow = {
  workspaceId: 'ws_1',
  ownerType: 'user',
  ownerId: 'user_1',
  provider: 'box',
  size: 'default',
  status: 'provisioning',
  createdBy: 'user_1',
  createdAt: 1_000,
  updatedAt: 1_000,
}

describe('Convex computers repository surface', () => {
  test('rejects a missing server secret before reading state', async () => {
    const convex = convexTest(schema, modules)
    await expect(convex.query(queryRef('get'), {
      serverSecret: 'wrong-secret', id: 'computer_x',
    })).rejects.toThrow(/Unauthorized/)
  })

  test('persists owner-keyed bindings and provider-neutral CRUD', async () => {
    const convex = convexTest(schema, modules)
    const created = await convex.mutation(mutationRef('create'), {
      ...baseRow, id: 'computer_1', serverSecret: secret,
    })
    expect(created).toBe('computer_1')

    // The (workspace, ownerType, ownerId) binding is unique: a second create
    // returns the existing row idempotently.
    const duplicate = await convex.mutation(mutationRef('create'), {
      ...baseRow, id: 'computer_2', size: 'large', serverSecret: secret,
    })
    expect(duplicate).toBe('computer_1')

    const fetched = await convex.query(queryRef('get'), { id: 'computer_1', serverSecret: secret })
    expect(fetched?.workspaceId).toBe('ws_1')
    expect(fetched?.providerRef).toBeUndefined()
    expect(await convex.query(queryRef('get'), { id: 'computer_missing', serverSecret: secret })).toBeNull()

    const byOwner = await convex.query(queryRef('findByOwner'), {
      workspaceId: 'ws_1', ownerType: 'user', ownerId: 'user_1', serverSecret: secret,
    })
    expect(byOwner?.id).toBe('computer_1')
    expect(await convex.query(queryRef('findByOwner'), {
      workspaceId: 'ws_1', ownerType: 'agent', ownerId: 'missing', serverSecret: secret,
    })).toBeNull()

    await convex.mutation(mutationRef('create'), {
      ...baseRow, id: 'computer_other_ws', workspaceId: 'ws_2', serverSecret: secret,
    })
    await convex.mutation(mutationRef('create'), {
      ...baseRow, id: 'computer_agent', ownerType: 'agent', ownerId: 'agent_1',
      name: 'Research desk', createdAt: 2_000, updatedAt: 2_000, serverSecret: secret,
    })

    const rows = await convex.query(queryRef('listByWorkspace'), { workspaceId: 'ws_1', serverSecret: secret })
    expect(rows.map((row: { id: string }) => row.id)).toEqual(['computer_1', 'computer_agent'])
    expect(rows.find((row: { id: string }) => row.id === 'computer_agent')?.name).toBe('Research desk')

    await convex.mutation(mutationRef('update'), {
      id: 'computer_1', providerRef: 'bx_1', status: 'ready',
      lastActiveAt: 3_000, updatedAt: 3_000, serverSecret: secret,
    })
    const updated = await convex.query(queryRef('get'), { id: 'computer_1', serverSecret: secret })
    expect(updated?.status).toBe('ready')
    expect(updated?.providerRef).toBe('bx_1')
    expect(updated?.lastActiveAt).toBe(3_000)

    // Null clears optional fields back to absent.
    await convex.mutation(mutationRef('update'), {
      id: 'computer_1', providerRef: null, serverSecret: secret,
    })
    const cleared = await convex.query(queryRef('get'), { id: 'computer_1', serverSecret: secret })
    expect(cleared?.providerRef).toBeUndefined()

    await convex.mutation(mutationRef('remove'), { id: 'computer_1', serverSecret: secret })
    expect(await convex.query(queryRef('get'), { id: 'computer_1', serverSecret: secret })).toBeNull()
    // remove is idempotent on a missing row.
    await convex.mutation(mutationRef('remove'), { id: 'computer_1', serverSecret: secret })
  })

  test('takes and releases control only for ready computers', async () => {
    const convex = convexTest(schema, modules)
    await convex.mutation(mutationRef('create'), {
      ...baseRow, id: 'computer_control', status: 'ready', serverSecret: secret,
    })
    await convex.mutation(mutationRef('create'), {
      ...baseRow, id: 'computer_not_ready', serverSecret: secret,
    })

    expect(await convex.mutation(mutationRef('takeControl'), {
      id: 'computer_not_ready', userId: 'user_1', controlTakenAt: 2_000, serverSecret: secret,
    })).toBeNull()
    expect(await convex.mutation(mutationRef('takeControl'), {
      id: 'computer_control', userId: 'user_1', controlTakenAt: 3_000, serverSecret: secret,
    })).toBe('computer_control')
    expect(await convex.query(queryRef('get'), {
      id: 'computer_control', serverSecret: secret,
    })).toMatchObject({ controlledByUserId: 'user_1', controlTakenAt: 3_000 })

    expect(await convex.mutation(mutationRef('releaseControl'), {
      id: 'computer_control', now: 4_000, serverSecret: secret,
    })).toBe('computer_control')
    expect(await convex.query(queryRef('get'), {
      id: 'computer_control', serverSecret: secret,
    })).not.toHaveProperty('controlledByUserId')
    expect(await convex.query(queryRef('get'), {
      id: 'computer_control', serverSecret: secret,
    })).not.toHaveProperty('controlTakenAt')
  })

  test('atomically claims a deterministic Computer lease and binds one allocation reference', async () => {
    const convex = convexTest(schema, modules)
    const claim = (id: string, now: number) => convex.mutation(mutationRef('createWithLease'), {
      ...baseRow, id, serverSecret: secret,
      lease: {
        leaseId: `computer:${id}`, workspaceId: 'ws_1', computerId: id, provider: 'box',
        status: 'reserved', reservedUntil: now + 7_200_000, usage: { meteredUsage: {}, meterVersion: 0 },
        cleanupAttempts: 0, nextMeterAt: now, now,
      },
    })
    expect(await claim('computer_lease_1', 1_000)).toEqual({ id: 'computer_lease_1', created: true })
    expect(await claim('computer_lease_loser', 2_000)).toEqual({ id: 'computer_lease_1', created: false })
    const lease = await convex.query(agentQueryRef('getSandboxLeaseByServer'), {
      workspaceId: 'ws_1', leaseId: 'computer:computer_lease_1', serverSecret: secret,
    })
    expect(lease).toMatchObject({
      computerId: 'computer_lease_1', status: 'reserved', reservedUntil: 7_201_000,
      usage: { meteredUsage: {}, meterVersion: 0 },
    })
    expect(await convex.query(agentQueryRef('getSandboxLeaseByServer'), {
      workspaceId: 'ws_2', leaseId: 'computer:computer_lease_1', serverSecret: secret,
    })).toBeNull()

    const provisionClaim = await convex.mutation(agentMutationRef('claimComputerMaintenanceByServer'), {
      workspaceId: 'ws_1', leaseId: 'computer:computer_lease_1', kind: 'provision',
      token: 'provision-1', actorUserId: 'user_1', expectedProviderReference: null,
      now: 2_500, expiresAt: 362_500, serverSecret: secret,
    })
    expect(provisionClaim).toMatchObject({ token: 'provision-1' })
    await convex.mutation(agentMutationRef('prepareComputerAllocationByServer'), {
      workspaceId: 'ws_1', leaseId: 'computer:computer_lease_1',
      allocationKey: 'computer:computer_lease_1', allocationRecipe: '{"persistent":true}', now: 3_000,
      maintenanceToken: 'provision-1', serverSecret: secret,
    })
    expect(await convex.mutation(mutationRef('bindProviderReference'), {
      computerId: 'computer_lease_1', workspaceId: 'ws_1', leaseId: 'computer:computer_lease_1',
      reference: 'box-ref', allocationKey: 'computer:other', maintenanceToken: 'provision-1', serverSecret: secret,
    })).toBeNull()
    expect(await convex.mutation(mutationRef('bindProviderReference'), {
      computerId: 'computer_lease_1', workspaceId: 'ws_1', leaseId: 'computer:computer_lease_1',
      reference: 'box-ref', allocationKey: 'computer:computer_lease_1',
      maintenanceToken: 'provision-1', serverSecret: secret,
    })).toEqual({ id: 'computer_lease_1', canContinue: true })
    const bound = await convex.query(agentQueryRef('getSandboxLeaseByServer'), {
      workspaceId: 'ws_1', leaseId: 'computer:computer_lease_1', serverSecret: secret,
    })
    expect(bound).toMatchObject({
      providerReference: 'box-ref', usage: { meteredProviderReference: 'box-ref' },
    })
    expect(await convex.mutation(agentMutationRef('transitionComputerLifecycleByServer'), {
      workspaceId: 'ws_1', computerId: 'computer_lease_1', leaseId: 'computer:computer_lease_1',
      token: 'provision-1', transition: 'session_armed', expectedProviderReference: 'box-ref',
      now: 4_000, reservedUntil: 7_204_000, serverSecret: secret,
    })).toBe(true)
    expect(await convex.mutation(agentMutationRef('transitionComputerLifecycleByServer'), {
      workspaceId: 'ws_1', computerId: 'computer_lease_1', leaseId: 'computer:computer_lease_1',
      token: 'provision-1', transition: 'ready', expectedProviderReference: 'box-ref',
      now: 5_000, reservedUntil: 7_204_000, serverSecret: secret,
    })).toBe(true)
    const runningLease = await convex.query(agentQueryRef('getSandboxLeaseByServer'), {
      workspaceId: 'ws_1', leaseId: 'computer:computer_lease_1', serverSecret: secret,
    })
    expect(runningLease).toMatchObject({ status: 'running', runtimeStartedAt: 5_000, reservedUntil: 7_204_000 })
    expect(await convex.query(queryRef('get'), { id: 'computer_lease_1', serverSecret: secret })).toMatchObject({ status: 'ready' })
  })

  test('stale provision and wake completions cannot overwrite stop; wake invalidates old stopped evidence', async () => {
    const convex = convexTest(schema, modules)
    await convex.mutation(mutationRef('createWithLease'), {
      ...baseRow, id: 'computer_stale', status: 'provisioning', serverSecret: secret,
      lease: {
        leaseId: 'computer:computer_stale', workspaceId: 'ws_1', computerId: 'computer_stale',
        provider: 'box', status: 'reserved', reservedUntil: 100_000,
        usage: {
          meteredUsage: {}, meterVersion: 0,
          lastProviderEvidence: { stopped: true, providerReference: 'box-ref', observedAt: 10, usage: { total: 0 } },
        },
        cleanupAttempts: 0, now: 1_000,
      },
    })
    await convex.mutation(agentMutationRef('claimComputerMaintenanceByServer'), {
      workspaceId: 'ws_1', leaseId: 'computer:computer_stale', kind: 'provision', token: 'provision-stale',
      expectedProviderReference: null, actorUserId: 'user_1', now: 2_000, expiresAt: 362_000, serverSecret: secret,
    })
    await convex.mutation(agentMutationRef('prepareComputerAllocationByServer'), {
      workspaceId: 'ws_1', leaseId: 'computer:computer_stale',
      allocationKey: 'computer:computer_stale', allocationRecipe: '{"persistent":true}',
      maintenanceToken: 'provision-stale', now: 2_500, serverSecret: secret,
    })
    expect(await convex.mutation(agentMutationRef('claimComputerMaintenanceByServer'), {
      workspaceId: 'ws_1', leaseId: 'computer:computer_stale', kind: 'stop', token: 'stop-new',
      expectedProviderReference: null, now: 3_000, expiresAt: 363_000, force: true, serverSecret: secret,
    })).toMatchObject({ token: 'stop-new' })
    expect(await convex.mutation(mutationRef('bindProviderReference'), {
      computerId: 'computer_stale', workspaceId: 'ws_1', leaseId: 'computer:computer_stale',
      reference: 'box-ref', allocationKey: 'computer:computer_stale',
      maintenanceToken: 'provision-stale', serverSecret: secret,
    })).toEqual({ id: 'computer_stale', canContinue: false })
    expect(await convex.mutation(agentMutationRef('transitionComputerLifecycleByServer'), {
      workspaceId: 'ws_1', computerId: 'computer_stale', leaseId: 'computer:computer_stale',
      token: 'provision-stale', transition: 'ready', expectedProviderReference: 'box-ref',
      now: 4_000, serverSecret: secret,
    })).toBe(false)
    expect(await convex.query(agentQueryRef('getSandboxLeaseByServer'), {
      workspaceId: 'ws_1', leaseId: 'computer:computer_stale', serverSecret: secret,
    })).toMatchObject({ status: 'stopping' })
    await convex.mutation(agentMutationRef('transitionComputerLifecycleByServer'), {
      workspaceId: 'ws_1', computerId: 'computer_stale', leaseId: 'computer:computer_stale',
      token: 'stop-new', transition: 'paused', expectedProviderReference: 'box-ref',
      now: 5_000, serverSecret: secret,
    })
    await convex.mutation(agentMutationRef('claimComputerMaintenanceByServer'), {
      workspaceId: 'ws_1', leaseId: 'computer:computer_stale', kind: 'wake', token: 'wake-new',
      expectedProviderReference: 'box-ref', actorUserId: 'user_1', now: 6_000, expiresAt: 366_000, serverSecret: secret,
    })
    expect(await convex.mutation(agentMutationRef('transitionComputerLifecycleByServer'), {
      workspaceId: 'ws_1', computerId: 'computer_stale', leaseId: 'computer:computer_stale',
      token: 'wake-new', transition: 'paused', expectedProviderReference: 'box-ref',
      now: 6_500, serverSecret: secret,
    })).toBe(false)
    expect(await convex.mutation(agentMutationRef('transitionComputerLifecycleByServer'), {
      workspaceId: 'ws_1', computerId: 'computer_stale', leaseId: 'computer:computer_stale',
      token: 'wake-new', transition: 'deleted', expectedProviderReference: 'box-ref',
      now: 6_500, serverSecret: secret,
    })).toBe(false)
    expect(await convex.mutation(agentMutationRef('transitionComputerLifecycleByServer'), {
      workspaceId: 'ws_1', computerId: 'computer_stale', leaseId: 'computer:computer_stale',
      token: 'wake-new', transition: 'wake_armed', expectedProviderReference: 'box-ref',
      now: 7_000, reservedUntil: 7_207_000, serverSecret: secret,
    })).toBe(true)
    const armed = await convex.query(agentQueryRef('getSandboxLeaseByServer'), {
      workspaceId: 'ws_1', leaseId: 'computer:computer_stale', serverSecret: secret,
    })
    expect(armed).toMatchObject({
      status: 'reserved', usage: { lastProviderEvidence: null, stoppedEvidenceInvalidatedAt: 7_000 },
    })
    expect(await convex.mutation(agentMutationRef('claimComputerMaintenanceByServer'), {
      workspaceId: 'ws_1', leaseId: 'computer:computer_stale', kind: 'delete', token: 'delete-new',
      expectedProviderReference: 'box-ref', now: 8_000, expiresAt: 368_000, force: true, serverSecret: secret,
    })).toMatchObject({ token: 'delete-new' })
    expect(await convex.mutation(agentMutationRef('transitionComputerLifecycleByServer'), {
      workspaceId: 'ws_1', computerId: 'computer_stale', leaseId: 'computer:computer_stale',
      token: 'wake-new', transition: 'ready', expectedProviderReference: 'box-ref',
      now: 9_000, serverSecret: secret,
    })).toBe(false)
    expect(await convex.mutation(agentMutationRef('claimComputerMaintenanceByServer'), {
      workspaceId: 'ws_1', leaseId: 'computer:computer_stale', kind: 'stop', token: 'stop-over-delete',
      expectedProviderReference: 'box-ref', now: 10_000, expiresAt: 370_000, force: true, serverSecret: secret,
    })).toBeNull()
  })

  test('recovery claims require the exact expired token and cannot interrupt live activity', async () => {
    const convex = convexTest(schema, modules)
    await convex.mutation(mutationRef('createWithLease'), {
      ...baseRow, id: 'computer_recovery', providerRef: 'box-ref', status: 'ready', serverSecret: secret,
      lease: {
        leaseId: 'computer:computer_recovery', workspaceId: 'ws_1', computerId: 'computer_recovery',
        provider: 'box', providerReference: 'box-ref', status: 'running', reservedUntil: 900_000,
        usage: { computerLifecycle: {
          maintenance: { kind: 'wake', token: 'abandoned', expiresAt: 2_000 },
          activityTokens: { activity: { expiresAt: 4_000 } },
        } }, cleanupAttempts: 0, now: 1_000,
      },
    })
    const recovery = {
      workspaceId: 'ws_1', leaseId: 'computer:computer_recovery', kind: 'stop', token: 'recovery',
      expectedProviderReference: 'box-ref', reconcileToken: 'abandoned', force: false,
      recoveryProtocol: 'computer-recovery-v1',
      now: 5_000, expiresAt: 365_000, serverSecret: secret,
    }
    const claim = agentMutationRef('claimComputerMaintenanceByServer')
    expect(await convex.mutation(claim, { ...recovery, reconcileToken: undefined })).toBeNull()
    expect(await convex.mutation(claim, { ...recovery, force: true })).toBeNull()
    expect(await convex.mutation(claim, { ...recovery, now: 1_500 })).toBeNull()
    expect(await convex.mutation(claim, { ...recovery, now: 3_000 })).toBeNull()
    expect(await convex.mutation(claim, { ...recovery, reconcileToken: 'stale' })).toBeNull()
    expect(await convex.mutation(claim, recovery)).toMatchObject({ token: 'recovery' })
    expect(await convex.mutation(claim, recovery)).toMatchObject({ token: 'recovery' })
    expect(await convex.mutation(claim, { ...recovery, token: 'second', force: true })).toBeNull()
    await convex.mutation(agentMutationRef('transitionComputerLifecycleByServer'), {
      workspaceId: 'ws_1', computerId: 'computer_recovery', leaseId: recovery.leaseId,
      token: 'recovery', transition: 'paused', expectedProviderReference: 'box-ref', now: 5_100, serverSecret: secret,
    })
    expect(await convex.mutation(claim, { ...recovery, now: 5_200 })).toBeNull()
  })

  test('atomically excludes idle maintenance while activity is live and isolates workspace claims', async () => {
    const convex = convexTest(schema, modules)
    await convex.mutation(mutationRef('createWithLease'), {
      ...baseRow, id: 'computer_activity', providerRef: 'box-activity', status: 'ready', lastActiveAt: 1_000, serverSecret: secret,
      lease: {
        leaseId: 'computer:computer_activity', workspaceId: 'ws_1', computerId: 'computer_activity',
        provider: 'box', providerReference: 'box-activity', status: 'running', reservedUntil: 900_000,
        usage: { meteredUsage: {}, meterVersion: 0 }, cleanupAttempts: 0, now: 1_000,
      },
    })
    const activityArgs = {
      workspaceId: 'ws_1', leaseId: 'computer:computer_activity', token: 'activity-1',
      userId: 'user_1', now: 700_000, expiresAt: 800_000, serverSecret: secret,
    }
    expect(await convex.mutation(agentMutationRef('claimComputerActivityByServer'), activityArgs)).toMatchObject({
      token: 'activity-1',
    })
    const idleArgs = {
      workspaceId: 'ws_1', leaseId: 'computer:computer_activity', kind: 'idle',
      token: 'idle-1', now: 700_000, expiresAt: 1_060_000, idleBefore: 500_000, serverSecret: secret,
      ownerType: 'user', ownerId: 'user_1',
    }
    expect(await convex.mutation(agentMutationRef('claimComputerMaintenanceByServer'), {
      ...idleArgs, workspaceId: 'ws_2',
    })).toBeNull()
    expect(await convex.mutation(agentMutationRef('claimComputerMaintenanceByServer'), idleArgs)).toBeNull()
    expect(await convex.mutation(agentMutationRef('releaseComputerActivityByServer'), {
      workspaceId: 'ws_1', leaseId: 'computer:computer_activity', token: 'activity-1',
      now: 710_000, serverSecret: secret,
    })).toBe(true)
    expect(await convex.mutation(agentMutationRef('claimComputerMaintenanceByServer'), idleArgs)).toMatchObject({
      token: 'idle-1',
    })
    expect(await convex.mutation(agentMutationRef('claimComputerActivityByServer'), {
      ...activityArgs, token: 'activity-2',
    })).toBeNull()
    expect(await convex.mutation(agentMutationRef('releaseComputerMaintenanceByServer'), {
      workspaceId: 'ws_1', leaseId: 'computer:computer_activity', token: 'stale-token',
      now: 720_000, serverSecret: secret,
    })).toBe(false)

    await convex.mutation(mutationRef('takeControl'), {
      id: 'computer_activity', userId: 'user_1', controlTakenAt: 721_000, serverSecret: secret,
    })
    expect(await convex.mutation(agentMutationRef('claimComputerMaintenanceByServer'), {
      ...idleArgs, kind: 'stop', token: 'stop-1', now: 722_000, expiresAt: 1_082_000, force: true,
    })).toMatchObject({ token: 'stop-1' })
    expect(await convex.mutation(agentMutationRef('transitionComputerLifecycleByServer'), {
      workspaceId: 'ws_1', computerId: 'computer_activity', leaseId: 'computer:computer_activity',
      token: 'stop-1', transition: 'paused', expectedProviderReference: 'box-activity',
      now: 723_000, serverSecret: secret,
    })).toBe(true)
    expect(await convex.query(queryRef('get'), {
      id: 'computer_activity', serverSecret: secret,
    })).toMatchObject({ status: 'stopped' })
    const stopped = await convex.query(queryRef('get'), { id: 'computer_activity', serverSecret: secret })
    expect(stopped).not.toHaveProperty('controlledByUserId')
    expect(stopped).not.toHaveProperty('controlTakenAt')
  })

  test('live native and remote agent runs block an atomic idle claim', async () => {
    const convex = convexTest(schema, modules)
    await convex.mutation(mutationRef('createWithLease'), {
      ...baseRow, id: 'computer_live_run', ownerType: 'agent', ownerId: 'agent_1',
      providerRef: 'box-live-run', status: 'ready', lastActiveAt: 1_000, serverSecret: secret,
      lease: {
        leaseId: 'computer:computer_live_run', workspaceId: 'ws_1', computerId: 'computer_live_run',
        provider: 'box', providerReference: 'box-live-run', status: 'running', reservedUntil: 900_000,
        usage: { meteredUsage: {}, meterVersion: 0 }, cleanupAttempts: 0, now: 1_000,
      },
    })
    const ids = await convex.run(async (ctx) => {
      const conversationId = await ctx.db.insert('conversations', {
        userId: 'user_1', workspaceId: 'ws_1', title: 'Live run', lastModified: 1_000,
        createdAt: 1_000, lastMode: 'act', askModelIds: [], actModelId: 'openrouter/free',
      })
      const userMessageId = await ctx.db.insert('conversationMessages', {
        conversationId, userId: 'user_1', turnId: 'run-1', role: 'user', mode: 'act',
        content: 'start', contentType: 'text', status: 'completed', createdAt: 1_000, updatedAt: 1_000,
      })
      const assistantMessageId = await ctx.db.insert('conversationMessages', {
        conversationId, userId: 'user_1', turnId: 'run-1', role: 'assistant', mode: 'act',
        content: '', contentType: 'text', status: 'generating', createdAt: 1_000, updatedAt: 1_000,
      })
      const nativeRunId = await ctx.db.insert('conversationAgentRuns', {
        conversationId, userId: 'user_1', userMessageId, assistantMessageId, turnId: 'run-1',
        agentId: 'agent_1', mode: 'room', runner: 'workflow', status: 'running',
        leaseExpiresAt: 800_000, createdAt: 1_000, updatedAt: 1_000,
      })
      return { conversationId, userMessageId, assistantMessageId, nativeRunId }
    })
    const idleArgs = {
      workspaceId: 'ws_1', leaseId: 'computer:computer_live_run', kind: 'idle',
      token: 'idle-live-run', now: 700_000, expiresAt: 1_060_000, idleBefore: 500_000,
      serverSecret: secret, ownerType: 'agent', ownerId: 'agent_1',
    }
    expect(await convex.mutation(agentMutationRef('claimComputerMaintenanceByServer'), idleArgs)).toBeNull()
    await convex.run(async (ctx) => {
      await ctx.db.patch(ids.nativeRunId, { status: 'completed' })
      await ctx.db.insert('conversationAgentRuns', {
        conversationId: ids.conversationId, userId: 'user_1', userMessageId: ids.userMessageId,
        assistantMessageId: ids.assistantMessageId, turnId: 'run-2', agentId: 'agent_1',
        mode: 'room', runner: 'remote', status: 'running', leaseExpiresAt: 800_000,
        createdAt: 2_000, updatedAt: 2_000,
      })
    })
    expect(await convex.mutation(agentMutationRef('claimComputerMaintenanceByServer'), {
      ...idleArgs, token: 'idle-live-remote',
    })).toBeNull()
  })
})

function mutationRef(operation: string) {
  return makeFunctionReference<'mutation'>(`computers/computers:${operation}`)
}

function queryRef(operation: string) {
  return makeFunctionReference<'query'>(`computers/computers:${operation}`)
}

function agentMutationRef(operation: string) {
  return makeFunctionReference<'mutation'>(`agents/connectedAgents:${operation}`)
}

function agentQueryRef(operation: string) {
  return makeFunctionReference<'query'>(`agents/connectedAgents:${operation}`)
}
