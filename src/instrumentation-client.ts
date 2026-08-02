import * as Sentry from '@sentry/nextjs'
import posthog from 'posthog-js'
import { sanitizeSentryEvent } from '@/shared/security/sentry-sanitize'

function envFeatureEnabled(name: string): boolean {
  const value = process.env[`NEXT_PUBLIC_${name}`] ?? process.env[name]
  return !['0', 'false', 'no', 'off'].includes((value ?? '').trim().toLowerCase())
}

function sentryProviderEnabled(): boolean {
  const provider = (
    process.env.NEXT_PUBLIC_OVERLAY_PROVIDER_ERROR_REPORTING ??
    process.env.OVERLAY_PROVIDER_ERROR_REPORTING ??
    ''
  ).trim().toLowerCase()
  return provider !== 'none'
}

function clientObservabilityContext(): Record<string, string> {
  return {
    deployment: process.env.NEXT_PUBLIC_OVERLAY_DEPLOYMENT_ID?.trim() || 'web',
    environment: process.env.NEXT_PUBLIC_OVERLAY_DEPLOYMENT_ENV?.trim() || 'unknown',
    release: process.env.NEXT_PUBLIC_OVERLAY_RELEASE?.trim() || 'unknown',
  }
}

if (envFeatureEnabled('OVERLAY_FEATURE_ERROR_REPORTING') && sentryProviderEnabled()) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: clientObservabilityContext().environment,
    release: clientObservabilityContext().release,
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
    posthog.register(clientObservabilityContext())
  } catch (error) {
    console.warn('[PostHog] Client init failed; analytics disabled for this session.', error)
  }
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
