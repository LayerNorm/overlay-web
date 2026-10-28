import assert from 'node:assert/strict'
import test from 'node:test'
import type { Session } from '@overlay/app-core'
import { AuthenticatedUserInitializer } from './AuthenticatedUserInitializer'

const session = { accessToken: 'test-token', user: { id: 'user_new', email: 'new@example.test' } } as Session

test('a new password session initializes profile state before it is exposed, coalescing concurrent reads', async () => {
  let finish!: () => void
  let calls = 0
  let time = 1_000
  const initializer = new AuthenticatedUserInitializer({ upsertFromSession: async input => {
    calls++
    assert.equal(input.user.id, 'user_new')
    await new Promise<void>(resolve => { finish = resolve })
    return { success: true, isNewUser: true, userId: input.user.id }
  } }, () => time)
  let resolved = false
  const first = initializer.initialize(session).then(result => { resolved = true; return result })
  const second = initializer.initialize(session)
  assert.equal(calls, 1)
  assert.equal(resolved, false)
  finish()
  assert.equal(await first, session)
  assert.equal(await second, session)
  assert.equal(await initializer.initialize(session), session)
  assert.equal(calls, 1)
  time += 60_001
  const next = initializer.initialize(session)
  assert.equal(calls, 2)
  finish()
  await next
})

test('a profile write failure cannot cache success and a retained session can retry', async () => {
  let calls = 0
  const initializer = new AuthenticatedUserInitializer({ upsertFromSession: async input => {
    if (++calls === 1) throw new Error('backend unavailable')
    return { success: true, isNewUser: false, userId: input.user.id }
  } })
  await assert.rejects(initializer.initialize(session), /backend unavailable/)
  assert.equal(await initializer.initialize(session), session)
  assert.equal(calls, 2)
  assert.equal(await initializer.initialize(null), null)
  assert.equal(calls, 2)
})
