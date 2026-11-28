export const maxDuration = 300

/**
 * Overlay-billed model calls from a private thread on Overlay Desktop. Auth is the short-lived private-model bearer
 * token the desktop asked for with its session (`POST /api/v1/private-threads/model-access`), not the session cookie,
 * so this sits outside the BFF wrapper. Nothing about the call is stored.
 */
export async function POST(request: Request) {
  const [{ handlePrivateModelRelay }, { privateModelRelayDependencies }] = await Promise.all([
    import('@/server/private-threads/model-relay'),
    import('@/server/private-threads/model-relay-runtime'),
  ])
  return handlePrivateModelRelay(request, privateModelRelayDependencies)
}
