import assert from 'node:assert/strict'
import test from 'node:test'

import { WebhookEventSchema, CreateWebhookSubscriptionRequest } from './webhooks.ts'

test('WebhookEventSchema accepts known event types', () => {
  const parsed = WebhookEventSchema.parse({
    id: 'evt_1',
    type: 'chat.completed',
    createdAt: Date.now(),
    userId: 'user_1',
    data: { conversationId: 'conv_1' },
  })
  assert.equal(parsed.type, 'chat.completed')
})

test('CreateWebhookSubscriptionRequest requires supported events', () => {
  const parsed = CreateWebhookSubscriptionRequest.parse({
    url: 'https://example.com/hook',
    events: ['chat.completed'],
  })
  assert.deepEqual(parsed.events, ['chat.completed'])
})

test('WebhookEventSchema rejects unknown event types', () => {
  assert.throws(() => WebhookEventSchema.parse({
    id: 'evt_1',
    type: 'unknown.event',
    createdAt: Date.now(),
    userId: 'user_1',
    data: {},
  }))
})
