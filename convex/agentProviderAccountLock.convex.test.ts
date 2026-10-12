import { beforeAll, describe, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const secret = 'agent-account-lock-secret'
const now = 1_900_000_000_000

beforeAll(() => { process.env.INTERNAL_API_SECRET = secret })

const mutation = (name: string) => makeFunctionReference<'mutation'>(`providers/agentAccounts:${name}`)

describe('Convex agent account refresh lock', () => {
  test('one holder at a time, a lease that runs out is free, and only the holder releases', async () => {
    const convex = convexTest(schema, modules)
    const accountId = await convex.mutation(mutation('createByServer'), {
      serverSecret: secret, userId: 'u1', provider: 'codex', method: 'subscription', label: 'Codex', credentialRef: 'ref', maxAccounts: 5,
    }) as string
    const acquire = (owner: string, at: number, ttlMs = 30_000) =>
      convex.mutation(mutation('acquireRefreshLockByServer'), { serverSecret: secret, accountId, owner, ttlMs, now: at }) as Promise<boolean>
    const release = (owner: string) => convex.mutation(mutation('releaseRefreshLockByServer'), { serverSecret: secret, accountId, owner })

    expect(await acquire('server-a', now)).toBe(true)
    expect(await acquire('server-b', now + 1_000)).toBe(false)
    expect(await acquire('server-a', now + 2_000)).toBe(true) // the holder may renew
    await release('server-b') // not the holder: no effect
    expect(await acquire('server-b', now + 3_000)).toBe(false)
    await release('server-a')
    expect(await acquire('server-b', now + 4_000)).toBe(true)
    // A server that died holding the lock frees it when its lease ends.
    expect(await acquire('server-c', now + 4_000 + 31_000)).toBe(true)
    await expect(convex.mutation(mutation('acquireRefreshLockByServer'), { serverSecret: 'wrong', accountId, owner: 'x', ttlMs: 1_000, now })).rejects.toThrow()
  })
})
