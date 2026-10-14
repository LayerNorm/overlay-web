import 'server-only'

import { optionalEnv } from '@/server/env'

/**
 * Mirrors the web app's Convex URL selection: production points at
 * NEXT_PUBLIC_CONVEX_URL, and local development picks up the engineer-owned
 * dev backend via DEV_NEXT_PUBLIC_CONVEX_URL when set.
 */
export function resolveAdminConvexUrl(): string {
  if (process.env.NODE_ENV === 'development') {
    const devUrl = optionalEnv('DEV_NEXT_PUBLIC_CONVEX_URL')
    if (devUrl) return devUrl
  }
  const url = optionalEnv('NEXT_PUBLIC_CONVEX_URL') ?? optionalEnv('CONVEX_URL')
  if (!url) {
    throw new Error('Missing Convex URL for the admin app (NEXT_PUBLIC_CONVEX_URL).')
  }
  return url
}
