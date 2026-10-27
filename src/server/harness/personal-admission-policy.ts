import type { HarnessPolicy } from '@overlay/agent-runtime/harness-state'
import { isByokModelId } from '@/shared/ai/gateway/byok-model-conversion'

export type PersonalHarnessBudget = { maxProviderCostUsd?: number; durationMs?: number }

const DAY_MS = 24 * 60 * 60 * 1_000

export function personalHarnessPolicy(input: {
  actorUserId: string
  workspaceId: string
  allowedToolIds: string[]
  requiresPlan?: boolean
  modelId: string
  paid: boolean
  createdAt: number
  budget?: PersonalHarnessBudget
}): HarnessPolicy {
  const maxProviderCostUsd = input.budget?.maxProviderCostUsd ?? 1
  const durationMs = input.budget?.durationMs ?? DAY_MS
  if (!Number.isFinite(maxProviderCostUsd) || maxProviderCostUsd < 0 || maxProviderCostUsd > 100
    || !Number.isSafeInteger(durationMs) || durationMs < 30_000 || durationMs > 7 * DAY_MS
    || !Number.isSafeInteger(input.createdAt) || input.createdAt < 0) {
    throw new Error('Invalid personal harness budget.')
  }
  return {
    actorUserId: input.actorUserId,
    workspaceId: input.workspaceId,
    allowedToolIds: [...new Set(input.allowedToolIds)].sort(),
    requiresPlan: input.requiresPlan ?? false,
    deadlineAt: input.createdAt + durationMs,
    maxCostMicros: input.paid && !isByokModelId(input.modelId) ? Math.floor(maxProviderCostUsd * 1_000_000) : 0,
    maxParallelChildren: 3,
    maxDepth: 2,
  }
}
