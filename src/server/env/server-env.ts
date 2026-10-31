import 'server-only'

/**
 * Server-only environment (secrets, deployment hostnames, non-public overrides).
 */

function read(name: string): string {
  return process.env[name]?.trim() ?? ''
}

export const serverEnv = {
  vercelUrl: read('VERCEL_URL'),
  devAppUrlOverride: read('DEV_NEXT_PUBLIC_APP_URL'),
  sentryDsn: read('SENTRY_DSN'),
} as const

export function isDevelopmentRuntime(): boolean {
  return process.env.NODE_ENV === 'development'
}
