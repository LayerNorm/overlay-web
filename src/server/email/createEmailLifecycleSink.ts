import 'server-only'

import type { OutboxRepository } from '@/server/jobs'
import type { LifecycleEventSink } from '@/server/lifecycle-events'
import { LIFECYCLE_EMAIL_OUTBOX_TOPIC } from './EmailOutboxDelivery'

export function createEmailLifecycleSink(outbox: OutboxRepository): LifecycleEventSink {
  return {
    destination: 'email',
    deliver: async (event) => {
      await outbox.append({
        dedupeKey: `transactional-email:${event.idempotencyKey}`,
        id: `email_${event.eventId}`,
        maxAttempts: 8,
        payload: {
          attributes: event.attributes,
          idempotencyKey: event.idempotencyKey,
          name: event.name,
          resource: event.resource,
          userId: event.userId,
        },
        topic: LIFECYCLE_EMAIL_OUTBOX_TOPIC,
      })
    },
  }
}
