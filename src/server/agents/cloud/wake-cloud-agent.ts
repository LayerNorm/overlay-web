import 'server-only'

import { after } from 'next/server'
import { logger } from '@/server/observability/logger'
import { createCloudAgentMachineService } from './create-cloud-agent-machine-service'

/**
 * Resume an Overlay Cloud agent's machine (and restart its host) after the
 * response is sent. The queued turn waits for the host, which claims it on its
 * first poll. A failed wake leaves the turn to the normal queue expiry.
 */
export function wakeCloudAgentAfterResponse(args: { workspaceId: string; environmentId: string }) {
  const wake = async () => {
    const service = createCloudAgentMachineService()
    const outcome = await service.wake(args)
    logger.info('[cloud-agent] wake', { ...args, outcome })
  }
  const run = () => wake().catch((error) => {
    logger.warn('[cloud-agent] wake failed', { ...args, error: error instanceof Error ? error.message : String(error) })
  })
  try {
    after(run)
  } catch (_error) {
    // Outside a request scope (tests, scripts): run inline in the background.
    void run()
  }
}
