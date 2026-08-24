import 'server-only'

import type {
  AgentBinding,
  AgentEnvironment,
  AgentRemoteSession,
  AgentRunCommand,
} from '@overlay/workspace-contracts'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import type { ApplyRemoteEventsResult, ConnectedAgentRepository } from './ConnectedAgentRepository'

const PREFIX = 'agents/connectedAgents'

export class ConvexConnectedAgentRepository implements ConnectedAgentRepository {
  createEnvironment(input: Parameters<ConnectedAgentRepository['createEnvironment']>[0]) {
    return mutation<AgentEnvironment>('createEnvironmentByServer', input)
  }
  createBinding(input: Parameters<ConnectedAgentRepository['createBinding']>[0]) {
    return mutation<AgentBinding>('createBindingByServer', input)
  }
  createRemoteSession(input: Parameters<ConnectedAgentRepository['createRemoteSession']>[0]) {
    return mutation<AgentRemoteSession>('createRemoteSessionByServer', input)
  }
  enqueueCommand(input: Parameters<ConnectedAgentRepository['enqueueCommand']>[0]) {
    return mutation<AgentRunCommand>('enqueueCommandByServer', input)
  }
  claimCommands(input: Parameters<ConnectedAgentRepository['claimCommands']>[0]) {
    return mutation<AgentRunCommand[]>('claimCommandsByServer', input)
  }
  applyRemoteEvents(input: Parameters<ConnectedAgentRepository['applyRemoteEvents']>[0]) {
    return mutation<ApplyRemoteEventsResult>('applyRemoteEventsByServer', input)
  }
  revokeEnvironment(input: Parameters<ConnectedAgentRepository['revokeEnvironment']>[0]) {
    return mutation<boolean>('revokeEnvironmentByServer', input)
  }
  async deleteWorkspaceData(input: Parameters<ConnectedAgentRepository['deleteWorkspaceData']>[0]) {
    await mutation('deleteWorkspaceDataByServer', input)
  }
}

async function mutation<T>(operation: string, args: Record<string, unknown>): Promise<T> {
  const result = await convex.mutation<T>(`${PREFIX}:${operation}`, {
    ...args, serverSecret: getInternalApiSecret(),
  }, { throwOnError: true })
  if (result === null || result === undefined) throw new Error(`Convex connected-agent operation ${operation} returned no result`)
  return result
}
