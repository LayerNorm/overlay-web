import type { StepResult, ToolSet } from 'ai'
import type { HarnessExecutionResult } from './runner'
import { isPersonalChatWorkToolOutputEnvelope } from '@/shared/agents/personal-chat-work'
import {
  buildAssistantPersistenceFromSteps, compactAssistantPersistenceForConvex, replaceAssistantTextForPersistence,
} from '@/shared/chat/persist-assistant-turn'
import { linkifySourceCitationsMarkdown } from '@/shared/knowledge/source-citations'
import type { SourceCitationMap } from '@/shared/knowledge/ask-knowledge-types'

export function buildPersonalHarnessDelivery(
  result: HarnessExecutionResult,
  sourceCitations?: SourceCitationMap,
  fallbackNotices: string[] = [],
) {
  const displayResult = <T extends { type: string }>(part: T): T => {
    if (part.type !== 'tool-result' || !('output' in part) || !isPersonalChatWorkToolOutputEnvelope(part.output)) return part
    return { ...part, output: part.output.display }
  }
  const steps: StepResult<ToolSet>[] = result.steps.map(step => ({
    ...step, content: step.content.map(displayResult), toolResults: step.toolResults.map(displayResult),
  }))
  let transcript = buildAssistantPersistenceFromSteps(steps, result.snapshot.resultSummary ?? result.snapshot.workingSummary)
  if (fallbackNotices.length) {
    transcript = replaceAssistantTextForPersistence(transcript, `${fallbackNotices.join('\n\n')}\n\n${transcript.content}`)
  }
  if (sourceCitations && Object.keys(sourceCitations).length) {
    transcript = replaceAssistantTextForPersistence(transcript, linkifySourceCitationsMarkdown(transcript.content, sourceCitations))
  }
  const persisted = compactAssistantPersistenceForConvex(transcript)
  return {
    ...persisted,
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
