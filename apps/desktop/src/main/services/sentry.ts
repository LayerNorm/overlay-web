import * as Sentry from '@sentry/electron/main'
import { redactSentryEvent } from '../../shared/security/telemetry-redaction'
import { settingsService } from './settings-service'

export function initSentry(): void {
  try {
    const dsn = process.env.SENTRY_DSN || ''

    if (!dsn || !settingsService.analyticsConsentEnabled) return

    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV || 'production',
      sendDefaultPii: false,
      beforeSend: (event) =>
        settingsService.analyticsConsentEnabled ? redactSentryEvent(event) : null
    })
  } catch {
    // Monitoring must never prevent the application from starting.
  }
}
