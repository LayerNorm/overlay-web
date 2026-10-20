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

  test('a start is recorded once, tracks phases, and a second start does not boot another machine', async () => {
    const convex = convexTest(schema, modules)
    expect(await convex.query(query('getByServer'), key)).toBeNull()
    expect(await convex.mutation(mutation('beginByServer'), { ...key, userId: 'u', now: 1 })).toEqual({ started: true, phase: 'queued' })
    await convex.mutation(mutation('setPhaseByServer'), { ...key, phase: 'booting', now: 2 })
    expect(await convex.mutation(mutation('beginByServer'), { ...key, userId: 'u', now: 3 })).toEqual({ started: false, phase: 'booting' })
    await convex.mutation(mutation('setPhaseByServer'), { ...key, phase: 'ready', environmentId: 'env_1', now: 4 })
    expect(await convex.query(query('getByServer'), key)).toMatchObject({ phase: 'ready', environmentId: 'env_1' })
    expect(await convex.mutation(mutation('beginByServer'), { ...key, userId: 'u', now: 5 })).toEqual({ started: false, phase: 'ready' })
  })

  test('a failed start can be retried, and a start lost for ten minutes can be restarted', async () => {
    const convex = convexTest(schema, modules)
    await convex.mutation(mutation('beginByServer'), { ...key, userId: 'u', now: 1 })
    await convex.mutation(mutation('setPhaseByServer'), { ...key, phase: 'failed', error: 'x'.repeat(500), now: 2 })
    const failed = await convex.query(query('getByServer'), key)
    expect(failed?.phase).toBe('failed')
    expect(failed?.error?.length).toBeLessThanOrEqual(300)
    expect(await convex.mutation(mutation('beginByServer'), { ...key, userId: 'u', now: 3 })).toEqual({ started: true, phase: 'queued' })
    expect((await convex.query(query('getByServer'), key))?.error).toBeUndefined()
    expect(await convex.mutation(mutation('beginByServer'), { ...key, userId: 'u', now: 4 })).toEqual({ started: false, phase: 'queued' })
    expect(await convex.mutation(mutation('beginByServer'), { ...key, userId: 'u', now: 3 + 10 * 60_000 + 1 })).toEqual({ started: true, phase: 'queued' })
  })

  test('records are per agent and removable', async () => {
    const convex = convexTest(schema, modules)
    await convex.mutation(mutation('beginByServer'), { ...key, userId: 'u', now: 1 })
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
    expect(await convex.mutation(mutation('beginByServer'), { ...key, userId: 'u2', now: 10 * 60_000 + 2 }))
      .toEqual({ started: false, phase: 'connecting' })
    expect(await convex.query(query('getByServer'), key)).toMatchObject({
      phase: 'connecting',
      providerReference: 'bx_orphan',
      allocationKey: 'allocation-1',
    })
  })

  test('allocation binding is keyed and provider references are immutable', async () => {
    const convex = convexTest(schema, modules)
    await convex.mutation(mutation('beginByServer'), { ...key, userId: 'u', now: 1 })
    expect(await convex.mutation(mutation('setPhaseByServer'), { ...key, phase: 'allocating', allocationKey: 'allocation-1', now: 2 })).toBe(true)
    expect(await convex.mutation(mutation('setPhaseByServer'), {
      ...key, phase: 'booting', allocationKey: 'superseded-attempt', now: 3,
    })).toBe(false)
    expect(await convex.mutation(mutation('recordAllocationByServer'), {
      ...key, allocationKey: 'wrong-key', provider: 'box', providerReference: 'bx_1', now: 3,
    })).toEqual({ bound: false })
    expect(await convex.mutation(mutation('recordAllocationByServer'), {
      ...key, allocationKey: 'allocation-1', provider: 'box', providerReference: 'bx_1', now: 4,
    })).toEqual({ bound: true })
    expect(await convex.mutation(mutation('recordAllocationByServer'), {
      ...key, allocationKey: 'allocation-1', provider: 'box', providerReference: 'bx_2', now: 5,
    })).toEqual({ bound: false })
    expect(await convex.query(query('getByServer'), key)).toMatchObject({
      allocationKey: 'allocation-1',
      provider: 'box',
      providerReference: 'bx_1',
      allocatedAt: 4,
    })
  })

  test('reclaim claims require the expected revision and block later phase writes', async () => {
    const convex = convexTest(schema, modules)
    await convex.mutation(mutation('beginByServer'), { ...key, userId: 'u', now: 1 })
    await convex.mutation(mutation('setPhaseByServer'), { ...key, phase: 'allocating', allocationKey: 'allocation-1', now: 2 })
    await convex.mutation(mutation('recordAllocationByServer'), {
      ...key, allocationKey: 'allocation-1', provider: 'box', providerReference: 'bx_1', now: 3,
    })
    expect(await convex.mutation(mutation('claimReclaimByServer'), {
      ...key, expectedUpdatedAt: 2, now: 4,
    })).toBeNull()
    expect(await convex.mutation(mutation('claimReclaimByServer'), {
      ...key, expectedUpdatedAt: 3, now: 4,
    })).toMatchObject({ phase: 'failed', reclaimPending: true, providerReference: 'bx_1' })
    expect(await convex.mutation(mutation('setPhaseByServer'), {
      ...key, phase: 'ready', allocationKey: 'allocation-1', now: 5,
    })).toBe(false)
    expect(await convex.query(query('getByServer'), key)).toMatchObject({
      phase: 'failed',
      reclaimPending: true,
      providerReference: 'bx_1',
    })
  })
})
