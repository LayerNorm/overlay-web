import 'server-only'

import type { ModelMessage, StepResult, ToolSet } from 'ai'
import type { SourceCitationMap } from '@/shared/knowledge/ask-knowledge-types'
import type { AgentRunApproval } from '@/shared/agents/agent-run'
import {
  agentRunService,
  actMessagePersistenceService,
  actUsageBudgetService,
} from '@/server/conversations/http'

export async function attachPersonalChatWorkRun(input: {
  agentRunId: string
  resourceUserId: string
  workflowRunId: string
}) {
  'use step'
  return await agentRunService.attachWorkflow({
    runId: input.agentRunId,
    userId: input.resourceUserId,
    workflowRunId: input.workflowRunId,
  })
}

export async function markPersonalChatWorkWaiting(input: {
  agentRunId: string
  approval: AgentRunApproval
  resourceUserId: string
}) {
  'use step'
  return await agentRunService.waitForApproval({
    approval: input.approval,
    runId: input.agentRunId,
    userId: input.resourceUserId,
  })
}

export async function markPersonalChatWorkResumed(input: {
  agentRunId: string
  resourceUserId: string
}) {
  'use step'
  return await agentRunService.resumeAfterApproval({
    runId: input.agentRunId,
    userId: input.resourceUserId,
  })
}

export async function finalizePersonalChatWork(input: {
  agentRunId: string
  billingUserId: string
  conversationId: string
  emitWebhook: boolean
  event: {
    steps: StepResult<ToolSet>[]
    text: string
    usage?: { inputTokens?: number; outputTokens?: number }
  }
  modelId: string
  paid: boolean
  reservationId: string | null
  resourceUserId: string
  sourceCitations?: SourceCitationMap
  turnId: string
}) {
  'use step'

  const inputTokens = input.event.usage?.inputTokens ?? 0
  const outputTokens = input.event.usage?.outputTokens ?? 0
  await actUsageBudgetService.recordFinishedUsage({
    forceFreeTierLimits: !input.paid,
    inputTokens,
    modelId: input.modelId,
    operationId: `agent-run:${input.agentRunId}:usage`,
    outputTokens,
    reservationId: input.reservationId,
    userId: input.billingUserId,
  })
  const finishedToolCallIds = new Set<string>()
  for (const step of input.event.steps) {
    for (const result of step.toolResults ?? []) {
      if (result.toolCallId) finishedToolCallIds.add(result.toolCallId)
    }
  }
  await actMessagePersistenceService.persistAssistantFinish({
    agentRunId: input.agentRunId,
    attemptModelId: input.modelId,
    conversationId: input.conversationId as never,
    emitWebhook: input.emitWebhook,
    event: input.event,
    finishedToolCallIds,
    multiModelSlotIndex: 0,
    multiModelTotal: 1,
    sourceCitations: input.sourceCitations,
    timedOut: false,
    timeoutMs: 0,
    toolFailuresByCallId: new Map(),
    turnId: input.turnId,
    userId: input.resourceUserId,
    throwOnError: true,
  })
}

export async function failPersonalChatWork(input: {
  agentRunId: string
  billingUserId: string
  errorMessage: string
  reservationId: string | null
  resourceUserId: string
}) {
  'use step'

  await actUsageBudgetService.releaseReservation({
    reason: input.errorMessage,
    reservationId: input.reservationId,
    userId: input.billingUserId,
  }).catch((_error) => undefined)
  await agentRunService.fail({
    error: {
      code: 'workflow_failed',
      message: input.errorMessage,
      retryable: true,
    },
    errorText: `Work mode failed: ${input.errorMessage}`,
    runId: input.agentRunId,
    userId: input.resourceUserId,
  })
}

export type PersonalChatWorkMessages = ModelMessage[]
