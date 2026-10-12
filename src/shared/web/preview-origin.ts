/** Read the origin provisioned by trusted PR automation, never a request Host. */
export function previewOrigin(env: Record<string, string | undefined>): string | undefined {
  if (env.OVERLAY_DEPLOYMENT_ENV !== 'preview') return undefined
  if (env.VERCEL_ENV !== 'preview') throw new Error('Preview configuration requires a Vercel preview')
  const origin = env.NEXT_PUBLIC_APP_URL?.trim() ?? ''
  const match = /^https:\/\/pr-([1-9]\d*)\.preview\.getoverlay\.io$/.exec(origin)
  if (!match || (env.VERCEL_GIT_PULL_REQUEST_ID && env.VERCEL_GIT_PULL_REQUEST_ID !== match[1])) {
    throw new Error('Preview app URL must be the provisioned HTTPS origin for this PR')
  }
  return origin
}
