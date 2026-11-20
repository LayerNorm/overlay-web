import type { HarnessPolicy } from '@overlay/agent-runtime/harness-state'
import { isByokModelId } from '@/shared/ai/gateway/byok-model-conversion'

export type PersonalHarnessBudget = { durationMs?: number }

const DAY_MS = 24 * 60 * 60 * 1_000

function selectPublicStreamVersion(existingPolicy: HarnessPolicy | null | undefined): 1 | undefined {
  if (existingPolicy) return existingPolicy.publicStreamVersion === 1 ? 1 : undefined
  return isUnifiedStreamingEnabled() ? 1 : undefined
}

/**
 * New roots use the unified stream unless OVERLAY_UNIFIED_STREAMING disables it.
 * Unset, empty or `on` enables it; `off` or any other value turns it off, so a
 * mistyped kill switch still falls back to the legacy path.
 */
export function isUnifiedStreamingEnabled(setting = process.env.OVERLAY_UNIFIED_STREAMING): boolean {
  const value = setting?.trim().toLowerCase() ?? ''
  return value === '' || value === 'on'
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
  const durationMs = input.budget?.durationMs ?? DAY_MS
  if (!Number.isSafeInteger(durationMs) || durationMs < 30_000
    || !Number.isSafeInteger(input.createdAt) || input.createdAt < 0) {
    throw new Error('Invalid personal harness budget.')
  }
  const byok = isByokModelId(input.modelId)
  const publicStreamVersion = selectPublicStreamVersion(input.existingPolicy)
  return {
    publicProgressVersion: 1,
    ...(publicStreamVersion === 1 ? { publicStreamVersion: 1 as const } : {}),
    actorUserId: input.actorUserId,
    workspaceId: input.workspaceId,
    executionPolicyVersion: 2,
    spendingMode: input.paid && !byok ? 'workspace' : byok ? 'external' : 'none',
    allowedToolIds: [...new Set(input.allowedToolIds)].sort(),
    requiresPlan: false,
    deadlineAt: input.createdAt + DAY_MS,
    // Only a deadline the person set explicitly; there is no per-task spending limit.
    ...(input.budget?.durationMs !== undefined ? { taskDeadlineAt: input.createdAt + durationMs } : {}),
    maxCostMicros: 0,
  }
}
