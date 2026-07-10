import * as Sentry from '@sentry/nextjs'

function errorReportingEnabled(): boolean {
  return !['0', 'false', 'no', 'off'].includes(
    (process.env.OVERLAY_FEATURE_ERROR_REPORTING ?? '').trim().toLowerCase(),
  )
}

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { assertConfiguredPostgresSchemaCompatible } = await import(
      './server/database/postgres/schema-compatibility'
    )
    await assertConfiguredPostgresSchemaCompatible()
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
