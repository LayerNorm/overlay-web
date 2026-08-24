/**
 * Client-safe environment values (NEXT_PUBLIC_* only).
 * Next.js inlines these at build time in browser bundles.
 * Do not add server secrets or non-NEXT_PUBLIC vars here.
 */

function read(value: string | undefined): string {
  return value?.trim() ?? ''
}

export const publicEnv = {
  appUrl: read(process.env.NEXT_PUBLIC_APP_URL),
  convexUrl: read(process.env.NEXT_PUBLIC_CONVEX_URL),
  devConvexUrl:
    read(process.env.NEXT_PUBLIC_DEV_CONVEX_URL) ||
    read(process.env.DEV_NEXT_PUBLIC_CONVEX_URL),
  /** Client TTFT milestone logging (pair with server TTFT_DEBUG). */
  ttftDebug: read(process.env.NEXT_PUBLIC_TTFT_DEBUG) === 'true',
  sentryDsn: read(process.env.NEXT_PUBLIC_SENTRY_DSN),
} as const

/** True in development builds (inlined by the bundler). */
export function isDevelopmentBuild(): boolean {
  return process.env.NODE_ENV === 'development'
}
