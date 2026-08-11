export const WORKSPACE_BILLING_ROLLOUT_STAGES = ['off', 'internal', 'selected', 'general'] as const

export type WorkspaceBillingRolloutStage = typeof WORKSPACE_BILLING_ROLLOUT_STAGES[number]

export type WorkspaceBillingRolloutDecision = {
  checkoutEnabled: boolean
  eligible: boolean
  stage: WorkspaceBillingRolloutStage
}

type WorkspaceBillingRolloutConfig = {
  enabled?: string
  internalWorkspaceIds?: string
  selectedWorkspaceIds?: string
  stage?: string
}

export function workspaceBillingRolloutConfigFromEnv(env: Record<string, string | undefined>): WorkspaceBillingRolloutConfig {
  return {
    enabled: env.OVERLAY_FEATURE_WORKSPACE_WALLETS,
    internalWorkspaceIds: env.OVERLAY_WORKSPACE_BILLING_INTERNAL_WORKSPACE_IDS,
    selectedWorkspaceIds: env.OVERLAY_WORKSPACE_BILLING_SELECTED_WORKSPACE_IDS,
    stage: env.OVERLAY_WORKSPACE_BILLING_ROLLOUT_STAGE,
  }
}

export function workspaceBillingRolloutEnabled(config: WorkspaceBillingRolloutConfig): boolean {
  return ['1', 'true', 'yes', 'on'].includes(config.enabled?.trim().toLowerCase() ?? '')
    && parseWorkspaceBillingRolloutStage(config.stage) !== 'off'
}

export function resolveWorkspaceBillingRollout(
  config: WorkspaceBillingRolloutConfig,
  workspaceId?: string,
): WorkspaceBillingRolloutDecision {
  const configuredStage = parseWorkspaceBillingRolloutStage(config.stage)
  const stage = workspaceBillingRolloutEnabled(config) ? configuredStage : 'off'
  const normalizedWorkspaceId = workspaceId?.trim()
  if (!normalizedWorkspaceId || stage === 'off') {
    return { checkoutEnabled: false, eligible: false, stage }
  }

  const internal = csvSet(config.internalWorkspaceIds)
  const selected = csvSet(config.selectedWorkspaceIds)
  const eligible = stage === 'general'
    || internal.has(normalizedWorkspaceId)
    || (stage === 'selected' && selected.has(normalizedWorkspaceId))
  return { checkoutEnabled: eligible, eligible, stage }
}

export function parseWorkspaceBillingRolloutStage(value: string | undefined): WorkspaceBillingRolloutStage {
  const normalized = value?.trim().toLowerCase()
  return WORKSPACE_BILLING_ROLLOUT_STAGES.includes(normalized as WorkspaceBillingRolloutStage)
    ? normalized as WorkspaceBillingRolloutStage
    : 'off'
}

function csvSet(value: string | undefined): Set<string> {
  return new Set((value ?? '').split(',').map((entry) => entry.trim()).filter(Boolean))
}
