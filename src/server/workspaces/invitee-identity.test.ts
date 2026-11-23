import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveInviteeIdentity } from './invitee-identity'

const base = { userId: 'user_1', accessToken: 'token' }
const provider = (claims: object | null, record: object | null) => ({
  getUserProfile: async () => claims as never,
  getUserById: async () => record as never,
})

test('a browser session supplies the invitee directly', async () => {
  const result = await resolveInviteeIdentity({
    ...base, authType: 'session', session: { user: { email: 'a@example.com', firstName: 'Ada' } },
    provider: provider(null, null),
  })
  assert.deepEqual(result, { email: 'a@example.com', displayName: 'Ada' })
})

test('a native token falls back to the provider user record when claims lack an email', async () => {
  const result = await resolveInviteeIdentity({
    ...base, authType: 'access-token', session: null,
    provider: provider({ id: 'user_1' }, { id: 'user_1', email: 'b@example.com', emailVerified: true }),
  })
  assert.deepEqual(result, { email: 'b@example.com', displayName: 'b@example.com' })
})

test('unverified, mismatched or non-user identities are refused', async () => {
  for (const record of [
    { id: 'user_1', email: 'c@example.com', emailVerified: false },
    { id: 'user_2', email: 'c@example.com', emailVerified: true },
  ]) {
    assert.equal(await resolveInviteeIdentity({
      ...base, authType: 'access-token', session: null, provider: provider(null, record),
    }), null)
  }
  assert.equal(await resolveInviteeIdentity({
    ...base, authType: 'api-key', session: null,
    provider: provider(null, { id: 'user_1', email: 'd@example.com', emailVerified: true }),
  }), null)
})
