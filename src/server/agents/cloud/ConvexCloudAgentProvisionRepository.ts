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
    await convex.mutation(
      'providers/cloudAgentProvisions:setPhaseByServer',
      { serverSecret: getInternalApiSecret(), ...args },
      { throwOnError: true },
    )
  }

  async remove(args: { workspaceId: string; agentId: string }) {
    await convex.mutation(
      'providers/cloudAgentProvisions:removeByServer',
      { serverSecret: getInternalApiSecret(), ...args },
      { throwOnError: true },
    )
  }
}
