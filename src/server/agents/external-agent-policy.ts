import 'server-only'

import { getOverlayRuntimeConfig } from '@/server/config'
import { connectedAgentRolloutConfigFromEnv, connectedAgentRolloutEnabled, resolveConnectedAgentRollout } from '@/shared/agents/connected-agent-rollout'
import { parseByoModelId } from '@/shared/agents/agent-model'

export type ExternalAgentPolicyRecord = {
  id: string
  workspaceId: string
  harness?: string
  modelId: string
}

export type ExternalAgentPolicyDecision = {
  external: boolean
  allowed: boolean
}

export function isPersistedExternalAgent(record: ExternalAgentPolicyRecord): boolean {
  return record.harness !== undefined && record.harness !== 'overlay'
    || parseByoModelId(record.modelId) !== null
}

export function isExternalAgentInvocation(
  record: ExternalAgentPolicyRecord,
  hasConnectedBinding: boolean,
  hasInvocationTarget: boolean,
): boolean {
  return isPersistedExternalAgent(record) || hasConnectedBinding || hasInvocationTarget
}

export async function externalAgentLaunchEnabled(workspaceId?: string): Promise<boolean> {
  const runtime = await getOverlayRuntimeConfig()
  if (
    runtime.features.externalAgents !== true
    || runtime.features.connectedAgentControlPlane !== true
    || runtime.features.remoteAgentRuns !== true
  ) return false
  if (!workspaceId) return connectedAgentRolloutEnabled(connectedAgentRolloutConfigFromEnv(process.env))
  return resolveConnectedAgentRollout(
    connectedAgentRolloutConfigFromEnv(process.env),
    workspaceId,
  ).eligible
}

export function disabledExternalAgentMessage(): string {
  return 'External agent runtimes are disabled for this deployment.'
}
