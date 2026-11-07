import type { HarnessPolicy } from '@overlay/agent-runtime/harness-state'
import { isByokModelId } from '@/shared/ai/gateway/byok-model-conversion'

export type PersonalHarnessBudget = { maxProviderCostUsd?: number; durationMs?: number }

const DAY_MS = 24 * 60 * 60 * 1_000

function selectPublicStreamVersion(
  existingPolicy: HarnessPolicy | null | undefined,
  workspaceId: string,
): 1 | undefined {
  if (existingPolicy) return existingPolicy.publicStreamVersion === 1 ? 1 : undefined
  return isUnifiedStreamingWorkspaceEnabled(workspaceId) ? 1 : undefined
}

export function isUnifiedStreamingWorkspaceEnabled(
  workspaceId: string,
  allowlist = process.env.OVERLAY_UNIFIED_STREAMING_WORKSPACE_IDS ?? '',
): boolean {
  if (!workspaceId.trim() || !allowlist.trim()) return false
  return allowlist.split(',').some(candidate => {
    const id = candidate.trim()
    return id !== '*' && id === workspaceId
  })
}

export function personalHarnessPolicy(input: {
  actorUserId: string
  workspaceId: string
  allowedToolIds: string[]
  modelId: string
  paid: boolean
  createdAt: number
  budget?: PersonalHarnessBudget
  existingPolicy?: HarnessPolicy | null
}): HarnessPolicy {
  const hasExplicitSpendCap = input.budget?.maxProviderCostUsd !== undefined
  const maxProviderCostUsd = input.budget?.maxProviderCostUsd ?? 0
  const durationMs = input.budget?.durationMs ?? DAY_MS
  if (!Number.isFinite(maxProviderCostUsd) || maxProviderCostUsd < 0 || maxProviderCostUsd > 100
    || !Number.isSafeInteger(durationMs) || durationMs < 30_000 || durationMs > 7 * DAY_MS
    || !Number.isSafeInteger(input.createdAt) || input.createdAt < 0) {
    throw new Error('Invalid personal harness budget.')
  }
  const byok = isByokModelId(input.modelId)
  const workspaceFunded = input.paid && !byok && !hasExplicitSpendCap
  const versioned = !hasExplicitSpendCap
  const publicStreamVersion = selectPublicStreamVersion(input.existingPolicy, input.workspaceId)
  return {
    publicProgressVersion: 1,
    ...(publicStreamVersion === 1 ? { publicStreamVersion: 1 as const } : {}),
    actorUserId: input.actorUserId,
    workspaceId: input.workspaceId,
    ...(versioned ? {
      executionPolicyVersion: 2 as const,
      spendingMode: workspaceFunded ? 'workspace' as const : byok ? 'external' as const : 'none' as const,
    } : {}),
    allowedToolIds: [...new Set(input.allowedToolIds)].sort(),
    requiresPlan: false,
    deadlineAt: input.createdAt + (versioned ? DAY_MS : durationMs),
    ...(versioned && input.budget?.durationMs !== undefined
      ? { taskDeadlineAt: input.createdAt + durationMs } : {}),
    maxCostMicros: versioned ? 0
      : input.paid && !byok ? Math.floor(maxProviderCostUsd * 1_000_000) : 0,
    maxParallelChildren: 3,
    maxDepth: 2,
  }
}
