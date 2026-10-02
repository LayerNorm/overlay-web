import { beforeAll, describe, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const secret = 'agent-accounts-contract-secret'

beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })

const query = (name: string) => makeFunctionReference<'query'>(`providers/agentAccounts:${name}`)
const mutation = (name: string) => makeFunctionReference<'mutation'>(`providers/agentAccounts:${name}`)

const base = { serverSecret: secret, userId: 'user_1', provider: 'claude-code', method: 'subscription', label: 'Work', credentialRef: 'vault-ref-1', maxAccounts: 3 }

describe('Convex agent provider accounts', () => {
  test('every function rejects a wrong server secret', async () => {
    const convex = convexTest(schema, modules)
    await expect(convex.query(query('listPublicByServer'), { serverSecret: 'nope', userId: 'user_1' })).rejects.toThrow(/Unauthorized/)
    await expect(convex.mutation(mutation('createByServer'), { ...base, serverSecret: 'nope' })).rejects.toThrow(/Unauthorized/)
  })

  test('the public list carries no credential reference, and the server read does', async () => {
    const convex = convexTest(schema, modules)
    const id = await convex.mutation(mutation('createByServer'), base)
    const listed = await convex.query(query('listPublicByServer'), { serverSecret: secret, userId: 'user_1' })
    expect(listed).toHaveLength(1)
    expect(JSON.stringify(listed)).not.toContain('vault-ref-1')
    expect(listed[0]).toMatchObject({ id, provider: 'claude-code', method: 'subscription', label: 'Work', status: 'active' })
    const record = await convex.query(query('getByServer'), { serverSecret: secret, accountId: id })
    expect(record).toMatchObject({ userId: 'user_1', credentialRef: 'vault-ref-1' })
    expect(await convex.query(query('listPublicByServer'), { serverSecret: secret, userId: 'user_2' })).toEqual([])
  })

  test('accounts per user are capped', async () => {
    const convex = convexTest(schema, modules)
    for (let i = 0; i < 3; i += 1) await convex.mutation(mutation('createByServer'), { ...base, label: `a${i}` })
    await expect(convex.mutation(mutation('createByServer'), { ...base, label: 'overflow' })).rejects.toThrow(/AGENT_PROVIDER_ACCOUNT_LIMIT/)
    await convex.mutation(mutation('createByServer'), { ...base, userId: 'user_2' })
  })

  test('flagging, reconnecting, and removing', async () => {
    const convex = convexTest(schema, modules)
    const id = await convex.mutation(mutation('createByServer'), base)
    await convex.mutation(mutation('updateByServer'), { serverSecret: secret, accountId: id, status: 'needs_reauth', lastError: 'rejected' })
    expect(await convex.query(query('getByServer'), { serverSecret: secret, accountId: id }))
      .toMatchObject({ status: 'needs_reauth', lastError: 'rejected' })
    await convex.mutation(mutation('updateByServer'), { serverSecret: secret, accountId: id, status: 'active', lastError: null, credentialRef: 'vault-ref-2' })
    const fixed = await convex.query(query('getByServer'), { serverSecret: secret, accountId: id })
    expect(fixed).toMatchObject({ status: 'active', credentialRef: 'vault-ref-2' })
    expect(fixed?.lastError).toBeUndefined()
    await convex.mutation(mutation('deleteByServer'), { serverSecret: secret, accountId: id })
    expect(await convex.query(query('getByServer'), { serverSecret: secret, accountId: id })).toBeNull()
    // Deleting twice is harmless.
    await convex.mutation(mutation('deleteByServer'), { serverSecret: secret, accountId: id })
  })
})
