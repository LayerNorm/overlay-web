import assert from 'node:assert/strict'
import test from 'node:test'
import {
  signWebhookPayload,
  verifyWebhookRequest,
  verifyWebhookSignature,
} from './PostgresWebhookDeliveryService'

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

test('webhook verification rejects expired and replayed deliveries', async () => {
  const now = 1_700_000_000_000
  const payload = '{"id":"event_1"}'
  const signature = signWebhookPayload('secret', payload, now)
  const consumed = new Set<string>()
  const replayConsumer = async (deliveryId: string) => {
    if (consumed.has(deliveryId)) return false
    consumed.add(deliveryId)
    return true
  }
  const request = {
    deliveryId: 'delivery_1',
    now,
    payload,
    replayConsumer,
    secret: 'secret',
    signature,
    timestamp: now,
  }
  assert.deepEqual(await verifyWebhookRequest(request), { ok: true })
  assert.deepEqual(await verifyWebhookRequest(request), { ok: false, reason: 'replayed' })
  assert.deepEqual(await verifyWebhookRequest({
    ...request,
    deliveryId: 'delivery_2',
    now: now + 10 * 60_000,
  }), { ok: false, reason: 'expired' })
})
