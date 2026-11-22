import assert from 'node:assert/strict'
import test from 'node:test'
import { ensureNativeMemberRole } from './ensure-native-member-role'

test('saves the default member role for the signed-in native user', async () => {
  const saved: string[] = []
  await ensureNativeMemberRole('user-a', async (userId) => { saved.push(userId) })
  assert.deepEqual(saved, ['user-a'])
})

test('skips sessions without a user and never fails sign-in', async () => {
  let calls = 0
  await ensureNativeMemberRole(undefined, async () => { calls += 1 })
  assert.equal(calls, 0)
  await assert.doesNotReject(ensureNativeMemberRole('user-a', async () => { throw new Error('convex unavailable') }))
})
