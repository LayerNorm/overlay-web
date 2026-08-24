import 'server-only'

import type {
  AgentApprovalRequest,
  AgentBinding,
  AgentEnrollmentSession,
  AgentEnvironment,
  AgentEnvironmentCredential,
  AgentEnvironmentEnrollmentView,
  AgentEnvironmentProofChallenge,
  AgentRemoteSession,
  AgentRunCommand,
  AgentSandboxLease,
} from '@overlay/workspace-contracts'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import type { ApplyRemoteEventsResult, ConnectedAgentRepository } from './ConnectedAgentRepository'

const PREFIX = 'agents/connectedAgents'
const CONTROL_PREFIX = 'agents/environmentControlPlane'

export class ConvexConnectedAgentRepository implements ConnectedAgentRepository {
  createEnrollmentSession(input: Parameters<ConnectedAgentRepository['createEnrollmentSession']>[0]) {
    return controlMutation<AgentEnrollmentSession>('createEnrollmentSessionByServer', input)
  }
  redeemEnrollmentSession(input: Parameters<ConnectedAgentRepository['redeemEnrollmentSession']>[0]) {
    return controlMutationNullable<Awaited<ReturnType<ConnectedAgentRepository['redeemEnrollmentSession']>>>('redeemEnrollmentSessionByServer', input)
  }
  listEnvironments(input: Parameters<ConnectedAgentRepository['listEnvironments']>[0]) {
    return controlQuery<AgentEnvironment[]>('listEnvironmentsByServer', input)
  }
  getEnvironment(input: Parameters<ConnectedAgentRepository['getEnvironment']>[0]) {
    return controlQuery<AgentEnvironment | null>('getEnvironmentByServer', input)
  }
  getEnvironmentEnrollment(input: Parameters<ConnectedAgentRepository['getEnvironmentEnrollment']>[0]) {
    return controlQuery<AgentEnvironmentEnrollmentView | null>('getEnvironmentEnrollmentByServer', input)
  }
  approveEnvironment(input: Parameters<ConnectedAgentRepository['approveEnvironment']>[0]) {
    return controlMutationNullable<AgentEnvironment | null>('approveEnvironmentByServer', input)
  }
  updateEnvironmentFilesystemGrant(input: Parameters<ConnectedAgentRepository['updateEnvironmentFilesystemGrant']>[0]) {
    return controlMutationNullable<AgentEnvironment | null>('updateEnvironmentFilesystemGrantByServer', input)
  }
  getEnvironmentProofChallenge(input: Parameters<ConnectedAgentRepository['getEnvironmentProofChallenge']>[0]) {
    return controlQuery<{ environment: AgentEnvironment; proofChallenge: AgentEnvironmentProofChallenge } | null>('getEnvironmentProofChallengeByServer', input)
  }
  issueEnvironmentCredential(input: Parameters<ConnectedAgentRepository['issueEnvironmentCredential']>[0]) {
    return controlMutationNullable<AgentEnvironmentCredential | null>('issueEnvironmentCredentialByServer', input)
  }
  findEnvironmentCredential(input: Parameters<ConnectedAgentRepository['findEnvironmentCredential']>[0]) {
    return controlQuery<AgentEnvironmentCredential | null>('findEnvironmentCredentialByServer', input)
  }
  consumeEnvironmentProofNonce(input: Parameters<ConnectedAgentRepository['consumeEnvironmentProofNonce']>[0]) {
    return controlMutation<boolean>('consumeEnvironmentProofNonceByServer', input)
  }
  rotateEnvironmentCredential(input: Parameters<ConnectedAgentRepository['rotateEnvironmentCredential']>[0]) {
    return controlMutationNullable<AgentEnvironmentCredential | null>('rotateEnvironmentCredentialByServer', input)
  }
  heartbeatEnvironment(input: Parameters<ConnectedAgentRepository['heartbeatEnvironment']>[0]) {
    return controlMutationNullable<AgentEnvironment | null>('heartbeatEnvironmentByServer', input)
  }
  updateEnvironmentCapabilities(input: Parameters<ConnectedAgentRepository['updateEnvironmentCapabilities']>[0]) {
    return controlMutationNullable<AgentEnvironment | null>('updateEnvironmentCapabilitiesByServer', input)
  }
  createEnvironment(input: Parameters<ConnectedAgentRepository['createEnvironment']>[0]) {
    return mutation<AgentEnvironment>('createEnvironmentByServer', input)
  }
  createBinding(input: Parameters<ConnectedAgentRepository['createBinding']>[0]) {
    return mutation<AgentBinding>('createBindingByServer', input)
  }
  upsertBinding(input: Parameters<ConnectedAgentRepository['upsertBinding']>[0]) {
    return mutation<AgentBinding>('upsertBindingByServer', input)
  }
  listBindings(input: Parameters<ConnectedAgentRepository['listBindings']>[0]) {
    return connectedQuery<Awaited<ReturnType<ConnectedAgentRepository['listBindings']>>>('listBindingsByServer', input)
  }
  disableBindingsForAgent(input: Parameters<ConnectedAgentRepository['disableBindingsForAgent']>[0]) {
    return mutation<boolean>('disableBindingsForAgentByServer', input)
  }
  findInvocationTarget(input: Parameters<ConnectedAgentRepository['findInvocationTarget']>[0]) {
    return connectedQuery<Awaited<ReturnType<ConnectedAgentRepository['findInvocationTarget']>>>('findInvocationTargetByServer', input)
  }
  startRemoteAgentTurn(input: Parameters<ConnectedAgentRepository['startRemoteAgentTurn']>[0]) {
    return mutation<Awaited<ReturnType<ConnectedAgentRepository['startRemoteAgentTurn']>>>('startRemoteAgentTurnByServer', input)
  }
  controlQueuedRemoteAgentTurn(input: Parameters<ConnectedAgentRepository['controlQueuedRemoteAgentTurn']>[0]) {
    return mutation<Awaited<ReturnType<ConnectedAgentRepository['controlQueuedRemoteAgentTurn']>>>('controlQueuedRemoteAgentTurnByServer', input)
  }
  createRemoteSession(input: Parameters<ConnectedAgentRepository['createRemoteSession']>[0]) {
    return mutation<AgentRemoteSession>('createRemoteSessionByServer', input)
  }
  getRemoteSessionForRun(input: Parameters<ConnectedAgentRepository['getRemoteSessionForRun']>[0]) {
    return connectedQuery<AgentRemoteSession | null>('getRemoteSessionForRunByServer', input)
  }
  enqueueCommand(input: Parameters<ConnectedAgentRepository['enqueueCommand']>[0]) {
    return mutation<AgentRunCommand>('enqueueCommandByServer', input)
  }
  claimCommands(input: Parameters<ConnectedAgentRepository['claimCommands']>[0]) {
    return mutation<AgentRunCommand[]>('claimCommandsByServer', input)
  }
  acknowledgeCommand(input: Parameters<ConnectedAgentRepository['acknowledgeCommand']>[0]) {
    return mutation<boolean>('acknowledgeCommandByServer', input)
  }
  createApprovalRequest(input: Parameters<ConnectedAgentRepository['createApprovalRequest']>[0]) {
    return mutation<AgentApprovalRequest>('createApprovalRequestByServer', input)
  }
  resolveApprovalRequest(input: Parameters<ConnectedAgentRepository['resolveApprovalRequest']>[0]) {
    return mutation<AgentApprovalRequest | null>('resolveApprovalRequestByServer', input)
  }
  createSandboxLease(input: Parameters<ConnectedAgentRepository['createSandboxLease']>[0]) {
    return mutation<AgentSandboxLease>('createSandboxLeaseByServer', input)
  }
  updateSandboxLease(input: Parameters<ConnectedAgentRepository['updateSandboxLease']>[0]) {
    return mutation<AgentSandboxLease | null>('updateSandboxLeaseByServer', input)
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

async function controlMutation<T>(operation: string, args: Record<string, unknown>): Promise<T> {
  const result = await controlMutationNullable<T>(operation, args)
  if (result === null || result === undefined) throw new Error(`Convex agent-environment operation ${operation} returned no result`)
  return result
}

async function controlMutationNullable<T>(operation: string, args: Record<string, unknown>): Promise<T> {
  return await convex.mutation<T>(`${CONTROL_PREFIX}:${operation}`, {
    ...args, serverSecret: getInternalApiSecret(),
  }, { throwOnError: true }) as T
}

async function controlQuery<T>(operation: string, args: Record<string, unknown>): Promise<T> {
  return await convex.query<T>(`${CONTROL_PREFIX}:${operation}`, {
    ...args, serverSecret: getInternalApiSecret(),
  }, { throwOnError: true }) as T
}

async function connectedQuery<T>(operation: string, args: Record<string, unknown>): Promise<T> {
  return await convex.query<T>(`${PREFIX}:${operation}`, {
    ...args, serverSecret: getInternalApiSecret(),
  }, { throwOnError: true }) as T
}

async function mutation<T>(operation: string, args: Record<string, unknown>): Promise<T> {
  const result = await convex.mutation<T>(`${PREFIX}:${operation}`, {
    ...args, serverSecret: getInternalApiSecret(),
  }, { throwOnError: true })
  if (result === null || result === undefined) throw new Error(`Convex connected-agent operation ${operation} returned no result`)
  return result
}
