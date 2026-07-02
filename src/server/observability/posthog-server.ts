import 'server-only'

import { PostHog } from 'posthog-node'

let posthogClient: PostHog | null = null

export function getPostHogClient(): PostHog | null {
  const analyticsFlag = process.env.OVERLAY_FEATURE_ANALYTICS?.trim().toLowerCase()
  if (['0', 'false', 'no', 'off'].includes(analyticsFlag ?? '')) return null

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
