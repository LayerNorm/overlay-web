import * as Sentry from '@sentry/react'
import { redactSentryEvent } from '../../../shared/security/telemetry-redaction'

let initialized = false
let consentEnabled = false

export function setRendererMonitoringConsent(enabled: boolean): void {
  consentEnabled = enabled === true
  if (!enabled) {
    if (initialized) void Sentry.getClient()?.close(2_000)
    initialized = false
    return
  }
  if (initialized) return
  const dsn = import.meta.env.SENTRY_DSN || ''
  if (!dsn) return

  try {
    Sentry.init({
      dsn,
      environment: import.meta.env.IS_DEV ? 'development' : 'production',
      sendDefaultPii: false,
      beforeSend: (event) => (consentEnabled ? redactSentryEvent(event) : null)
    })
    initialized = true
  } catch {
    // Monitoring must never prevent the application from starting.
  }
}
