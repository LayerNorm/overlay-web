import * as Sentry from '@sentry/nextjs'

function errorReportingEnabled(): boolean {
  return !['0', 'false', 'no', 'off'].includes(
    (process.env.OVERLAY_FEATURE_ERROR_REPORTING ?? '').trim().toLowerCase(),
  )
}

function telemetryEnabled(): boolean {
  return !['0', 'false', 'no', 'off'].includes(
    (process.env.OVERLAY_FEATURE_TELEMETRY ?? '1').trim().toLowerCase(),
  )
}

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { assertConfiguredPostgresSchemaCompatible } = await import(
      './server/database/postgres/schema-compatibility'
    )
    await assertConfiguredPostgresSchemaCompatible()
  }

  // v7: Register AI SDK OpenTelemetry integration for production observability.
  // Emits traces for every generateText/streamText/ToolLoopAgent call.
  // Disabled when OVERLAY_FEATURE_TELEMETRY=0 (defaults to enabled).
  if (telemetryEnabled() && process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      const { registerTelemetry } = await import('ai')
      const { OpenTelemetry } = await import('@ai-sdk/otel')
      // Type assertion: @ai-sdk/otel and ai may have slightly different
      // Telemetry interface versions — the runtime contract is compatible.
      registerTelemetry(new OpenTelemetry() as never)
    } catch {
      // Telemetry packages may not be installed in all environments — fail silently.
    }
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
