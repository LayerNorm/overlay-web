import * as Sentry from '@sentry/nextjs'
import posthog from 'posthog-js'
import { sanitizeSentryEvent } from '@/shared/security/sentry-sanitize'

function envFeatureEnabled(name: string): boolean {
  const value = process.env[`NEXT_PUBLIC_${name}`] ?? process.env[name]
  return !['0', 'false', 'no', 'off'].includes((value ?? '').trim().toLowerCase())
}

if (envFeatureEnabled('OVERLAY_FEATURE_ERROR_REPORTING')) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    sendDefaultPii: false,
    tracesSampleRate: process.env.NODE_ENV === 'development' ? 1 : 0.1,
    beforeSend: sanitizeSentryEvent,
  })
}

const posthogToken = process.env.NEXT_PUBLIC_POSTHOG_TOKEN?.trim()
const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST?.trim()

function resolvePosthogPersistence(): 'localStorage' | 'memory' {
  if (typeof window === 'undefined') return 'memory'
  try {
    const probeKey = '__overlay_posthog_probe__'
    window.localStorage.setItem(probeKey, '1')
    window.localStorage.removeItem(probeKey)
    return 'localStorage'
  } catch {
    return 'memory'
  }
}

if (envFeatureEnabled('OVERLAY_FEATURE_ANALYTICS') && posthogToken && posthogHost) {
  try {
    posthog.init(posthogToken, {
      api_host: posthogHost,
      defaults: '2026-01-30',
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: true,
      persistence: resolvePosthogPersistence(),
    })
  } catch (error) {
    console.warn('[PostHog] Client init failed; analytics disabled for this session.', error)
  }
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
