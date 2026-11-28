import 'server-only'

import type { LanguageModelV4 } from '@ai-sdk/provider'
import { getGatewayLanguageModel } from '@/server/ai/gateway/ai-gateway'
import { getGatewayModelId } from '@/server/ai/gateway/gateway-runtime'
import { calculateLanguageModelTokenCostOrNull } from '@/server/ai/gateway/live-model-pricing'
import { chargeProviderUsage, ensureProviderBudgetNotLow, getPayerEntitlements } from '@/server/billing/billing-runtime'
import { getOverlayServerContext } from '@/server/bootstrap'
import { privateThreadTier } from '@/server/mcp/private-thread-tools'
import { logger } from '@/server/observability/logger'
import { getModel } from '@/shared/ai/gateway/model-data'
import { newPrivateModelOperationId, type PrivateModelRelayDependencies } from './model-relay'

const subject = (agentId: string) => `agent:${agentId}`
const PAID_ONLY = { ok: false, status: 402, code: 'paid_plan_required', message: 'Overlay’s models in private threads need a paid workspace. Use your own key or plan instead.' } as const

/** The relay as production runs it: Overlay's model gateway, workspace billing and the agent's spend subject. */
export const privateModelRelayDependencies: PrivateModelRelayDependencies = {
  async isMember(userId, workspaceId) {
    return await getOverlayServerContext().workspaceService.resolveActiveWorkspace(userId, workspaceId).then(() => true, (_error) => false)
  },

  async resolveModel(modelId) {
    // Only Overlay's own chat models, never an arbitrary gateway id.
    if (!getModel(modelId)) return null
    return await getGatewayLanguageModel(modelId) as unknown as LanguageModelV4
  },

  async admit(claims, modelId) {
    // Paid workspaces only: the free tier runs private threads on the person's own keys and plans.
    if (await privateThreadTier(claims).catch((_error) => 'none' as const) !== 'paid') return PAID_ONLY
    const programmaticSubjectId = subject(claims.agentId)
    const entitlements = await getPayerEntitlements({ userId: claims.userId, workspaceId: claims.workspaceId, programmaticSubjectId })
      .catch((_error) => null)
    if (!entitlements) return PAID_ONLY
    const check = await ensureProviderBudgetNotLow({
      userId: claims.userId,
      entitlements,
      kind: 'agent',
      modelId,
      operationId: 'private-thread-model',
      workspaceId: claims.workspaceId,
      programmaticSubjectId,
    })
    if (check.ok) return { ok: true }
    const message = typeof check.payload.message === 'string' ? check.payload.message : 'Less than 2% of the workspace budget is left.'
    return { ok: false, status: check.status, code: check.code, message }
  },

  async charge(claims, modelId, usage, reportedCostUsd) {
    const catalogCostUsd = await calculateLanguageModelTokenCostOrNull(
      getGatewayModelId(modelId), usage.inputTokens, usage.cacheReadTokens, usage.outputTokens, usage.cacheWriteTokens,
    )
    const providerCostUsd = catalogCostUsd ?? reportedCostUsd
    if (providerCostUsd === null) {
      logger.warn('[private-thread-model] no price for model; usage not charged', { modelId: modelId.slice(0, 120) })
      return
    }
    await chargeProviderUsage({
      userId: claims.userId,
      workspaceId: claims.workspaceId,
      programmaticSubjectId: subject(claims.agentId),
      operationId: newPrivateModelOperationId(),
      providerCostUsd,
      usage: {
        kind: 'agent',
        modelId,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cachedTokens: usage.cacheReadTokens,
      },
    })
  },

  log(message, details) {
    logger.error(message, details)
  },
}
