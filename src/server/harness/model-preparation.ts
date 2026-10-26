import 'server-only'

import type { LanguageModelV4CallOptions } from '@ai-sdk/provider'
import { FatalError } from 'workflow'
import { getGatewayCatalogModel } from '@/server/ai/gateway/gateway-catalog'
import type { PersonalChatWorkToolingContext } from '@/shared/agents/personal-chat-work'
import { estimateHarnessInputTokens, forecastHarnessModelCost, hasHarnessCacheWrites } from './model-forecast'
import { refreshPersonalHarnessAccess, type PersonalHarnessAccess } from './personal-access'
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

// Call after compiling the exact prompt and tool schemas. This quotes only;
// dispatch reauthorizes and claims its account reservation inside the model step.
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
  const maxOutputTokens = input.options.maxOutputTokens
  if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens! <= 0) {
    throw new FatalError('A positive model output limit is required before dispatch.')
  }
  if (input.options.tools?.some(tool => tool.type === 'provider')) {
    throw new FatalError('Provider-executed tools require separate spend authorization.')
  }
  for (const routing of [input.options.providerOptions?.gateway, input.options.providerOptions?.openrouter]) {
    if (routing?.models !== undefined && (!Array.isArray(routing.models) || routing.models.length > 0)) {
      throw new FatalError('Model fallback must be selected before preparing dispatch.')
    }
  }
  const catalog = await getGatewayCatalogModel(context.effectiveModelId)
  const contextWindow = catalog?.type === 'language' && Number.isSafeInteger(catalog.contextWindow) && catalog.contextWindow! > 0
    ? catalog.contextWindow! : null
  if (catalog?.maxTokens !== undefined && (!Number.isSafeInteger(catalog.maxTokens) || catalog.maxTokens <= 0 || maxOutputTokens! > catalog.maxTokens)) {
    throw new FatalError('The output limit exceeds the selected model capacity.')
  }
  const options: LanguageModelV4CallOptions = {
    ...input.options,
    ...(context.requiresZeroDataRetention ? { providerOptions: {
      ...input.options.providerOptions,
      gateway: { ...input.options.providerOptions?.gateway, zeroDataRetention: true },
    } } : {}),
  }
  const inputTokenBudget = estimateHarnessInputTokens(options, contextWindow)
  const estimatedCostMicros = await forecastHarnessModelCost({
    modelId: context.effectiveModelId, inputTokenBudget, maxOutputTokens: maxOutputTokens!,
    cacheWrites: hasHarnessCacheWrites(options),
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
          authentication: access.authentication.type === 'api-key'
            ? { type: 'api-key', apiKeyId: access.authentication.apiKeyId }
            : { type: access.authentication.type },
        },
        receiptId: input.receiptId, memoryEnabled: context.memoryEnabled,
        requestFingerprint: context.requestFingerprint,
        ...(context.billingProgrammaticSubjectId ? { billingProgrammaticSubjectId: context.billingProgrammaticSubjectId } : {}),
        inputTokenBudget, maxOutputTokens: maxOutputTokens!, contextWindow,
      },
    },
    options, contextWindow, estimatedCostMicros,
  }
}
