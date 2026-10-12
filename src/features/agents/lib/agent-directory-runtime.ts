import type { AgentBinding } from '@overlay/workspace-contracts'
import { parseByoModelId } from '@/shared/agents/agent-model'

export function indexActiveAgentBindings(bindings: AgentBinding[]) {
  const byAgentId = new Map<string, AgentBinding>()
  for (const binding of bindings) {
    if (!binding.enabled || byAgentId.has(binding.agentId)) continue
    byAgentId.set(binding.agentId, binding)
  }
  return byAgentId
}

export function getAgentRuntimeLabel(modelId: string, binding?: AgentBinding) {
  if (binding?.enabled) {
    const configuredAdapterId = binding.adapterConfig.adapterId ?? binding.adapterConfig.harnessId
    const adapterId = typeof configuredAdapterId === 'string' && configuredAdapterId.trim()
      ? configuredAdapterId.trim()
      : binding.protocolAdapter
    return binding.protocolAdapter === 'harness'
      ? `${adapterId} · Overlay Cloud`
      : `${adapterId} · connected`
  }

  const byo = parseByoModelId(modelId)
  return byo ? `${byo.adapterId}${byo.model ? ` · ${byo.model}` : ''} · connected` : modelId
}
