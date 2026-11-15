import type { WorkflowAgentOnStepEndCallback } from '@ai-sdk/workflow'
import type { ToolSet } from 'ai'
import type { HarnessResponseFailure } from '@overlay/agent-runtime/harness-state'

export type HarnessModelObservation = {
  modelId: string
  provider: string
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  generationId?: string
  responseFailure?: HarnessResponseFailure
}

export function harnessModelResponseFailure(
  step: Pick<Parameters<WorkflowAgentOnStepEndCallback<ToolSet>>[0], 'finishReason' | 'text' | 'toolCalls'>,
): HarnessResponseFailure | undefined {
  if (step.finishReason === 'error') return 'provider_error'
  if (step.finishReason === 'other') return 'provider_other'
  if (step.finishReason === 'stop' && !step.text.trim() && !step.toolCalls.length) return 'empty_response'
}

function tokenCount(value: number | undefined, required = false): number | null {
  if (value === undefined && !required) return 0
  return Number.isSafeInteger(value) && value! >= 0 ? value! : null
}

const NO_USAGE = { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }

// A provider that ends a call without valid token counts (commonly a dropped
// stream) is recorded as zero usage, so the call settles and the run can retry
// or continue instead of stopping with an open dispatch.
function reportedUsage(usage: Parameters<WorkflowAgentOnStepEndCallback<ToolSet>>[0]['usage']): typeof NO_USAGE {
  const counts = {
    inputTokens: tokenCount(usage.inputTokens, true),
    outputTokens: tokenCount(usage.outputTokens, true),
    reasoningTokens: tokenCount(usage.outputTokenDetails.reasoningTokens),
    cacheReadTokens: tokenCount(usage.inputTokenDetails.cacheReadTokens),
    cacheWriteTokens: tokenCount(usage.inputTokenDetails.cacheWriteTokens),
  }
  const { inputTokens, outputTokens, reasoningTokens, cacheReadTokens, cacheWriteTokens } = counts
  if (inputTokens === null || outputTokens === null || reasoningTokens === null || cacheReadTokens === null
    || cacheWriteTokens === null || cacheReadTokens + cacheWriteTokens > inputTokens) return NO_USAGE
  return { inputTokens, outputTokens, reasoningTokens, cacheReadTokens, cacheWriteTokens }
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
  const gateway = step.providerMetadata?.gateway as { routing?: { canonicalSlug?: unknown; finalProvider?: unknown }; generationId?: unknown } | undefined
  const routing = gateway?.routing
  const modelId = identity(routing?.canonicalSlug) ?? identity(requestedModelId)
  if (!modelId) throw new Error('Missing model identity.')
  const generationId = identity(gateway?.generationId)
  const responseFailure = harnessModelResponseFailure(step)
  return {
    modelId,
    provider: identity(routing?.finalProvider) ?? 'unreported',
    ...reportedUsage(step.usage),
    ...(generationId ? { generationId } : {}),
    ...(responseFailure ? { responseFailure } : {}),
  }
}

export function harnessCostMicros(dollars: number): number {
  const micros = Math.ceil(dollars * 1_000_000)
  if (!Number.isFinite(dollars) || dollars < 0 || !Number.isSafeInteger(micros)) throw new Error('Invalid provider cost.')
  return micros
}
