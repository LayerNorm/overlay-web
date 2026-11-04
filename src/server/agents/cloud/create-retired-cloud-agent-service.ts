import 'server-only'

import { getOverlayServerContext } from '@/server/bootstrap'
import { RetiredCloudAgentService } from './RetiredCloudAgentService'

export function createRetiredCloudAgentService() {
  const server = getOverlayServerContext()
  return new RetiredCloudAgentService({
    audit: server.auditService,
    controlPlane: server.connectedAgentControlPlane,
    repository: server.appData.repositories.connectedAgents,
    provisions: server.appData.repositories.cloudAgentProvisions,
  })
}
