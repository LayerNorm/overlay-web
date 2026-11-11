import assert from 'node:assert/strict'
import test from 'node:test'
import { completeSignupVerification } from './completeSignupVerification'
import { sanitizeClientAuthRedirect } from '@/shared/auth/auth-redirect'

test('successful automatic sign-in does not show the verified fallback', async () => {
  let attempts = 0
  let fallback = 0
  await completeSignupVerification(async () => { attempts++; return true }, () => { fallback++ })
  assert.equal(attempts, 1)
  assert.equal(fallback, 0)
})

test('a rejected sign-in or network error preserves the verified fallback', async () => {
  for (const signIn of [async () => false, async (): Promise<boolean> => { throw new Error('Network error') }]) {
    let fallback = 0
    await completeSignupVerification(signIn, () => { fallback++ })
    assert.equal(fallback, 1)
  }
})

test('signup redirect sanitization retains invitations and desktop callbacks, rejecting external URLs', () => {
  for (const value of ['/app/invitations/invite_1', 'overlay://auth/callback', 'overlay://auth/transfer?token=example']) assert.equal(sanitizeClientAuthRedirect(value), value)
  assert.equal(sanitizeClientAuthRedirect('https://attacker.test'), sanitizeClientAuthRedirect(null))
  assert.equal(sanitizeClientAuthRedirect('//attacker.test'), sanitizeClientAuthRedirect(null))
})
