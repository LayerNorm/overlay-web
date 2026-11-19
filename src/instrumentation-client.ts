import * as Sentry from '@sentry/nextjs'
import { sanitizeSentryEvent } from '@/shared/security/sentry-sanitize'
import { clientObservabilityContext, loadPosthog } from '@/components/providers/posthog-client'
import { preloadWhenIdle } from '@/shared/app/preload-when-idle'

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

preloadWhenIdle(loadPosthog)

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
