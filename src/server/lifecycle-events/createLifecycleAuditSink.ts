import 'server-only'

import type { AuditService } from '@/server/admin'
import type { LifecycleEventSink } from './LifecycleEventPublisher'

export function createLifecycleAuditSink(auditService: AuditService): LifecycleEventSink {
  return {
    destination: 'audit',
    async deliver(event) {
      await auditService.record({
        action: `lifecycle.${event.name}`,
        actorType: 'system',
        actorUserId: event.userId,
        metadata: {
          classification: event.classification,
          eventName: event.name,
          idempotencyKey: event.idempotencyKey,
          schemaVersion: event.schemaVersion,
        },
        outcome: 'success',
        resourceId: event.resource.id,
        resourceType: event.resource.type,
      })
    },
  }
}
