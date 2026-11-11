import type { StepResult, ToolSet } from 'ai'
import { normalizeAgentAssistantText } from '@/shared/chat/agent-assistant-text'
import { keepCutOffTrailingWhitespace } from '@/shared/chat/step-text-join'
import { resolveToolOutcomes, type ResolvedToolOutcome } from './tool-outcomes'
import { summarizeToolResultForTranscript } from '@/shared/tools/tool-result-summary'
import {
  GENERATED_UI_DATA_TYPE,
  GENERATED_UI_TOOL_IDS,
  buildGeneratedUiPart,
  generatedUiDataToPlainText,
  normalizeGeneratedUiData,
} from '@overlay/chat-core/generated-ui'
import { collectWebSourcesFromSingleBlock } from '@overlay/chat-core/sources'
import type { WebSourceItem } from '@overlay/chat-core/types'
import { clampNestingDepth, compactToolValueForPersistence, truncateForPersistence } from './persist-values'
import { compactPullRequestToolValues } from './persist-pull-request-tool'

/** Persisted when the model produced no text/tool transcript so reload never drops the assistant row. */
export const ASSISTANT_EMPTY_CONTENT_PLACEHOLDER = '[Empty response]'

export function ensureAssistantPersistContent(content: string): string {
  return content.trim() ? content : ASSISTANT_EMPTY_CONTENT_PLACEHOLDER
}

export const MAX_PERSISTED_ASSISTANT_CONTENT_CHARS = 160_000
const MAX_PERSISTED_TEXT_PART_CHARS = 80_000
const MAX_PERSISTED_REASONING_PART_CHARS = 24_000
const MAX_PERSISTED_PART_TEXT_TOTAL_CHARS = 180_000
const MAX_PERSISTED_ASSISTANT_PARTS = 80
const MAX_PERSISTED_WEB_SOURCES = 24
const WEB_SOURCE_TOOL_NAMES = new Set([
  'perplexity_search',
  'parallel_search',
  'web_search',
  'deep_search',
  'web_fetch',
])

function compactWebSourcesForPersistence(
  toolName: string,
  toolOutput: unknown,
): WebSourceItem[] {
  if (!WEB_SOURCE_TOOL_NAMES.has(toolName)) return []
  return collectWebSourcesFromSingleBlock({
    kind: 'tool',
    key: 'persisted-web-sources',
    name: toolName,
    state: 'output-available',
    toolOutput,
  })
    .slice(0, MAX_PERSISTED_WEB_SOURCES)
    .map((source) => ({
      url: source.url,
      title: truncateForPersistence(source.title, 180),
      origin: source.origin,
      ...(source.snippet
        ? { snippet: truncateForPersistence(source.snippet, 240) }
        : {}),
    }))
}

function attachWebSourcesToToolOutput(
  compactedOutput: unknown,
  sources: WebSourceItem[],
): unknown {
  if (sources.length === 0) return compactedOutput
  if (
    compactedOutput !== null &&
    typeof compactedOutput === 'object' &&
    !Array.isArray(compactedOutput)
  ) {
    return {
      ...(compactedOutput as Record<string, unknown>),
      sources,
    }
  }
  return {
    result: compactedOutput,
    sources,
  }
}

/** Rewrites each text block where it stands, so text stays in order with the tools around it. */
export function mapAssistantTextForPersistence(
  persistence: { content: string; parts: Array<Record<string, unknown>> },
  transform: (text: string) => string,
): { content: string; parts: Array<Record<string, unknown>> } {
  return {
    content: ensureAssistantPersistContent(normalizeAgentAssistantText(transform(persistence.content))),
    parts: persistence.parts.map((part) => part.type === 'text' && typeof part.text === 'string'
      ? { ...part, text: normalizeAgentAssistantText(transform(part.text)) }
      : part),
  }
}

export function isAssistantStorageOmission(part: Record<string, unknown>): boolean {
  return part.type === 'text' && typeof part.storageOmittedParts === 'number'
    && Number.isSafeInteger(part.storageOmittedParts) && part.storageOmittedParts > 0
}

function selectAssistantPartsForPersistence(input: Array<Record<string, unknown>>) {
  let previousOmissions = 0
  const candidates = input.filter(part => {
    if (!isAssistantStorageOmission(part)) return true
    previousOmissions = Math.min(Number.MAX_SAFE_INTEGER, previousOmissions + Number(part.storageOmittedParts))
    return false
  })
  const answer = candidates.findLast(part => part.type === 'text' && typeof part.text === 'string' && part.text.trim().length > 0)
  let selected = candidates.slice(-MAX_PERSISTED_ASSISTANT_PARTS)
  if (answer && !selected.includes(answer)) {
    selected = [answer, ...selected.slice(1)]
  }
  return { candidates, selected, answer, previousOmissions }
}

type AssistantPartCompaction = {
  part: Record<string, unknown> | null
  consumedTextChars: number
}

function compactAssistantPartForPersistence(
  part: Record<string, unknown>,
  remainingTextChars: number,
  answer: Record<string, unknown> | undefined,
  answerChars: number,
): AssistantPartCompaction {
  if (part.type === 'text') {
    const text = typeof part.text === 'string' ? part.text : ''
    const max = part === answer ? answerChars : Math.min(MAX_PERSISTED_TEXT_PART_CHARS, Math.max(0, remainingTextChars))
    if (!max) return { part: null, consumedTextChars: 0 }
    return {
      part: { ...part, text: truncateForPersistence(text, max) },
      consumedTextChars: part === answer ? 0 : Math.min(text.length, max),
    }
  }

  if (part.type === 'reasoning') {
    const text = typeof part.text === 'string' ? part.text : ''
    const max = Math.min(MAX_PERSISTED_REASONING_PART_CHARS, Math.max(0, remainingTextChars))
    if (!max) return { part: null, consumedTextChars: 0 }
    return {
      part: { ...part, text: truncateForPersistence(text, max), state: part.state ?? 'done' },
      consumedTextChars: Math.min(text.length, max),
    }
  }

  if (part.type === 'tool-invocation') {
    const invocation = part.toolInvocation && typeof part.toolInvocation === 'object'
      ? part.toolInvocation as Record<string, unknown>
      : {}
    const toolName = typeof invocation.toolName === 'string' ? invocation.toolName : ''
    const pullRequestValues = compactPullRequestToolValues(invocation)
    const webSources = compactWebSourcesForPersistence(toolName, invocation.toolOutput)
    const compactedToolOutput = compactToolValueForPersistence(pullRequestValues?.toolOutput ?? invocation.toolOutput)
    return {
      part: {
        ...part,
        toolInvocation: {
          ...invocation,
          toolInput: compactToolValueForPersistence(pullRequestValues?.toolInput ?? invocation.toolInput),
          toolOutput: attachWebSourcesToToolOutput(compactedToolOutput, webSources),
        },
      },
      consumedTextChars: 0,
    }
  }

  if (part.type === 'data' && part.dataType === GENERATED_UI_DATA_TYPE) {
    const normalized = normalizeGeneratedUiData(part.data)
    const id = typeof part.id === 'string' && part.id.trim() ? part.id.trim() : ''
    return {
      part: normalized && id
        ? {
          type: 'data',
          id,
          dataType: GENERATED_UI_DATA_TYPE,
          data: normalized,
          ...(part.transient === true ? { transient: true } : {}),
        }
        : null,
      consumedTextChars: 0,
    }
  }

  return { part: clampNestingDepth(part) as Record<string, unknown>, consumedTextChars: 0 }
}

export function compactAssistantPersistenceForConvex(input: {
  content: string
  parts: Array<Record<string, unknown>>
}): { content: string; parts: Array<Record<string, unknown>> } {
  const omittedPrefix = '[Earlier response text omitted for storage]\n\n'
  const content = input.content.length > MAX_PERSISTED_ASSISTANT_CONTENT_CHARS
    ? `${omittedPrefix}${input.content.slice(-(MAX_PERSISTED_ASSISTANT_CONTENT_CHARS - omittedPrefix.length))}`
    : input.content
  const { candidates, selected, answer, previousOmissions } = selectAssistantPartsForPersistence(input.parts)
  // The answer may span several model calls joined into one text part, so it can use
  // the whole part-text budget; other text parts keep the per-part cap.
  const answerChars = answer ? Math.min(MAX_PERSISTED_PART_TEXT_TOTAL_CHARS, String(answer.text).length) : 0
  const parts: Array<Record<string, unknown>> = []
  let remainingPartTextChars = MAX_PERSISTED_PART_TEXT_TOTAL_CHARS - answerChars

  for (const part of selected) {
    const compacted = compactAssistantPartForPersistence(part, remainingPartTextChars, answer, answerChars)
    if (compacted.part) parts.push(compacted.part)
    remainingPartTextChars -= compacted.consumedTextChars
  }

  const omittedParts = Math.min(Number.MAX_SAFE_INTEGER, previousOmissions + candidates.length - parts.length)
  if (omittedParts > 0) {
    const omissionId = input.parts.find(isAssistantStorageOmission)?.id
    parts.unshift({
      type: 'text',
      ...(typeof omissionId === 'string' && omissionId ? { id: omissionId } : {}),
      text: `[${omittedParts} additional assistant parts omitted for storage]`,
      storageOmittedParts: omittedParts,
    })
  }

  return {
    content,
    parts: parts.length > 0 ? parts : [{ type: 'text', text: content }],
  }
}

type PersistedToolCall = {
  toolCallId: string
  toolName: string
  input?: unknown
  providerExecuted?: boolean
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : null
}

function persistedToolCall(value: unknown): PersistedToolCall | null {
  const record = asRecord(value)
  if (!record || typeof record.toolCallId !== 'string' || typeof record.toolName !== 'string') return null
  return {
    toolCallId: record.toolCallId,
    toolName: record.toolName,
    ...(Object.prototype.hasOwnProperty.call(record, 'input') ? { input: record.input } : {}),
    ...(record.providerExecuted === true ? { providerExecuted: true } : {}),
  }
}

function mergePersistedToolCall(
  current: PersistedToolCall | undefined,
  next: PersistedToolCall,
): PersistedToolCall {
  if (!current) return next
  return {
    ...current,
    ...next,
    ...(next.input === undefined && current.input !== undefined ? { input: current.input } : {}),
    ...(current.providerExecuted || next.providerExecuted ? { providerExecuted: true } : {}),
  }
}

function toolCallFromPart(value: unknown): PersistedToolCall | null {
  const record = asRecord(value)
  if (!record) return null
  if (record.type === 'tool-approval-request' || record.type === 'tool-approval-response') {
    return persistedToolCall(record.toolCall)
  }
  if (record.type === 'tool-call' || record.type === 'tool-error' || record.type === 'tool-result') {
    return persistedToolCall(record)
  }
  return null
}

function toolCallsForStep(step: StepResult<ToolSet>): PersistedToolCall[] {
  const content = step.content ?? []
  const calls = content.length
    ? content.map(toolCallFromPart).filter((call): call is PersistedToolCall => Boolean(call))
    : (step.toolCalls ?? []).map(persistedToolCall).filter((call): call is PersistedToolCall => Boolean(call))
  const seen = new Set<string>()
  return calls.filter((call) => {
    if (seen.has(call.toolCallId)) return false
    seen.add(call.toolCallId)
    return true
  })
}

function orderedContentForStep<TOOLS extends ToolSet>(
  step: StepResult<TOOLS>,
): readonly Record<string, unknown>[] {
  let reasoningText = ''
  if (step.reasoningText?.trim()) {
    reasoningText = step.reasoningText.trim()
  } else if (step.reasoning?.length) {
    reasoningText = step.reasoning
      .map((r) => (r && typeof r === 'object' && 'text' in r ? String((r as { text?: string }).text ?? '') : ''))
      .map((s) => s.trim())
      .filter(Boolean)
      .join('\n\n')
  }
  return step.content?.length ? step.content as readonly Record<string, unknown>[] : [
    ...(reasoningText ? [{ type: 'reasoning' as const, text: reasoningText }] : []),
    ...(step.toolCalls ?? []).map((call) => ({ ...call, type: 'tool-call' as const })),
    ...(step.text?.trim() ? [{ type: 'text' as const, text: step.text }] : []),
  ]
}

function toolOutputForOutcome(outcome: ResolvedToolOutcome | undefined): unknown {
  return outcome?.hasOutput ? outcome.output : undefined
}

function toolInvocationForPersistence(
  call: PersistedToolCall,
  outcome: ResolvedToolOutcome | undefined,
  fullValues: boolean,
): Record<string, unknown> {
  const state = outcome?.state === 'output-available'
    || outcome?.state === 'output-error'
    || outcome?.state === 'output-denied'
    ? outcome.state
    : 'input-available'
  return {
    toolCallId: call.toolCallId,
    toolName: call.toolName,
    state,
    toolInput: fullValues ? call.input : clampNestingDepth(call.input),
    toolOutput: fullValues ? toolOutputForOutcome(outcome) : clampNestingDepth(toolOutputForOutcome(outcome)),
    ...(call.providerExecuted ? { providerExecuted: true } : {}),
    ...(outcome?.approvalId ? { approvalId: outcome.approvalId } : {}),
    ...(outcome?.approvalStatus ? { approvalStatus: outcome.approvalStatus } : {}),
    ...(outcome?.approvalReason ? { approvalReason: outcome.approvalReason } : {}),
  }
}

/**
 * Persist multi-step assistant turns: `onFinish`'s top-level `text` is only the **last** step,
 * so we merge every step's text and synthesize legacy `tool-invocation` parts for the transcript UI.
 */
export function buildAssistantPersistenceFromSteps<TOOLS extends ToolSet>(
  steps: StepResult<TOOLS>[] | undefined,
  fallbackText: string,
  options: { fullValues?: boolean } = {},
): { content: string; parts: Array<Record<string, unknown>> } {
  const list = steps ?? []
  const textSegments: string[] = []
  const synthesizedToolSegments: string[] = []
  const generatedUiTextSegments: string[] = []
  const toolOutcomes = resolveToolOutcomes(list, options)
  const canonicalToolCalls = new Map<string, PersistedToolCall>()
  for (const step of list) {
    for (const part of orderedContentForStep(step)) {
      const call = toolCallFromPart(part)
      if (!call) continue
      canonicalToolCalls.set(
        call.toolCallId,
        mergePersistedToolCall(canonicalToolCalls.get(call.toolCallId), call),
      )
    }
  }

  // A call cut off by its output-token cap is continued by the next call's text.
  let textContinues = false
  for (const step of list) {
    const trimmedText = step.text?.trim()
    if (trimmedText) {
      const normalized = normalizeAgentAssistantText(trimmedText)
      const text = step.finishReason === 'length' ? keepCutOffTrailingWhitespace(step.text, normalized) : normalized
      if (textContinues && textSegments.length) textSegments[textSegments.length - 1] += text
      else textSegments.push(text)
    }
    if (trimmedText || toolCallsForStep(step).length) {
      textContinues = step.finishReason === 'length' && !toolCallsForStep(step).length
    }
    for (const tc of toolCallsForStep(step)) {
      const outcome = toolOutcomes.get(tc.toolCallId)
      const toolOutput = toolOutputForOutcome(outcome)
      if (GENERATED_UI_TOOL_IDS.has(tc.toolName)) {
        const output = toolOutput && typeof toolOutput === 'object'
          ? toolOutput as Record<string, unknown>
          : null
        const data = output?.success === true ? normalizeGeneratedUiData(output.generatedUi) : null
        if (data) generatedUiTextSegments.push(generatedUiDataToPlainText(data))
        continue
      }
      const summary = summarizeToolResultForTranscript({
        toolName: tc.toolName,
        toolInput: tc.input,
        toolOutput,
        state: outcome?.state ?? 'input-available',
      })
      if (summary) synthesizedToolSegments.push(summary)
    }
  }
  const fallback = normalizeAgentAssistantText(fallbackText.trim())
  let content = textSegments.join('\n\n') || generatedUiTextSegments.join('\n\n') || synthesizedToolSegments.join('\n\n') || fallback
  content = ensureAssistantPersistContent(content)

  const parts: Array<Record<string, unknown>> = []
  const renderedToolCallIds = new Map<string, number>()
  let partsContinue = false
  for (const step of list) {
    const stepContent = orderedContentForStep(step)
    const lastTextIndex = stepContent.findLastIndex(part => part.type === 'text')
    const cutOff = step.finishReason === 'length'
    let continues = partsContinue
    // SDK content preserves generation order; the convenience fields group by type.
    for (const [index, tc] of stepContent.entries()) {
      if (tc.type === 'text' || tc.type === 'reasoning') {
        if (typeof tc.text === 'string' && tc.text.trim()) {
          const trimmed = tc.text.trim()
          const normalized = normalizeAgentAssistantText(trimmed)
          const text = cutOff && index === lastTextIndex ? keepCutOffTrailingWhitespace(tc.text, normalized) : normalized
          const previous = parts.at(-1)
          if (tc.type === 'text' && continues && previous?.type === 'text' && typeof previous.text === 'string') {
            parts[parts.length - 1] = { ...previous, text: `${previous.text}${text}` }
          } else {
            parts.push({
              type: tc.type,
              text,
              ...(tc.type === 'reasoning' ? { state: 'done' } : {}),
            })
          }
          if (tc.type === 'text') continues = false
        }
        continue
      }
      continues = false
      const sourceCall = toolCallFromPart(tc)
      if (!sourceCall) continue
      const call = canonicalToolCalls.get(sourceCall.toolCallId) ?? sourceCall
      const outcome = toolOutcomes.get(call.toolCallId)
      const toolOutput = toolOutputForOutcome(outcome)
      const existingIndex = renderedToolCallIds.get(call.toolCallId)
      if (GENERATED_UI_TOOL_IDS.has(call.toolName)) {
        const output = toolOutput && typeof toolOutput === 'object'
          ? toolOutput as Record<string, unknown>
          : null
        const part = outcome?.state === 'output-available' && output?.success === true
          ? buildGeneratedUiPart(
              call.toolName === 'render_ui'
                ? call.toolCallId
                : (typeof output.id === 'string' && output.id.trim()) || call.toolCallId,
              output.generatedUi,
            )
          : null
        if (part) {
          if (existingIndex === undefined) {
            renderedToolCallIds.set(call.toolCallId, parts.length)
            parts.push(part)
          } else {
            parts[existingIndex] = part
          }
          continue
        }
      }
      const toolPart = {
        type: 'tool-invocation',
        toolInvocation: toolInvocationForPersistence(call, outcome, options.fullValues === true),
      }
      if (existingIndex === undefined) {
        renderedToolCallIds.set(call.toolCallId, parts.length)
        parts.push(toolPart)
      } else {
        parts[existingIndex] = toolPart
      }
    }
    const publicOutput = stepContent.some(part => part.type !== 'reasoning')
    if (publicOutput) partsContinue = cutOff && lastTextIndex >= 0 && !toolCallsForStep(step).length
  }
  if (!parts.some((part) => part.type === 'text') && content) {
    parts.push({ type: 'text', text: content })
  }
  if (parts.length === 0) {
    parts.push({ type: 'text', text: content })
  }

  // Fix word-split artifact: some reasoning models emit the first word(s) of the
  // response as thinking tokens (e.g. reasoningText="I don", text="'t have...").
  // Detect when a text part starts with an apostrophe continuation and move the
  // trailing word from the preceding reasoning part into the text part.
  for (let i = 0; i < parts.length - 1; i++) {
    const rPart = parts[i]
    const tPart = parts[i + 1]
    if (
      rPart?.type === 'reasoning' &&
      tPart?.type === 'text' &&
      typeof rPart.text === 'string' &&
      typeof tPart.text === 'string' &&
      /^'[a-zA-Z]/.test(tPart.text as string)
    ) {
      const rText = rPart.text as string
      const tText = tPart.text as string
      const lastWordMatch = rText.match(/(\S+)$/)
      if (lastWordMatch) {
        const word = lastWordMatch[1]!
        rPart.text = rText.slice(0, rText.length - word.length).trim()
        tPart.text = word + tText
      }
    }
  }

  return { content, parts }
}
