import type { CaptureResult, PostHog } from 'posthog-js'
import { FIRST_REPLY_EVENT } from '@/shared/chat/first-reply-timing'

let client: Promise<PostHog | null> | null = null

/** Timing events need no page: these leave without URLs, referrers, session entry pages or person updates. */
const PAGE_FREE_EVENTS = new Set<string>([FIRST_REPLY_EVENT])
// posthog-js merges `$session_entry_*` over per-event properties, so only a send hook can remove them.
const PAGE_CONTEXT_PROPERTY = /url|host|pathname|referr|^\$session_entry_|^\$set|^\$unset|^utm_|^route$/i

export function withoutPageContext(result: CaptureResult | null): CaptureResult | null {
  if (!result || !PAGE_FREE_EVENTS.has(result.event)) return result
  return {
    uuid: result.uuid,
    event: result.event,
    timestamp: result.timestamp,
    properties: Object.fromEntries(Object.entries(result.properties ?? {})
      .filter(([key]) => !PAGE_CONTEXT_PROPERTY.test(key))),
  }
}

function envFeatureEnabled(name: string): boolean {
  const value = process.env[`NEXT_PUBLIC_${name}`] ?? process.env[name]
  return !['0', 'false', 'no', 'off'].includes((value ?? '').trim().toLowerCase())
}

function resolvePersistence(): 'localStorage' | 'memory' {
  try {
    const probeKey = '__overlay_posthog_probe__'
    window.localStorage.setItem(probeKey, '1')
    window.localStorage.removeItem(probeKey)
    return 'localStorage'
  } catch {
    return 'memory'
  }
}

export function posthogConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_POSTHOG_TOKEN?.trim() && process.env.NEXT_PUBLIC_POSTHOG_HOST?.trim(),
  )
}

export function clientObservabilityContext(route?: string): Record<string, string> {
  return {
    deployment: process.env.NEXT_PUBLIC_OVERLAY_DEPLOYMENT_ID?.trim() || 'web',
    environment: process.env.NEXT_PUBLIC_OVERLAY_DEPLOYMENT_ENV?.trim() || 'unknown',
    release: process.env.NEXT_PUBLIC_OVERLAY_RELEASE?.trim() || 'unknown',
    ...(route ? { route } : {}),
  }
}

/**
 * Loads and initializes posthog-js once, on first use, so analytics never sits in
 * the startup JavaScript. Calls made before it loads run in order once it is ready.
 * Resolves null when analytics is disabled, unconfigured or failed to initialize.
 */
export function loadPosthog(): Promise<PostHog | null> {
  client ??= (async () => {
    const token = process.env.NEXT_PUBLIC_POSTHOG_TOKEN?.trim()
    const host = process.env.NEXT_PUBLIC_POSTHOG_HOST?.trim()
    if (typeof window === 'undefined' || !envFeatureEnabled('OVERLAY_FEATURE_ANALYTICS') || !token || !host) return null
    try {
      const { default: posthog } = await import('posthog-js')
      posthog.init(token, {
        api_host: host,
        defaults: '2026-01-30',
        autocapture: false,
        capture_pageview: false,
        capture_pageleave: true,
        persistence: resolvePersistence(),
        before_send: withoutPageContext,
      })
      posthog.register(clientObservabilityContext())
      return posthog
    } catch (error) {
      console.warn('[PostHog] Client init failed; analytics disabled for this session.', error)
      return null
    }
  })()
  return client
}

export function withPosthog(action: (posthog: PostHog) => void): void {
  void loadPosthog().then((posthog) => {
    if (!posthog) return
    try {
      action(posthog)
    } catch {
      // ignore blocked storage / init failures (common on mobile Safari private mode)
    }
  })
}
