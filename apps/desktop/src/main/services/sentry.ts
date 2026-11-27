import * as Sentry from '@sentry/electron/main'
import { redactSentryEvent } from '../../shared/security/telemetry-redaction'
import { settingsService } from './settings-service'

let initialized = false

export function initSentry(): void {
  try {
    const dsn = process.env.SENTRY_DSN || ''

    if (initialized || !dsn || !settingsService.analyticsConsentEnabled) return

    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV || 'production',
      sendDefaultPii: false,
      beforeSend: (event) =>
        settingsService.analyticsConsentEnabled ? redactSentryEvent(event) : null
    })
    initialized = true
  } catch {
    // Monitoring must never prevent the application from starting.
  }
}

export function configureDiagnostics(enabled: boolean): void {
  settingsService.analyticsConsentEnabled = enabled
  settingsService.persistCurrentSettings()
  if (enabled) initSentry()
}
