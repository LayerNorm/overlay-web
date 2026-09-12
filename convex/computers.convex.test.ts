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
})

function mutationRef(operation: string) {
  return makeFunctionReference<'mutation'>(`computers/computers:${operation}`)
}

function queryRef(operation: string) {
  return makeFunctionReference<'query'>(`computers/computers:${operation}`)
}
