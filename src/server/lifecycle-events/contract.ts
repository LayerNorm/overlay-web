import 'server-only'

export const LIFECYCLE_EVENT_TOPIC = 'overlay.lifecycle.v1'
export const LIFECYCLE_EVENT_SCHEMA_VERSION = 1

export type LifecycleEventDestination = 'analytics' | 'audit' | 'email' | 'metrics' | 'notification'

export type LifecycleEventName =
  | 'user.created'
  | 'subscription.changed'
  | 'topup.succeeded'
  | 'automation.succeeded'
  | 'automation.failed'

type LifecycleEventBase<TName extends LifecycleEventName, TResource, TAttributes> = {
  attributes: TAttributes
  classification: 'operational'
  destinations: readonly LifecycleEventDestination[]
  eventId: string
  idempotencyKey: string
  name: TName
  occurredAt: number
  resource: TResource
  schemaVersion: typeof LIFECYCLE_EVENT_SCHEMA_VERSION
  userId: string
}

type UserCreatedLifecycleEvent = LifecycleEventBase<'user.created', {
    id: string
    type: 'user'
  }, {
    authProvider: 'better-auth' | 'none' | 'oidc' | 'workos'
  }>

type SubscriptionChangedLifecycleEvent = LifecycleEventBase<'subscription.changed', {
    id: string
    type: 'subscription'
  }, {
    changeSource: 'checkout_verification' | 'provider_webhook'
    planKind: 'free' | 'paid'
    provider: 'stripe'
    status: 'active' | 'canceled' | 'past_due' | 'trialing' | 'unknown'
  }>

type TopUpSucceededLifecycleEvent = LifecycleEventBase<'topup.succeeded', {
    id: string
    type: 'billing_topup'
  }, {
    provider: 'stripe'
    source: 'auto' | 'manual'
  }>

type AutomationLifecycleEvent<TName extends 'automation.succeeded' | 'automation.failed'> =
  LifecycleEventBase<TName, {
    automationId: string
    id: string
    type: 'automation_run'
  }, {
    execution: 'manual' | 'scheduled'
    failureClass?: 'authorization' | 'provider' | 'transient' | 'unknown' | 'validation'
  }>

export type LifecycleEvent =
  | UserCreatedLifecycleEvent
  | SubscriptionChangedLifecycleEvent
  | TopUpSucceededLifecycleEvent
  | AutomationLifecycleEvent<'automation.succeeded'>
  | AutomationLifecycleEvent<'automation.failed'>

export type LifecycleEventInput =
  | Omit<UserCreatedLifecycleEvent, 'classification' | 'destinations' | 'eventId' | 'occurredAt' | 'schemaVersion'>
  | Omit<SubscriptionChangedLifecycleEvent, 'classification' | 'destinations' | 'eventId' | 'occurredAt' | 'schemaVersion'>
  | Omit<TopUpSucceededLifecycleEvent, 'classification' | 'destinations' | 'eventId' | 'occurredAt' | 'schemaVersion'>
  | Omit<AutomationLifecycleEvent<'automation.succeeded'>, 'classification' | 'destinations' | 'eventId' | 'occurredAt' | 'schemaVersion'>
  | Omit<AutomationLifecycleEvent<'automation.failed'>, 'classification' | 'destinations' | 'eventId' | 'occurredAt' | 'schemaVersion'>

const lifecycleEventDestinations: Record<LifecycleEventName, readonly LifecycleEventDestination[]> = {
  'user.created': ['analytics', 'audit', 'email', 'metrics', 'notification'],
  'subscription.changed': ['analytics', 'audit', 'email', 'metrics', 'notification'],
  'topup.succeeded': ['analytics', 'audit', 'email', 'metrics', 'notification'],
  'automation.succeeded': ['analytics', 'audit', 'metrics', 'notification'],
  'automation.failed': ['analytics', 'audit', 'email', 'metrics', 'notification'],
}

export function destinationsForLifecycleEvent(
  name: LifecycleEventName,
): readonly LifecycleEventDestination[] {
  return lifecycleEventDestinations[name]
}
