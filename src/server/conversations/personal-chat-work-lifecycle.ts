import 'server-only'

import type { ModelMessage, StepResult, ToolSet } from 'ai'
import type { SourceCitationMap } from '@/shared/knowledge/ask-knowledge-types'
import type { AgentRunApproval } from '@/shared/agents/agent-run'
import {
  calculateProviderCostMicros,
  observeWorkflowRunMetrics,
  summarizeAgentToolMetrics,
} from '@/server/conversations/agent-run-metrics'
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

/**
 * Publishes the text produced so far into the run's assistant row.
 *
 * A Work turn's live text reaches the client through the workflow's own output
 * stream, which nobody but the holder of that connection can read. Without this
 * a reload mid-turn shows an empty bubble until the whole turn lands. Called at
 * model-step boundaries, which is the coarsest-grained hook the agent loop
 * offers but the only one that is deterministic enough to be a step.
 */
export async function persistPersonalChatWorkProgress(input: {
  agentRunId: string
  content: string
  resourceUserId: string
}) {
  'use step'
  if (!input.content) return
  await agentRunService.recordProgress({
    content: input.content,
    runId: input.agentRunId,
    userId: input.resourceUserId,
  }).catch((_error) => undefined)
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
  multiModelSlotIndex?: number
  multiModelTotal?: number
  paid: boolean
  reservationId: string | null
  resourceUserId: string
  sourceCitations?: SourceCitationMap
  turnId: string
  workflowRunId: string
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
  const [providerCostMicros, workflowMetrics] = await Promise.all([
    calculateProviderCostMicros({ inputTokens, modelId: input.modelId, outputTokens }),
    observeWorkflowRunMetrics(input.workflowRunId).catch((_error) => ({})),
  ])
  await actMessagePersistenceService.persistAssistantFinish({
    agentRunId: input.agentRunId,
    agentRunMetrics: {
      inputTokens,
      outputTokens,
      providerCostMicros,
      ...summarizeAgentToolMetrics(input.event.steps),
      ...workflowMetrics,
    },
    attemptModelId: input.modelId,
    conversationId: input.conversationId as never,
    emitWebhook: input.emitWebhook,
    event: input.event,
    finishedToolCallIds,
    multiModelSlotIndex: input.multiModelSlotIndex ?? 0,
    multiModelTotal: input.multiModelTotal ?? 1,
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
  modelId: string
  reservationId: string | null
  resourceUserId: string
  steps: StepResult<ToolSet>[]
  workflowRunId: string
}) {
  'use step'

  await actUsageBudgetService.releaseReservation({
    reason: input.errorMessage,
    reservationId: input.reservationId,
    userId: input.billingUserId,
  }).catch((_error) => undefined)
  const usage = input.steps.reduce((total, step) => ({
    inputTokens: total.inputTokens + (step.usage?.inputTokens ?? 0),
    outputTokens: total.outputTokens + (step.usage?.outputTokens ?? 0),
  }), { inputTokens: 0, outputTokens: 0 })
  const [providerCostMicros, workflowMetrics] = await Promise.all([
    calculateProviderCostMicros({ ...usage, modelId: input.modelId }),
    observeWorkflowRunMetrics(input.workflowRunId).catch((_error) => ({})),
  ])
  await agentRunService.fail({
    error: {
      code: 'workflow_failed',
      message: input.errorMessage,
      retryable: true,
    },
    errorText: `Work mode failed: ${input.errorMessage}`,
    runId: input.agentRunId,
    userId: input.resourceUserId,
    metrics: {
      ...usage,
      providerCostMicros,
      ...summarizeAgentToolMetrics(input.steps),
      ...workflowMetrics,
    },
  })
}

export type PersonalChatWorkMessages = ModelMessage[]
