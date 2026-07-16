import 'server-only'

import type { ServiceAuthPayload } from '@/server/auth/service-auth'

export async function consumeServiceAuthReplayNonce(payload: ServiceAuthPayload): Promise<boolean> {
  const { getOverlayServerContext } = await import('@/server/bootstrap')
  return await getOverlayServerContext().appData.repositories.serviceAuthReplay.consume(payload)
}
