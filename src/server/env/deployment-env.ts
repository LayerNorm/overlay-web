import 'server-only'

import { publicEnv } from '@/shared/env/public-env'

/** Next inlines public build values; generic process.env lookups do not. */
export function deploymentEnv(
  env: Record<string, string | undefined> = process.env,
  built: Pick<typeof publicEnv, 'appUrl' | 'convexUrl'> = publicEnv,
): Record<string, string | undefined> {
  const isolated = env.OVERLAY_DEPLOYMENT_ENV === 'preview'
    || (env.OVERLAY_DEPLOYMENT_ENV === 'staging' && env.OVERLAY_RELEASE_LANE === 'staging')
  if (!isolated) return env
  // Convex's --cmd injects the backend URL into next build, not the hosting
  // project's runtime variable store. Both the server and browser must use
  // that captured value rather than a stale shared URL from the dashboard.
  return { ...env, NEXT_PUBLIC_CONVEX_URL: built.convexUrl, NEXT_PUBLIC_APP_URL: built.appUrl }
}
