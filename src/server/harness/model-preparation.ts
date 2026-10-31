import 'server-only'

import type { LanguageModelV4CallOptions } from '@ai-sdk/provider'
import { getGatewayCatalogModel } from '@/server/ai/gateway/gateway-catalog'
import type { PersonalChatWorkToolingContext } from '@/shared/agents/personal-chat-work'
import { quoteHarnessModel } from './model-quote'
import { refreshPersonalHarnessAccess, type PersonalHarnessAccess } from './personal-access'
import { serializePersonalHarnessAuthentication } from './personal-authentication'
import { surfaceHarnessTurnId } from './surface-authority'
import type { HarnessModelReference } from './secure-model'

export async function readHarnessModelLimits(modelId: string): Promise<{ contextWindow: number | null; maxOutputTokens: number | null }> {
  'use step'
  const catalog = await getGatewayCatalogModel(modelId)
  return {
    contextWindow: catalog?.type === 'language' && Number.isSafeInteger(catalog.contextWindow) && catalog.contextWindow! > 0
      ? catalog.contextWindow! : null,
    maxOutputTokens: catalog?.type === 'language' && Number.isSafeInteger(catalog.maxTokens) && catalog.maxTokens! > 0
      ? catalog.maxTokens! : null,
  }
}

export async function preparePersonalHarnessModel(input: {
  access: PersonalHarnessAccess
  context: Omit<PersonalChatWorkToolingContext, 'entitlements' | 'paid'>
  receiptId: string
  options: LanguageModelV4CallOptions
}): Promise<{
  model: HarnessModelReference
  options: LanguageModelV4CallOptions
  contextWindow: number | null
  estimatedCostMicros: number
}> {
  'use step'

  const context = await refreshPersonalHarnessAccess(input.access, input.context)
  const { options, contextWindow, estimatedCostMicros, inputTokenBudget, maxOutputTokens } = await quoteHarnessModel({
    modelId: context.effectiveModelId, requiresZeroDataRetention: context.requiresZeroDataRetention, options: input.options,
  })
  const access = input.access
  return {
    model: {
      modelId: context.effectiveModelId, credentialOwnerId: access.actorUserId,
      sessionId: access.conversationId, allowLowBalanceFallback: false,
      personal: {
        access: {
          actorUserId: access.actorUserId, workspaceId: access.workspaceId, principalId: access.principalId,
          runId: access.runId, workflowRunId: access.workflowRunId, conversationId: access.conversationId, agentRunId: access.agentRunId,
          authentication: serializePersonalHarnessAuthentication(access.authentication),
        },
        receiptId: input.receiptId, memoryEnabled: context.memoryEnabled,
        requestFingerprint: context.requestFingerprint,
        ...(access.authentication.type === 'automation' ? { automationContext: {
          turnId: context.turnId,
          accountAllowedToolIds: context.accountAllowedToolIds ?? [],
          accountAllowedConnectorIds: context.accountAllowedConnectorIds ?? [],
          integrationToolIds: context.integrationToolIds ?? [],
        } } : {}),
        ...(access.authentication.type === 'surface' ? { surfaceContext: {
          turnId: surfaceHarnessTurnId(access.authentication),
          accountAllowedToolIds: context.accountAllowedToolIds ?? [],
          accountAllowedConnectorIds: context.accountAllowedConnectorIds ?? [],
          integrationToolIds: context.integrationToolIds ?? [],
        } } : {}),
        ...(context.billingProgrammaticSubjectId ? { billingProgrammaticSubjectId: context.billingProgrammaticSubjectId } : {}),
        inputTokenBudget, maxOutputTokens: maxOutputTokens!, contextWindow,
      },
    },
    options, contextWindow, estimatedCostMicros,
  }
}
