import 'server-only'

import { getOverlayServerContext } from '@/server/bootstrap'
import { isAgentProviderId } from '@/shared/agents/provider-accounts'
import { CloudAgentMachineService } from './CloudAgentMachineService'

/** The machine service wired to the running server's repositories and account vault. */
export function createCloudAgentMachineService() {
  const server = getOverlayServerContext()
  return new CloudAgentMachineService({
    audit: server.auditService,
    controlPlane: server.connectedAgentControlPlane,
    repository: server.appData.repositories.connectedAgents,
    provisions: server.appData.repositories.cloudAgentProvisions,
    accountSummary: async (userId, accountId) => {
      const account = (await server.agentProviderAccounts.list(userId)).find((candidate) => candidate.id === accountId)
      if (!account || !isAgentProviderId(account.provider)) return null
      return { id: account.id, label: account.label, provider: account.provider, method: account.method, status: account.status }
    },
  })
}
