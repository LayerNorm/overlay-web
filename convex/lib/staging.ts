/** Guard synthetic fixtures with the platform-supplied deployment URL. */
export function requireStagingSeedEnvironment(env: Record<string, string | undefined>) {
  if (env.OVERLAY_DEPLOYMENT_ENV !== 'staging'
    || env.CONVEX_CLOUD_URL !== 'https://doting-cuttlefish-819.convex.cloud'
    || env.WORKOS_CLIENT_ID !== 'client_01KJ9A19X317J7VWRWQ6XBME9Z'
    || env.STAGING_SMOKE_USER_ID !== 'user_01M4R1EKTMDZ4E6BQ5DMZXD0F2'
    || env.STAGING_SMOKE_EMAIL !== 'overlay-preview-qa@getoverlay.io') {
    throw new Error('Synthetic staging seed is unavailable on this deployment')
  }
  return { userId: env.STAGING_SMOKE_USER_ID, email: env.STAGING_SMOKE_EMAIL }
}
