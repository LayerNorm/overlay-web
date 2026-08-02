import * as Sentry from '@sentry/nextjs'

function errorReportingEnabled(): boolean {
  const feature = process.env.OVERLAY_FEATURE_ERROR_REPORTING?.trim().toLowerCase()
  if (['0', 'false', 'no', 'off'].includes(feature ?? '')) return false
  // This file is compiled for the Edge runtime. Runtime config may read a local
  // file, so use only the explicit environment override here. Server-side
  // capability resolution remains the source of truth for app behavior.
  const provider = process.env.OVERLAY_PROVIDER_ERROR_REPORTING?.trim().toLowerCase()
  return provider !== 'none'
}

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { assertConfiguredPostgresSchemaCompatible } = await import(
      './server/database/postgres/schema-compatibility'
    )
    await assertConfiguredPostgresSchemaCompatible()
    const { startOnPremOpenTelemetry } = await import('./server/observability/open-telemetry')
    await startOnPremOpenTelemetry()
  }

  if (!errorReportingEnabled()) return

  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config')
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config')
  }
}

export const onRequestError: typeof Sentry.captureRequestError = (...args) => {
  if (!errorReportingEnabled()) return
  return Sentry.captureRequestError(...args)
}
