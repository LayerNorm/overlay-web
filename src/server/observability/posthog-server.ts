import 'server-only'

import { PostHog } from 'posthog-node'
import { getOverlayRuntimeConfigSync } from '@/server/config'
import { getObservabilityContext } from './context'
import type { LifecycleEvent, LifecycleEventSink } from '@/server/lifecycle-events'

export type ProductEvent =
  | {
    name: 'activation.completed'
    properties: { authProvider: 'better-auth' | 'none' | 'oidc' | 'workos' }
    userId: string
  }
  | {
    name: 'auth.session.signed_in'
    properties: Record<never, never>
    userId: string
  }
  | {
    name: 'automation.run.failed'
    properties: {
      execution: 'manual' | 'scheduled'
      failureClass: 'authorization' | 'provider' | 'transient' | 'unknown' | 'validation'
    }
    userId: string
  }
  | {
    name: 'automation.run.succeeded'
    properties: { execution: 'manual' | 'scheduled' }
    userId: string
  }
  | {
    name: 'billing.subscription.changed'
    properties: {
      changeSource: 'checkout_verification' | 'provider_webhook'
      planKind: 'free' | 'paid'
      provider: 'stripe'
      status: 'active' | 'canceled' | 'past_due' | 'trialing' | 'unknown'
    }
    userId: string
  }
  | {
    name: 'billing.topup.succeeded'
    properties: { provider: 'stripe'; source: 'auto' | 'manual' }
    userId: string
  }
  | {
    name: 'workspace.invitation_sent'
    properties: Record<string, unknown>
    userId: string
  }
  | {
    name: 'workspace.mention'
    properties: Record<string, unknown>
    userId: string
  }
  | {
    name: 'workspace.dm_received'
    properties: Record<string, unknown>
    userId: string
  }

let posthogClient: PostHog | null = null

export function getPostHogClient(): PostHog | null {
  if (!posthogEnabled()) return null

  const token = process.env.NEXT_PUBLIC_POSTHOG_TOKEN?.trim()
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST?.trim()
  if (!token || !host) return null

  if (!posthogClient) {
    posthogClient = new PostHog(token, {
      host,
      flushAt: 1,
      flushInterval: 0,
    })
  }
  return posthogClient
}

export function captureProductEvent(event: ProductEvent): void {
  const posthog = getPostHogClient()
  if (!posthog) return

  posthog.capture({
    distinctId: event.userId,
    event: event.name,
    properties: {
      ...getObservabilityContext(),
      ...event.properties,
    },
  })
}

/**
 * Flush pending PostHog events.  Must be called before a Vercel serverless
 * function exits, otherwise captured events are lost when the runtime tears
 * down the process.  Returns a promise that resolves when the flush completes.
 */
export async function flushPostHog(): Promise<void> {
  const posthog = getPostHogClient()
  if (!posthog) return
  try {
    await posthog.flush()
  } catch (_error) {
    // flush failure must not break the request
  }
}

export function createPostHogLifecycleSink(): LifecycleEventSink {
  return {
    destination: 'analytics',
    async deliver(event) {
      const productEvent = productEventForLifecycle(event)
      if (productEvent) captureProductEvent(productEvent)
    },
  }
}

function posthogEnabled(): boolean {
  try {
    const config = getOverlayRuntimeConfigSync()
    const provider = config.providers.analytics?.provider ?? 'posthog'
    return config.features.analytics !== false && provider === 'posthog'
  } catch (_error) {
    return false
  }
}

export function productEventForLifecycle(event: LifecycleEvent): ProductEvent | null {
  switch (event.name) {
    case 'user.created':
      return {
        name: 'activation.completed',
        properties: event.attributes,
        userId: event.userId,
      }
    case 'subscription.changed':
      return {
        name: 'billing.subscription.changed',
        properties: event.attributes,
        userId: event.userId,
      }
    case 'topup.succeeded':
      return {
        name: 'billing.topup.succeeded',
        properties: event.attributes,
        userId: event.userId,
      }
    case 'automation.succeeded':
      return {
        name: 'automation.run.succeeded',
        properties: { execution: event.attributes.execution },
        userId: event.userId,
      }
    case 'automation.failed':
      return {
        name: 'automation.run.failed',
        properties: {
          execution: event.attributes.execution,
          failureClass: event.attributes.failureClass ?? 'unknown',
        },
        userId: event.userId,
      }
    case 'api_key.changed':
      return null
    case 'workspace.invitation_sent':
      return {
        name: 'workspace.invitation_sent',
        properties: event.attributes,
        userId: event.userId,
      }
    case 'workspace.mention':
      return {
        name: 'workspace.mention',
        properties: event.attributes,
        userId: event.userId,
      }
    case 'workspace.dm_received':
      return {
        name: 'workspace.dm_received',
        properties: event.attributes,
        userId: event.userId,
      }
  }
}
