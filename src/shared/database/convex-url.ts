import { isDevelopmentBuild, publicEnv } from '@/shared/env/public-env'

/** Resolves the Convex deployment URL for browser clients (public env only). */
export function resolveConvexUrl(): string {
  if (isDevelopmentBuild() && publicEnv.devConvexUrl) {
    return publicEnv.devConvexUrl
  }
  if (publicEnv.convexUrl) {
    return publicEnv.convexUrl
  }
  return ''
}
