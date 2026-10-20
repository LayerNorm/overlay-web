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

    await convex.mutation(agentMutationRef('prepareComputerAllocationByServer'), {
      workspaceId: 'ws_1', leaseId: 'computer:computer_lease_1',
      allocationKey: 'computer:computer_lease_1', allocationRecipe: '{"persistent":true}', now: 3_000,
      serverSecret: secret,
    })
    expect(await convex.mutation(mutationRef('bindProviderReference'), {
      computerId: 'computer_lease_1', workspaceId: 'ws_1', leaseId: 'computer:computer_lease_1',
      reference: 'box-ref', allocationKey: 'computer:other', serverSecret: secret,
    })).toBeNull()
    expect(await convex.mutation(mutationRef('bindProviderReference'), {
      computerId: 'computer_lease_1', workspaceId: 'ws_1', leaseId: 'computer:computer_lease_1',
      reference: 'box-ref', allocationKey: 'computer:computer_lease_1', serverSecret: secret,
    })).toBe('computer_lease_1')
    const bound = await convex.query(agentQueryRef('getSandboxLeaseByServer'), {
      workspaceId: 'ws_1', leaseId: 'computer:computer_lease_1', serverSecret: secret,
    })
    expect(bound).toMatchObject({
      providerReference: 'box-ref', usage: { meteredProviderReference: 'box-ref' },
    })
  })

  test('atomically excludes idle maintenance while activity is live and isolates workspace claims', async () => {
    const convex = convexTest(schema, modules)
    await convex.mutation(mutationRef('createWithLease'), {
      ...baseRow, id: 'computer_activity', lastActiveAt: 1_000, serverSecret: secret,
      lease: {
        leaseId: 'computer:computer_activity', workspaceId: 'ws_1', computerId: 'computer_activity',
        provider: 'box', status: 'running', reservedUntil: 900_000,
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
