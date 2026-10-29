import 'server-only'

import { lazyConvex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'

/**
 * The web deploys before Convex. The existing settings query carries an additive
 * server-owned capability marker. Production redacts missing-function errors, so
 * errors can never safely indicate readiness. Check before creating an AgentRun.
 */
export async function isHarnessBackendReady(actorUserId: string): Promise<boolean> {
  const settings = await lazyConvex.query<{ harnessRevision?: string }>('platform/uiSettings:getByServer', {
    userId: actorUserId, serverSecret: getInternalApiSecret(),
  }, { throwOnError: true })
  if (!settings) throw new Error('Harness backend readiness could not be determined.')
  if (settings.harnessRevision === undefined) return false
  if (settings.harnessRevision !== 'overlay-harness-v1') throw new Error('Unsupported Harness backend revision.')
  return true
}
