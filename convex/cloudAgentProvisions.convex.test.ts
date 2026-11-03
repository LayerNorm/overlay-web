import { beforeAll, describe, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const secret = 'cloud-provisions-contract-secret'

beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })

const query = (name: string) => makeFunctionReference<'query'>(`providers/cloudAgentProvisions:${name}`)
const mutation = (name: string) => makeFunctionReference<'mutation'>(`providers/cloudAgentProvisions:${name}`)

const key = { serverSecret: secret, workspaceId: 'ws_1', agentId: 'agent_1' }

describe('Convex cloud agent provisions', () => {
  test('every function rejects a wrong server secret', async () => {
    const convex = convexTest(schema, modules)
    await expect(convex.query(query('getByServer'), { ...key, serverSecret: 'nope' })).rejects.toThrow(/Unauthorized/)
    await expect(convex.mutation(mutation('beginByServer'), { ...key, serverSecret: 'nope', userId: 'u', now: 1 })).rejects.toThrow(/Unauthorized/)
    await expect(convex.mutation(mutation('setPhaseByServer'), { ...key, serverSecret: 'nope', phase: 'allocating', allocationKey: 'a', now: 1 })).rejects.toThrow(/Unauthorized/)
    await expect(convex.mutation(mutation('recordAllocationByServer'), { ...key, serverSecret: 'nope', allocationKey: 'a', provider: 'box', providerReference: 'bx_1', now: 1 })).rejects.toThrow(/Unauthorized/)
    await expect(convex.mutation(mutation('claimReclaimByServer'), { ...key, serverSecret: 'nope', expectedUpdatedAt: 1, now: 2 })).rejects.toThrow(/Unauthorized/)
    await expect(convex.mutation(mutation('markReclaimPendingByServer'), { ...key, serverSecret: 'nope', allocationKey: 'a', now: 2 })).rejects.toThrow(/Unauthorized/)
    await expect(convex.mutation(mutation('finishReclaimByServer'), { ...key, serverSecret: 'nope', allocationKey: 'a', providerReference: 'bx_1', now: 2 })).rejects.toThrow(/Unauthorized/)
    await expect(convex.mutation(mutation('releaseAllocationByServer'), { ...key, serverSecret: 'nope', allocationKey: 'a', providerReference: 'bx_1', now: 2 })).rejects.toThrow(/Unauthorized/)
    await expect(convex.query(query('listReclaimableByServer'), { serverSecret: 'nope', before: 2, limit: 1 })).rejects.toThrow(/Unauthorized/)
  })

  test('hosted provisioning phase mutations are permanently retired', async () => {
    const convex = convexTest(schema, modules)
    expect(await convex.query(query('getByServer'), key)).toBeNull()
    await expect(convex.mutation(mutation('beginByServer'), { ...key, userId: 'u', now: 1 })).rejects.toThrow('HOSTED_RUNTIME_RETIRED')
    await expect(convex.mutation(mutation('setPhaseByServer'), { ...key, phase: 'booting', now: 2 })).rejects.toThrow('HOSTED_RUNTIME_RETIRED')
    await expect(convex.mutation(mutation('recordAllocationByServer'), {
      ...key, allocationKey: 'allocation', provider: 'box', providerReference: 'bx_1', now: 3,
    })).rejects.toThrow('HOSTED_RUNTIME_RETIRED')
    expect(await convex.query(query('getByServer'), key)).toBeNull()
  })

  test('legacy failed provision history remains readable but is not retryable', async () => {
    const convex = convexTest(schema, modules)
    await convex.run(ctx => ctx.db.insert('cloudAgentProvisions', {
      workspaceId: key.workspaceId, agentId: key.agentId, userId: 'u', phase: 'failed', error: 'failed', createdAt: 1, updatedAt: 2,
    }))
    expect(await convex.query(query('getByServer'), key)).toMatchObject({ phase: 'failed' })
    await expect(convex.mutation(mutation('beginByServer'), { ...key, userId: 'u', now: 3 }))
      .rejects.toThrow('HOSTED_RUNTIME_RETIRED')
  })

  test('records are per agent and removable', async () => {
    const convex = convexTest(schema, modules)
    await convex.run(ctx => ctx.db.insert('cloudAgentProvisions', {
      workspaceId: key.workspaceId, agentId: key.agentId, userId: 'u', phase: 'failed', createdAt: 1, updatedAt: 1,
    }))
    expect(await convex.query(query('getByServer'), { ...key, agentId: 'agent_2' })).toBeNull()
    await convex.mutation(mutation('removeByServer'), key)
    expect(await convex.query(query('getByServer'), key)).toBeNull()
  })

  test('a lost start with a provider reference cannot be restarted', async () => {
    const convex = convexTest(schema, modules)
    await convex.run(ctx => ctx.db.insert('cloudAgentProvisions', {
      workspaceId: key.workspaceId,
      agentId: key.agentId,
      userId: 'u',
      phase: 'connecting',
      allocationKey: 'allocation-1',
      provider: 'box',
      providerReference: 'bx_orphan',
      allocatedAt: 1,
      createdAt: 1,
      updatedAt: 1,
    }))
    await expect(convex.mutation(mutation('beginByServer'), { ...key, userId: 'u2', now: 10 * 60_000 + 2 }))
      .rejects.toThrow('HOSTED_RUNTIME_RETIRED')
    expect(await convex.query(query('getByServer'), key)).toMatchObject({
      phase: 'connecting',
      providerReference: 'bx_orphan',
      allocationKey: 'allocation-1',
    })
  })

  test('allocation binding is keyed and provider references are immutable', async () => {
    const convex = convexTest(schema, modules)
    await convex.run(ctx => ctx.db.insert('cloudAgentProvisions', {
      workspaceId: key.workspaceId, agentId: key.agentId, userId: 'u', phase: 'connecting', allocationKey: 'allocation-1',
      provider: 'box', providerReference: 'bx_1', allocatedAt: 4, createdAt: 1, updatedAt: 4,
    }))
    await expect(convex.mutation(mutation('recordAllocationByServer'), {
      ...key, allocationKey: 'allocation-1', provider: 'box', providerReference: 'bx_2', now: 5,
    })).rejects.toThrow('HOSTED_RUNTIME_RETIRED')
    expect(await convex.query(query('getByServer'), key)).toMatchObject({
      allocationKey: 'allocation-1',
      provider: 'box',
      providerReference: 'bx_1',
      allocatedAt: 4,
    })
  })

  test('reclaim claims require the expected revision and block later phase writes', async () => {
    const convex = convexTest(schema, modules)
    await convex.run(ctx => ctx.db.insert('cloudAgentProvisions', {
      workspaceId: key.workspaceId, agentId: key.agentId, userId: 'u', phase: 'failed', allocationKey: 'allocation-1',
      provider: 'box', providerReference: 'bx_1', allocatedAt: 3, createdAt: 1, updatedAt: 3,
    }))
    expect(await convex.mutation(mutation('claimReclaimByServer'), {
      ...key, expectedUpdatedAt: 2, now: 4,
    })).toBeNull()
    expect(await convex.mutation(mutation('claimReclaimByServer'), {
      ...key, expectedUpdatedAt: 3, now: 4,
    })).toMatchObject({ phase: 'failed', reclaimPending: true, providerReference: 'bx_1' })
    await expect(convex.mutation(mutation('setPhaseByServer'), {
      ...key, phase: 'ready', allocationKey: 'allocation-1', now: 5,
    })).rejects.toThrow('HOSTED_RUNTIME_RETIRED')
    expect(await convex.query(query('getByServer'), key)).toMatchObject({
      phase: 'failed',
      reclaimPending: true,
      providerReference: 'bx_1',
    })
  })
})
