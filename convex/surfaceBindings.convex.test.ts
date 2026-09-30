import { beforeAll, describe, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const secret = 'surface-bindings-secret'
beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })

const m = (name: string) => makeFunctionReference<'mutation'>(`surfaces/surfaces:${name}`)
const q = (name: string) => makeFunctionReference<'query'>(`surfaces/surfaces:${name}`)

const row = (id: string, agentId: string) => ({
  serverSecret: secret,
  id,
  connectionId: 'conn_1',
  agentId,
  channelId: 'C1',
  channelName: 'general',
  status: 'active' as const,
  createdByUserId: 'user_1',
  createdAt: 1,
  updatedAt: 1,
})

describe('surface bindings', () => {
  test('several agents share a channel; re-binding reactivates the agent\'s own row', async () => {
    const convex = convexTest(schema, modules)
    expect(await convex.mutation(m('createBinding'), row('b_pr', 'agent_pr'))).toBe('b_pr')
    expect(await convex.mutation(m('createBinding'), row('b_product', 'agent_product'))).toBe('b_product')

    const listed = await convex.query(q('listBindingsByChannel'), { serverSecret: secret, connectionId: 'conn_1', channelId: 'C1' })
    expect(listed.map((binding: { id: string; agentId: string }) => [binding.id, binding.agentId]).sort())
      .toEqual([['b_pr', 'agent_pr'], ['b_product', 'agent_product']])

    await convex.mutation(m('updateBinding'), { serverSecret: secret, id: 'b_pr', status: 'removed', updatedAt: 2 })
    // A fresh id for the same agent reuses (and reactivates) its removed row.
    expect(await convex.mutation(m('createBinding'), row('b_pr_again', 'agent_pr'))).toBe('b_pr')
    const reactivated = await convex.query(q('getBinding'), { serverSecret: secret, id: 'b_pr' })
    expect(reactivated?.status).toBe('active')
    expect(reactivated?.agentId).toBe('agent_pr')

    // Pre-multi-agent callers still get one active row instead of an error.
    const first = await convex.query(q('findBindingByChannel'), { serverSecret: secret, connectionId: 'conn_1', channelId: 'C1' })
    expect(first?.status).toBe('active')
  })
})
