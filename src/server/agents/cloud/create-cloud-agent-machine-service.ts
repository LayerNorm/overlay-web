import 'server-only'

import { getOverlayServerContext } from '@/server/bootstrap'
import { isSupportedAgentProviderId } from '@/shared/agents/provider-accounts'
import type { Entitlements } from '@/shared/app/app-contracts'
import { ComputerAdmission } from '@/server/computers/ComputerAdmission'
import { ComputerServiceError } from '@/server/computers/ComputerService'
import { CloudAgentMachineError, CloudAgentMachineService } from './CloudAgentMachineService'

/** The machine service wired to the running server's repositories and account vault. */
export function createCloudAgentMachineService() {
  const server = getOverlayServerContext()
  const admission = new ComputerAdmission({
    payerResolver: server.billingPayerResolver,
    getEntitlements: async (billingAccountId) =>
      await server.appData.repositories.billing.getBillingAccountEntitlementsByServer({ billingAccountId }) as Entitlements | null,
  })
  return new CloudAgentMachineService({
    audit: server.auditService,
    controlPlane: server.connectedAgentControlPlane,
    repository: server.appData.repositories.connectedAgents,
    provisions: server.appData.repositories.cloudAgentProvisions,
    assertCanRun: async (input) => {
      await server.workspaceAgentService.get({ actorUserId: input.userId, workspaceId: input.workspaceId, agentId: input.agentId })
      try {
        await admission.assertCanRun(input)
      } catch (error) {
        if (error instanceof ComputerServiceError) throw new CloudAgentMachineError(error.message, error.status, error.code)
        throw error
      }
    },
    accountSummary: async (userId, accountId) => {
      const account = (await server.agentProviderAccounts.list(userId)).find((candidate) => candidate.id === accountId)
      if (!account || !isSupportedAgentProviderId(account.provider)) return null
      return { id: account.id, label: account.label, provider: account.provider, method: account.method, status: account.status }
    },
  })
}
