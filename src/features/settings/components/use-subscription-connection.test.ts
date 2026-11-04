import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldPollSubscriptionAuthorization, shouldStopSubscriptionFlow } from './use-subscription-connection'

test('callback authorization is expiry-timed instead of browser-polled', () => {
  assert.equal(shouldPollSubscriptionAuthorization({
    connectionId: 'connection-1',
    authorization: { url: 'https://provider.example/auth', expiresAt: Date.now() + 60_000, interval: 5, callbackRequired: true },
  }.authorization), false)
  assert.equal(shouldPollSubscriptionAuthorization({
    connectionId: 'connection-1',
    authorization: { url: 'https://provider.example/auth', expiresAt: Date.now() + 60_000, interval: 5 },
  }.authorization), true)
})

test('retryable callback errors keep the completion flow active', () => {
  assert.equal(shouldStopSubscriptionFlow({
    status: 'error',
    error: 'The callback does not match this authorization.',
    retryable: true,
  }), false)
  assert.equal(shouldStopSubscriptionFlow({ status: 'error', error: 'Authorization failed.' }), true)
  assert.equal(shouldStopSubscriptionFlow({ status: 'expired', error: 'Sign-in expired.' }), true)
})
