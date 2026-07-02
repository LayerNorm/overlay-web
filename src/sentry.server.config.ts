import * as Sentry from '@sentry/nextjs'
import { sanitizeSentryEvent } from '@/shared/security/sentry-sanitize'

const errorReportingEnabled = !['0', 'false', 'no', 'off'].includes(
  (process.env.OVERLAY_FEATURE_ERROR_REPORTING ?? '').trim().toLowerCase(),
)

// Intentional mirror of sentry.edge.config.ts: Next.js loads edge and server configs separately.
if (errorReportingEnabled) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN,
    sendDefaultPii: false,
    tracesSampleRate: process.env.NODE_ENV === 'development' ? 1 : 0.1,
    beforeSend: sanitizeSentryEvent,
  })
}
