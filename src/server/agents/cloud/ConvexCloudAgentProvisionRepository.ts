import 'server-only'

import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import type { CloudAgentProvisionRecord, CloudAgentProvisionRepository } from './CloudAgentProvisionRepository'

export class ConvexCloudAgentProvisionRepository implements CloudAgentProvisionRepository {
  async get(args: { workspaceId: string; agentId: string }) {
    return await convex.query<CloudAgentProvisionRecord | null>(
      'providers/cloudAgentProvisions:getByServer',
      { serverSecret: getInternalApiSecret(), ...args },
      { throwOnError: true },
    )
  }

  async begin(args: Parameters<CloudAgentProvisionRepository['begin']>[0]) {
    const result = await convex.mutation<{ started: boolean; phase: CloudAgentProvisionRecord['phase'] }>(
      'providers/cloudAgentProvisions:beginByServer',
      { serverSecret: getInternalApiSecret(), ...args },
      { throwOnError: true },
    )
    if (!result) throw new Error('Could not start provisioning')
    return result
  }

  async setPhase(args: Parameters<CloudAgentProvisionRepository['setPhase']>[0]) {
    const result = await convex.mutation<boolean>(
      'providers/cloudAgentProvisions:setPhaseByServer',
      { serverSecret: getInternalApiSecret(), ...args },
      { throwOnError: true },
    )
    return result === true
  }

  async recordAllocation(args: Parameters<CloudAgentProvisionRepository['recordAllocation']>[0]) {
    const result = await convex.mutation<{ bound: boolean }>(
      'providers/cloudAgentProvisions:recordAllocationByServer',
      { serverSecret: getInternalApiSecret(), ...args },
      { throwOnError: true },
    )
    if (!result) throw new Error('Could not record cloud agent allocation')
    return result
  }

  async claimReclaim(args: Parameters<CloudAgentProvisionRepository['claimReclaim']>[0]) {
    return await convex.mutation<CloudAgentProvisionRecord | null>(
      'providers/cloudAgentProvisions:claimReclaimByServer',
      { serverSecret: getInternalApiSecret(), ...args },
      { throwOnError: true },
    )
  }

  async markReclaimPending(args: Parameters<CloudAgentProvisionRepository['markReclaimPending']>[0]) {
    const result = await convex.mutation<boolean>(
      'providers/cloudAgentProvisions:markReclaimPendingByServer',
      { serverSecret: getInternalApiSecret(), ...args },
      { throwOnError: true },
    )
    return result === true
  }

  async finishReclaim(args: Parameters<CloudAgentProvisionRepository['finishReclaim']>[0]) {
    const result = await convex.mutation<boolean>(
      'providers/cloudAgentProvisions:finishReclaimByServer',
      { serverSecret: getInternalApiSecret(), ...args },
      { throwOnError: true },
    )
    return result === true
  }

  async releaseAllocation(args: Parameters<CloudAgentProvisionRepository['releaseAllocation']>[0]) {
    const result = await convex.mutation<boolean>(
      'providers/cloudAgentProvisions:releaseAllocationByServer',
      { serverSecret: getInternalApiSecret(), ...args },
      { throwOnError: true },
    )
    return result === true
  }

  async listReclaimable(args: Parameters<CloudAgentProvisionRepository['listReclaimable']>[0]) {
    const result = await convex.query<CloudAgentProvisionRecord[]>(
      'providers/cloudAgentProvisions:listReclaimableByServer',
      { serverSecret: getInternalApiSecret(), ...args },
      { throwOnError: true },
    )
    return result ?? []
  }

  async remove(args: { workspaceId: string; agentId: string }) {
    await convex.mutation(
      'providers/cloudAgentProvisions:removeByServer',
      { serverSecret: getInternalApiSecret(), ...args },
      { throwOnError: true },
    )
  }
}
