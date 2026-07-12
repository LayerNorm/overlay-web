import assert from 'node:assert/strict'
import test from 'node:test'
import { signWebhookPayload, verifyWebhookSignature } from './PostgresWebhookDeliveryService'

test('webhook HMAC covers timestamp and exact payload', () => {
  const payload = '{"id":"event_1"}'
  const signature = signWebhookPayload('secret', payload, 1_700_000_000_000)
  assert.equal(verifyWebhookSignature({
    payload,
    secret: 'secret',
    signature: `sha256=${signature}`,
    timestamp: 1_700_000_000_000,
  }), true)
  assert.equal(verifyWebhookSignature({
    payload: `${payload} `,
    secret: 'secret',
    signature,
    timestamp: 1_700_000_000_000,
  }), false)
})
