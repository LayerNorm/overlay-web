import type { StepResult, ToolSet } from 'ai'
import type { HarnessExecutionResult } from './runner'
import { isPersonalChatWorkToolOutputEnvelope } from '@/shared/agents/personal-chat-work'
import {
  buildAssistantPersistenceFromSteps, mapAssistantTextForPersistence,
} from '@/shared/chat/persist-assistant-turn'
import { linkifySourceCitationsMarkdown } from '@/shared/knowledge/source-citations'
import type { SourceCitationMap } from '@/shared/knowledge/ask-knowledge-types'
import { HARNESS_CONTROL_TOOLS } from './context'
import { stripTextualToolCalls } from './textual-tool-calls'
import { compactHarnessTranscriptPersistence } from './harness-transcript'
import type { HarnessTranscriptPersistence, HarnessTranscriptStep } from '@overlay/agent-runtime/harness-store'

export function buildPersonalHarnessDelivery(
  result: HarnessExecutionResult,
  sourceCitations?: SourceCitationMap,
  activeToolNames: ReadonlySet<string> = new Set(),
  settledTranscript?: {
    persistence: HarnessTranscriptPersistence
    steps: HarnessTranscriptStep[]
    newestSequence?: number | null
  },
) {
  const toolNames = new Set([...HARNESS_CONTROL_TOOLS, ...activeToolNames])
  const sanitize = (text: string) => stripTextualToolCalls(text, toolNames)
  const controls = new Set<string>(HARNESS_CONTROL_TOOLS)
  const isPublic = (part: { type: string; toolName?: string }) => !part.toolName || !controls.has(part.toolName)
  const displayResult = <T extends { type: string }>(part: T): T => {
    if (part.type !== 'tool-result' || !('output' in part) || !isPersonalChatWorkToolOutputEnvelope(part.output)) return part
    return { ...part, output: part.output.display }
  }
  const steps: StepResult<ToolSet>[] = result.steps.map(step => ({
    ...step,
    ...(typeof step.text === 'string' ? { text: sanitize(step.text) } : {}),
    ...(typeof step.reasoningText === 'string' ? { reasoningText: sanitize(step.reasoningText) } : {}),
    ...(step.content ? { content: step.content.filter(isPublic).map(part => {
      const cleaned = (part.type === 'text' || part.type === 'reasoning') && typeof part.text === 'string'
        ? { ...part, text: sanitize(part.text) }
        : part
      return displayResult(cleaned)
    }) } : {}),
    ...(step.reasoning ? { reasoning: step.reasoning.map(part => (
      part && typeof part === 'object' && 'text' in part && typeof part.text === 'string'
        ? { ...part, text: sanitize(part.text) }
        : part
    )) } : {}),
    toolCalls: step.toolCalls.filter(isPublic),
    toolResults: step.toolResults.filter(isPublic).map(displayResult),
  }))
  const journalStepKeys = new Set(settledTranscript?.steps.map(step => (
    `${step.receiptId}\u0000${step.stepNumber}`
  )) ?? [])
  const liveSteps = steps.filter((step, index) => {
    const receiptId = result.stepReceiptIds?.[index]
    if (receiptId && journalStepKeys.has(`${receiptId}\u0000${step.stepNumber}`)) return false
    const sequence = receiptId ? /^model:(\d+)$/.exec(receiptId)?.[1] : undefined
    return !sequence || settledTranscript?.newestSequence == null
      || Number(sequence) > settledTranscript.newestSequence
  })
  const summary = [
    result.snapshot.resultSummary,
    ...liveSteps.slice().reverse().map(step => step.text),
  ].map(candidate => typeof candidate === 'string' ? sanitize(candidate) : '')
    .find(candidate => candidate.length > 0) ?? ''
  const liveTranscript = liveSteps.length
    ? buildAssistantPersistenceFromSteps(liveSteps, summary)
    : undefined
  let transcript = settledTranscript
    ? compactHarnessTranscriptPersistence({
      content: [settledTranscript.persistence.content, liveTranscript?.content]
        .filter((content): content is string => Boolean(content)).join('\n\n'),
      parts: [...settledTranscript.persistence.parts, ...(liveTranscript?.parts ?? [])],
    })
    : buildAssistantPersistenceFromSteps(steps, summary)
  const resultSummary = sanitize(result.snapshot.resultSummary ?? '')
  if (resultSummary && !transcript.content.includes(resultSummary)) {
    transcript = compactHarnessTranscriptPersistence({
      content: [transcript.content, resultSummary].filter(Boolean).join('\n\n'),
      parts: [...transcript.parts, { type: 'text', text: resultSummary }],
    })
  }
  if (sourceCitations && Object.keys(sourceCitations).length) {
    transcript = mapAssistantTextForPersistence(transcript, text => linkifySourceCitationsMarkdown(text, sourceCitations))
  }
  const persisted = compactHarnessTranscriptPersistence(transcript)
  return {
    ...persisted,
    diagnostic: result.snapshot.diagnostic,
    routedModelId: result.snapshot.latestReceipt?.modelId,
    tokens: { input: result.snapshot.usage.inputTokens, output: result.snapshot.usage.outputTokens },
    metrics: {
      inputTokens: result.snapshot.usage.inputTokens, outputTokens: result.snapshot.usage.outputTokens,
      // Receipts already separate externally funded BYOK inference.
      providerCostMicros: result.snapshot.usage.costMicros,
      toolCallCount: steps.reduce((count, step) => count + step.toolCalls.length, 0),
      toolSuccessCount: steps.reduce((count, step) => count + step.content.filter(part => part.type === 'tool-result').length, 0),
      toolFailureCount: steps.reduce((count, step) => count + step.content.filter(part => part.type === 'tool-error').length, 0),
    },
  }
}
