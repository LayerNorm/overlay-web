import 'server-only'

import { logger } from '@/server/observability/logger'
import type { UIMessage } from 'ai'
import { getGatewayCatalogModel } from '@/server/ai/gateway/gateway-catalog'
import {
  FREE_TIER_DEFAULT_MODEL_ID,
  isFreeTierChatModelId,
} from '@/shared/ai/gateway/model-types'
import { summarizeErrorForLog } from '@/shared/security/safe-log'
import {
  BASE_SYSTEM_TOOL_OVERHEAD_TOKENS,
  CONTEXT_TARGET_RATIO,
  CONTEXT_TRIGGER_RATIO,
  FALLBACK_CONTEXT_WINDOW,
  MAX_SUMMARY_OUTPUT_TOKENS,
  MIN_SUMMARY_OUTPUT_TOKENS,
  PRESERVED_RECENT_MESSAGES,
  buildSummaryPrompt,
  estimateContextTokens,
} from './context-compaction-core'

export { compactHarnessPrompt, estimateContextTokens } from './context-compaction-core'
export type { HarnessPromptCompaction } from './context-compaction-core'

export type ContextSummarySnapshot = {
  summary: string
  summarizedThroughMessageId?: string
  summarizedThroughCreatedAt?: number
}

export type ContextSummaryToPersist = {
  summary: string
  summarizedThroughMessageId?: string
  summarizedThroughCreatedAt?: number
  sourceMessageCount: number
  sourceEstimatedTokens: number
  summaryEstimatedTokens: number
  contextWindow: number
  targetModelId: string
  summarizerModelId: string
}

export type ContextCompactionResult = {
  messages: UIMessage[]
  contextWindow: number
  originalEstimatedTokens: number
  finalEstimatedTokens: number
  triggerTokens: number
  targetTokens: number
  didCompact: boolean
  usedFallbackTrim: boolean
  summaryToPersist?: ContextSummaryToPersist
}

function manualContextWindow(modelId: string): number | null {
  if (isFreeTierChatModelId(modelId)) return FALLBACK_CONTEXT_WINDOW
  return null
}

export async function resolveModelContextWindow(modelId: string): Promise<number> {
  const model = await getGatewayCatalogModel(modelId).catch((_error) => null)
  if (model?.contextWindow && model.contextWindow > 0) return Math.floor(model.contextWindow)

  return manualContextWindow(modelId) ?? FALLBACK_CONTEXT_WINDOW
}

export function contextSummaryScope(params: {
  targetModelId: string
  historyBaseModelId?: string
}): string {
  return `model:${params.historyBaseModelId?.trim() || params.targetModelId.trim() || 'default'}`
}

function deterministicTrimToTokenBudget(messages: UIMessage[], maxTokens: number): UIMessage[] {
  let remaining = Math.max(1, Math.floor(maxTokens))
  const kept: UIMessage[] = []
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (!message) continue
    const cost = Math.max(1, estimateContextTokens(message))
    const isLatest = index === messages.length - 1
    if (!isLatest && kept.length > 0 && remaining - cost < 0) break
    kept.push(message)
    remaining -= cost
  }
  return kept.reverse()
}

function summarySystemMessage(summary: string): UIMessage {
  return {
    id: 'context-summary',
    role: 'system',
    parts: [{
      type: 'text',
      text: `Earlier conversation summary for continuity. This summary is generated from older visible chat turns and is hidden from the UI:\n\n${summary}`,
    }],
  }
}

export async function compactMessagesForContext(params: {
  messages: UIMessage[]
  targetModelId: string
  accessToken?: string
  previousSummary?: ContextSummarySnapshot | null
  contextWindowOverride?: number
  generateSummaryText?: (args: {
    prompt: string
    targetSummaryTokens: number
  }) => Promise<string>
}): Promise<ContextCompactionResult> {
  const contextWindow =
    typeof params.contextWindowOverride === 'number' && params.contextWindowOverride > 0
      ? Math.floor(params.contextWindowOverride)
      : await resolveModelContextWindow(params.targetModelId)
  const outputReserveTokens = Math.min(8_192, Math.max(1_024, Math.floor(contextWindow * 0.15)))
  const usablePromptTokens = Math.max(1, contextWindow - outputReserveTokens)
  const triggerTokens = Math.floor(usablePromptTokens * CONTEXT_TRIGGER_RATIO)
  const targetTokens = Math.floor(usablePromptTokens * CONTEXT_TARGET_RATIO)
  const originalEstimatedTokens = estimateContextTokens(params.messages) + BASE_SYSTEM_TOOL_OVERHEAD_TOKENS

  if (originalEstimatedTokens < triggerTokens) {
    return {
      messages: params.messages,
      contextWindow,
      originalEstimatedTokens,
      finalEstimatedTokens: originalEstimatedTokens,
      triggerTokens,
      targetTokens,
      didCompact: false,
      usedFallbackTrim: false,
    }
  }

  const preserved = params.messages.slice(-PRESERVED_RECENT_MESSAGES)
  const candidates = params.messages.slice(0, Math.max(0, params.messages.length - PRESERVED_RECENT_MESSAGES))
  if (candidates.length === 0) {
    const fallback = deterministicTrimToTokenBudget(params.messages, triggerTokens)
    return {
      messages: fallback,
      contextWindow,
      originalEstimatedTokens,
      finalEstimatedTokens: estimateContextTokens(fallback) + BASE_SYSTEM_TOOL_OVERHEAD_TOKENS,
      triggerTokens,
      targetTokens,
      didCompact: false,
      usedFallbackTrim: true,
    }
  }

  const previous = params.previousSummary?.summary?.trim() ? params.previousSummary : null
  const coveredIndex =
    previous?.summarizedThroughMessageId
      ? candidates.findIndex((message) => message.id === previous.summarizedThroughMessageId)
      : -1
  const messagesToSummarize = previous && coveredIndex >= 0
    ? candidates.slice(coveredIndex + 1)
    : candidates
  const preservedTokens = estimateContextTokens(preserved)
  const targetSummaryTokens = Math.max(
    MIN_SUMMARY_OUTPUT_TOKENS,
    Math.min(MAX_SUMMARY_OUTPUT_TOKENS, targetTokens - preservedTokens - 256),
  )

  try {
    const prompt = buildSummaryPrompt({
      previousSummary: previous?.summary,
      messagesToSummarize,
      targetSummaryTokens,
    })
    const summary = params.generateSummaryText
      ? (await params.generateSummaryText({ prompt, targetSummaryTokens })).trim()
      : (await (async () => {
          const [{ getLanguageModel }, { generateText }] = await Promise.all([
            import('@/server/ai/model-runtime'),
            import('@/server/ai/sdk'),
          ])
          const model = await getLanguageModel(FREE_TIER_DEFAULT_MODEL_ID, params.accessToken)
          const result = await generateText({
            model,
            temperature: 0.1,
            maxOutputTokens: targetSummaryTokens,
            prompt,
          })
          return result.text.trim()
        })())
    if (!summary) throw new Error('empty_context_summary')

    let summaryForContext = summary
    let compacted = [summarySystemMessage(summaryForContext), ...preserved]
    let finalEstimatedTokens = estimateContextTokens(compacted) + BASE_SYSTEM_TOOL_OVERHEAD_TOKENS
    if (finalEstimatedTokens > triggerTokens) {
      const summaryBudgetChars = Math.max(
        4_000,
        Math.floor(Math.max(1, targetTokens - preservedTokens - 256) * 4),
      )
      summaryForContext =
        summary.length > summaryBudgetChars
          ? `${summary.slice(0, summaryBudgetChars).trimEnd()}\n\n[summary truncated to fit context budget]`
          : summary
      compacted = [summarySystemMessage(summaryForContext), ...preserved]
      finalEstimatedTokens = estimateContextTokens(compacted) + BASE_SYSTEM_TOOL_OVERHEAD_TOKENS
    }

    const summarizedThrough = candidates[candidates.length - 1]
    return {
      messages: compacted,
      contextWindow,
      originalEstimatedTokens,
      finalEstimatedTokens,
      triggerTokens,
      targetTokens,
      didCompact: true,
      usedFallbackTrim: false,
      summaryToPersist: {
        summary: summaryForContext,
        summarizedThroughMessageId: summarizedThrough?.id,
        sourceMessageCount: candidates.length,
        sourceEstimatedTokens: estimateContextTokens(candidates),
        summaryEstimatedTokens: estimateContextTokens(summaryForContext),
        contextWindow,
        targetModelId: params.targetModelId,
        summarizerModelId: FREE_TIER_DEFAULT_MODEL_ID,
      },
    }
  } catch (error) {
    logger.warn('[context-compaction] summarization failed; falling back to deterministic trim', {
      targetModelId: params.targetModelId,
      error: summarizeErrorForLog(error),
    })
    const fallback = deterministicTrimToTokenBudget(params.messages, triggerTokens)
    return {
      messages: fallback,
      contextWindow,
      originalEstimatedTokens,
      finalEstimatedTokens: estimateContextTokens(fallback) + BASE_SYSTEM_TOOL_OVERHEAD_TOKENS,
      triggerTokens,
      targetTokens,
      didCompact: false,
      usedFallbackTrim: true,
    }
  }
}
