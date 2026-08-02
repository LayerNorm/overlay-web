import { isDevelopmentBuild, publicEnv } from '@/shared/env/public-env'

/**
 * Resolves the Convex deployment URL for browser clients (public env only).
 *
 * Staging builds are production Node builds, so prefer the explicit public
 * Convex URL set on the staging Vercel project. When a secondary dev URL is
 * also present (local or mis-set dual env), prefer it only for non-production
 * app hosts / development builds.
 */
export function resolveConvexUrl(): string {
  const preferDevSurface =
    isDevelopmentBuild()
    || /staging\.getoverlay\.io/i.test(publicEnv.appUrl)

  if (preferDevSurface && publicEnv.devConvexUrl) {
    return publicEnv.devConvexUrl
  }
  if (publicEnv.convexUrl) {
    return publicEnv.convexUrl
  }
  if (publicEnv.devConvexUrl) {
    return publicEnv.devConvexUrl
  }
  return ''
}
