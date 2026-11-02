import 'server-only'

import { PostHog } from 'posthog-node'
import { getOverlayRuntimeConfigSync } from '@/server/config'
import { getObservabilityContext } from './context'
import type { LifecycleEvent, LifecycleEventSink } from '@/server/lifecycle-events'

/**
 * The only product event sent from the server. Growth numbers (activity,
 * retention, billing, automations) are counted from Convex by the nightly
 * growth job, so PostHog keeps just the signup that attributes a visit.
 */
export type ProductEvent = {
  name: 'user.signed_up'
  properties: { authProvider: 'better-auth' | 'none' | 'oidc' | 'workos' }
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
  if (event.name !== 'user.created') return null
  return {
    name: 'user.signed_up',
    properties: event.attributes,
    userId: event.userId,
  }
}
