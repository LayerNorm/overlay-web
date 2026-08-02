import 'server-only'

import { randomUUID } from 'node:crypto'
import type { EventBus } from '@overlay/app-core'
import {
  LIFECYCLE_EVENT_SCHEMA_VERSION,
  LIFECYCLE_EVENT_TOPIC,
  destinationsForLifecycleEvent,
  type LifecycleEvent,
  type LifecycleEventDestination,
  type LifecycleEventInput,
} from './contract'

export interface LifecycleEventSink {
  deliver(event: LifecycleEvent): Promise<void>
  destination: LifecycleEventDestination
}

export class LifecycleEventPublisher {
  private readonly clock: { now(): number }
  private readonly enabled: () => boolean
  private readonly onDeliveryFailure: (args: {
    destination: LifecycleEventDestination | 'event_bus'
    eventName: LifecycleEvent['name']
  }) => void
  private readonly sinks: readonly LifecycleEventSink[]

  constructor(private readonly deps: {
    clock?: { now(): number }
    enabled?: () => boolean
    eventBus: EventBus
    onDeliveryFailure?: (args: {
      destination: LifecycleEventDestination | 'event_bus'
      eventName: LifecycleEvent['name']
    }) => void
    sinks?: readonly LifecycleEventSink[]
  }) {
    this.clock = deps.clock ?? { now: () => Date.now() }
    this.enabled = deps.enabled ?? (() => true)
    this.onDeliveryFailure = deps.onDeliveryFailure ?? (() => {})
    this.sinks = deps.sinks ?? []
  }

  async publish(input: LifecycleEventInput): Promise<LifecycleEvent | null> {
    try {
      if (!this.enabled()) return null
    } catch (_error) {
      return null
    }
    if (!hasOpaqueIdentifiers(input)) return null

    const event = {
      ...input,
      classification: 'operational' as const,
      destinations: destinationsForLifecycleEvent(input.name),
      eventId: `lifecycle_${randomUUID()}`,
      occurredAt: this.clock.now(),
      schemaVersion: LIFECYCLE_EVENT_SCHEMA_VERSION,
    } as LifecycleEvent

    try {
      await this.deps.eventBus.publish(LIFECYCLE_EVENT_TOPIC, event)
    } catch (_error) {
      this.reportDeliveryFailure({ destination: 'event_bus', eventName: event.name })
    }

    await Promise.all(event.destinations.map(async (destination) => {
      const sinks = this.sinks.filter((sink) => sink.destination === destination)
      await Promise.all(sinks.map(async (sink) => {
        try {
          await sink.deliver(event)
        } catch (_error) {
          this.reportDeliveryFailure({ destination, eventName: event.name })
        }
      }))
    }))

    return event
  }

  private reportDeliveryFailure(args: {
    destination: LifecycleEventDestination | 'event_bus'
    eventName: LifecycleEvent['name']
  }): void {
    try {
      this.onDeliveryFailure(args)
    } catch (_error) {
      // Lifecycle delivery is observational; its failure must not affect the source workflow.
    }
  }
}

function hasOpaqueIdentifiers(event: LifecycleEventInput): boolean {
  const resourceIdentifiers = 'automationId' in event.resource
    ? [event.resource.id, event.resource.automationId]
    : [event.resource.id]
  return [event.idempotencyKey, event.userId, ...resourceIdentifiers]
    .every(isOpaqueIdentifier)
}

function isOpaqueIdentifier(value: string): boolean {
  return /^[A-Za-z0-9_.:-]{1,256}$/.test(value)
}
