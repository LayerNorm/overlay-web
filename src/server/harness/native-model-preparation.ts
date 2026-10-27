import 'server-only'

import type { LanguageModelV4CallOptions } from '@ai-sdk/provider'
import { refreshNativeHarnessAccess, type NativeHarnessAccess, type NativeHarnessContext } from './native-access'
import { quoteHarnessModel } from './model-quote'
import type { PreparedHarnessModel } from './model-ports'

export async function prepareNativeHarnessModel(input: {
  access: NativeHarnessAccess
  context: NativeHarnessContext
  receiptId: string
  options: LanguageModelV4CallOptions
}): Promise<PreparedHarnessModel> {
  'use step'

  const context = await refreshNativeHarnessAccess(input.access, input.context)
  const { options, contextWindow, estimatedCostMicros, inputTokenBudget, maxOutputTokens } = await quoteHarnessModel({
    modelId: input.context.modelId, requiresZeroDataRetention: context.requiresZeroDataRetention, options: input.options,
  })
  const access = input.access
  return {
    model: {
      modelId: input.context.modelId, credentialOwnerId: access.actorUserId,
      sessionId: access.conversationId, allowLowBalanceFallback: false,
      native: {
        access: {
          actorUserId: access.actorUserId, runId: access.runId, workflowRunId: access.workflowRunId,
          workspaceId: access.workspaceId, principalId: access.principalId,
          agentId: access.agentId, agentPrincipalId: access.agentPrincipalId,
          conversationId: access.conversationId, agentRunId: access.agentRunId,
          userMessageId: access.userMessageId, assistantMessageId: access.assistantMessageId, turnId: access.turnId,
        },
        receiptId: input.receiptId, memoryEnabled: input.context.memoryEnabled, sharedRoom: input.context.sharedRoom,
        requestFingerprint: input.context.requestFingerprint, inputTokenBudget, maxOutputTokens, contextWindow,
      },
    },
    options, contextWindow, estimatedCostMicros,
  }
}
