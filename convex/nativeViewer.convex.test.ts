import { expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const current = makeFunctionReference<'query'>('auth/viewer:current')

test('viewer is null anonymously and derives its subject only from native identity', async () => {
  const t = convexTest(schema, modules)
  expect(await t.query(current, {})).toBeNull()
  const user = t.withIdentity({ subject: 'user-a', issuer: 'https://issuer.example.test' })
  expect(await user.query(current, {})).toEqual({ userId: 'user-a' })
  await expect(user.query(current, { userId: 'user-b' })).rejects.toThrow()
  await expect(t.query(current, { accessToken: 'self-asserted-token' })).rejects.toThrow()
})
