import { expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const identity = makeFunctionReference<'query'>('auth/accountBrowse:identity')
const settings = makeFunctionReference<'query'>('platform/uiSettings:mine')

test('account identity resolves the override, provider name and photo for the signed-in person only', async () => {
  const t = convexTest(schema, modules)
  await t.run(async ctx => {
    await ctx.db.insert('subscriptions', { userId: 'alice', email: 'alice@example.test', firstName: 'Alice', lastName: 'Ng', profilePictureUrl: 'https://img.example/a.png' } as never)
    await ctx.db.insert('subscriptions', { userId: 'bob', email: 'bob@example.test', displayNameOverride: 'Bobby', photoObjectKey: 'photos/bob-1' } as never)
  })
  expect(await t.withIdentity({ subject: 'alice' }).query(identity, {})).toEqual({
    displayName: 'Alice Ng', photoUrl: 'https://img.example/a.png', displayNameOverride: null, hasCustomPhoto: false, email: 'alice@example.test',
  })
  const bob = await t.withIdentity({ subject: 'bob' }).query(identity, {}) as { displayName: string; photoUrl: string; hasCustomPhoto: boolean }
  expect(bob).toMatchObject({ displayName: 'Bobby', hasCustomPhoto: true })
  expect(bob.photoUrl).toContain('/api/v1/account/profile/photo?userId=bob')
  expect(await t.withIdentity({ subject: 'nobody' }).query(identity, {})).toBeNull()
  expect(await t.query(identity, {})).toBeNull()
})

test('UI settings are the signed-in person own, with defaults and the public shape', async () => {
  const t = convexTest(schema, modules)
  await t.run(async ctx => {
    await ctx.db.insert('userUiSettings', { userId: 'alice', theme: 'dark', useSecondarySidebar: false, chatStreamingMode: 'chunk', sendWithEnter: false, createdAt: 1, updatedAt: 1 } as never)
  })
  const alice = await t.withIdentity({ subject: 'alice' }).query(settings, {}) as Record<string, unknown>
  expect(alice).toMatchObject({ theme: 'dark', useSecondarySidebar: false, chatStreamingMode: 'token', sendWithEnter: false })
  const fresh = await t.withIdentity({ subject: 'bob' }).query(settings, {}) as Record<string, unknown>
  expect(fresh).toMatchObject({ useSecondarySidebar: true, chatStreamingMode: 'token', sendWithEnter: true })
  expect(await t.query(settings, {})).toBeNull()
})
