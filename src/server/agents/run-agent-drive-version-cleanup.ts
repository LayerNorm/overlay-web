import 'server-only'
import { z } from 'zod/v3'
import { getOverlayServerContext } from '@/server/bootstrap'
import { lazyConvex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { cleanupDriveVersions } from './cleanup-agent-drive-versions'

/** Runs through the existing authenticated artifact-cleanup tick, including after the drive is disabled. */
export async function cleanupAgentDriveVersions() {
  const store = getOverlayServerContext().objectStore
  const head = store.headObject?.bind(store)
  if (!head) return { deleted: 0, deferred: 0, unavailable: true }
  const serverSecret = getInternalApiSecret()
  return cleanupDriveVersions({
    claim: claim => lazyConvex.mutation('agents/agentDriveCleanup:claimByServer', { serverSecret, claim }, { throwOnError: true }),
    deleteObject: key => store.deleteObject(key),
    absent: async key => await head(key) === null,
    acknowledge: async ({ id, claim }) => z.boolean().parse(await lazyConvex.mutation('agents/agentDriveCleanup:acknowledgeByServer',
      { serverSecret, id, claim }, { throwOnError: true })),
  })
}
