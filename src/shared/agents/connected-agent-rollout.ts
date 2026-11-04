export const CONNECTED_AGENT_ROLLOUT_STAGES = ['off', 'internal', 'invited', 'general'] as const

export type ConnectedAgentRolloutStage = typeof CONNECTED_AGENT_ROLLOUT_STAGES[number]

type ConnectedAgentRolloutConfig = {
  stage?: string
  internalWorkspaceIds?: string
  invitedWorkspaceIds?: string
}

export type ConnectedAgentRolloutDecision = {
  eligible: boolean
  stage: ConnectedAgentRolloutStage
}

export function connectedAgentRolloutConfigFromEnv(
  env: Record<string, string | undefined>,
): ConnectedAgentRolloutConfig {
  return {
    stage: env.OVERLAY_CONNECTED_AGENTS_ROLLOUT_STAGE,
    internalWorkspaceIds: env.OVERLAY_CONNECTED_AGENTS_INTERNAL_WORKSPACE_IDS,
    invitedWorkspaceIds: env.OVERLAY_CONNECTED_AGENTS_INVITED_WORKSPACE_IDS,
  }
}

export function resolveConnectedAgentRollout(
  config: ConnectedAgentRolloutConfig,
  workspaceId?: string,
): ConnectedAgentRolloutDecision {
  const stage = parseConnectedAgentRolloutStage(config.stage)
  const normalizedWorkspaceId = workspaceId?.trim()
  if (!normalizedWorkspaceId || stage === 'off') return { eligible: false, stage }
  if (stage === 'general') return { eligible: true, stage }

  const internal = csvSet(config.internalWorkspaceIds)
  const invited = csvSet(config.invitedWorkspaceIds)
  return {
    eligible: internal.has(normalizedWorkspaceId)
      || (stage === 'invited' && invited.has(normalizedWorkspaceId)),
    stage,
  }
}

export function connectedAgentRolloutEnabled(config: ConnectedAgentRolloutConfig): boolean {
  return parseConnectedAgentRolloutStage(config.stage) !== 'off'
}

export function parseConnectedAgentRolloutStage(value: string | undefined): ConnectedAgentRolloutStage {
  const normalized = value?.trim().toLowerCase()
  return CONNECTED_AGENT_ROLLOUT_STAGES.includes(normalized as ConnectedAgentRolloutStage)
    ? normalized as ConnectedAgentRolloutStage
    : 'off'
}

function csvSet(value: string | undefined): Set<string> {
  return new Set((value ?? '').split(',').map((entry) => entry.trim()).filter(Boolean))
}
