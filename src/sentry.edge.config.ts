import * as Sentry from '@sentry/nextjs'
import { sanitizeSentryEvent } from '@/shared/security/sentry-sanitize'

const errorReportingEnabled = !['0', 'false', 'no', 'off'].includes(
  (process.env.OVERLAY_FEATURE_ERROR_REPORTING ?? '').trim().toLowerCase(),
) && process.env.OVERLAY_PROVIDER_ERROR_REPORTING?.trim().toLowerCase() !== 'none'
const environment = process.env.OVERLAY_DEPLOYMENT_ENV?.trim() || process.env.VERCEL_ENV?.trim()
const release = process.env.OVERLAY_RELEASE?.trim() || process.env.VERCEL_GIT_COMMIT_SHA?.trim()

// Intentional mirror of sentry.server.config.ts: Next.js loads edge and server configs separately.
if (errorReportingEnabled) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment,
    release,
    sendDefaultPii: false,
    tracesSampleRate: process.env.NODE_ENV === 'development' ? 1 : 0.1,
    beforeSend: sanitizeSentryEvent,
  })
}
