import type { WorkflowAgentOnStepEndCallback } from '@ai-sdk/workflow'
import type { ToolSet } from 'ai'
import type { HarnessResponseFailure } from '@overlay/agent-runtime/harness-state'
import { asRecord } from '@/shared/ai/gateway/overlay-free-policy'
import { isFreeTierChatModelId } from '@/shared/ai/gateway/model-types'

export type HarnessModelObservation = {
  modelId: string
  provider: string
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  generationId?: string
  freeCostVerified?: true
  responseFailure?: HarnessResponseFailure
}

export function harnessModelResponseFailure(
  step: Pick<Parameters<WorkflowAgentOnStepEndCallback<ToolSet>>[0], 'finishReason' | 'text' | 'toolCalls'>,
): HarnessResponseFailure | undefined {
  if (step.finishReason === 'error') return 'provider_error'
  if (step.finishReason === 'other') return 'provider_other'
  if (step.finishReason === 'stop' && !step.text.trim() && !step.toolCalls.length) return 'empty_response'
}

function tokenCount(value: number | undefined, required = false): number {
  if (value === undefined && !required) return 0
  if (!Number.isSafeInteger(value) || value! < 0) throw new Error('Provider token usage is missing or invalid; reconcile this call.')
  return value!
}

function identity(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() && value.length <= 256 ? value : undefined
}

// Allowlist before crossing a durable boundary. Provider metadata may contain
// secrets such as async-job webhook signing keys, not only usage information.
export function captureHarnessModelUsage(
  step: Parameters<WorkflowAgentOnStepEndCallback<ToolSet>>[0],
  requestedModelId: string,
): HarnessModelObservation {
  const gateway = asRecord(step.providerMetadata?.gateway)
  const routing = asRecord(gateway.routing)
  const free = isFreeTierChatModelId(requestedModelId)
  const freeReceipt = asRecord(step.providerMetadata?.overlayFree)
  const modelId = free ? requestedModelId : identity(routing.canonicalSlug) ?? identity(requestedModelId)
  if (!modelId) throw new Error('Missing model identity.')
  const inputTokens = tokenCount(step.usage.inputTokens, true)
  const cacheReadTokens = tokenCount(step.usage.inputTokenDetails.cacheReadTokens)
  const cacheWriteTokens = tokenCount(step.usage.inputTokenDetails.cacheWriteTokens)
  if (cacheReadTokens + cacheWriteTokens > inputTokens) throw new Error('Provider cache counts exceed its total input usage.')
  const generationId = identity(gateway.generationId)
  const responseFailure = harnessModelResponseFailure(step)
  return {
    modelId,
    provider: free ? 'overlay-free-router' : identity(routing.finalProvider) ?? 'unreported',
    inputTokens,
    outputTokens: tokenCount(step.usage.outputTokens, true),
    reasoningTokens: tokenCount(step.usage.outputTokenDetails.reasoningTokens),
    cacheReadTokens,
    cacheWriteTokens,
    ...(generationId ? { generationId } : {}),
    ...(free && freeReceipt.safe === true && freeReceipt.cost === 0 ? { freeCostVerified: true as const } : {}),
    ...(responseFailure ? { responseFailure } : {}),
  }
}

export function harnessCostMicros(dollars: number): number {
  const micros = Math.ceil(dollars * 1_000_000)
  if (!Number.isFinite(dollars) || dollars < 0 || !Number.isSafeInteger(micros)) throw new Error('Invalid provider cost.')
  return micros
}
