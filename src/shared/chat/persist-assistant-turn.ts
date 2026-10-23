import type { StepResult, ToolSet } from 'ai'
import { normalizeAgentAssistantText } from '@/shared/chat/agent-assistant-text'
import { resolveToolOutcomes, type ResolvedToolOutcome } from './tool-outcomes'
import { summarizeToolResultForTranscript } from '@/shared/tools/tool-result-summary'
import {
  GENERATED_UI_DATA_TYPE,
  buildGeneratedUiPart,
  generatedUiDataToPlainText,
  normalizeGeneratedUiData,
} from '@overlay/chat-core/generated-ui'
import { collectWebSourcesFromSingleBlock } from '@overlay/chat-core/sources'
import type { WebSourceItem } from '@overlay/chat-core/types'

/** Persisted when the model produced no text/tool transcript so reload never drops the assistant row. */
export const ASSISTANT_EMPTY_CONTENT_PLACEHOLDER = '[Empty response]'

export function ensureAssistantPersistContent(content: string): string {
  return content.trim() ? content : ASSISTANT_EMPTY_CONTENT_PLACEHOLDER
}

const MAX_PERSISTED_ASSISTANT_CONTENT_CHARS = 160_000
const MAX_PERSISTED_TEXT_PART_CHARS = 80_000
const MAX_PERSISTED_REASONING_PART_CHARS = 24_000
const MAX_PERSISTED_TOOL_VALUE_CHARS = 4_000
const MAX_PERSISTED_PART_TEXT_TOTAL_CHARS = 180_000
const MAX_PERSISTED_ASSISTANT_PARTS = 80
const MAX_PERSISTED_WEB_SOURCES = 24
const WEB_SOURCE_TOOL_NAMES = new Set([
  'perplexity_search',
  'parallel_search',
  'web_search',
  'deep_search',
  'web_fetch',
  'browser_run_task',
  'interactive_browser_session',
])

function truncateForPersistence(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars).trimEnd()}\n\n[truncated ${text.length - maxChars} chars for storage]`
}

function stringifyForPersistence(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function compactToolValueForPersistence(value: unknown): unknown {
  if (value == null) return value
  if (typeof value === 'string') return truncateForPersistence(value, MAX_PERSISTED_TOOL_VALUE_CHARS)
  if (typeof value === 'number' || typeof value === 'boolean') return value

  const serialized = stringifyForPersistence(value)
  if (serialized.length <= MAX_PERSISTED_TOOL_VALUE_CHARS) {
    return clampNestingDepth(value)
  }
  return {
    truncated: true,
    summary: truncateForPersistence(serialized, MAX_PERSISTED_TOOL_VALUE_CHARS),
  }
}

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

export function replaceAssistantTextForPersistence(
  persistence: { content: string; parts: Array<Record<string, unknown>> },
  text: string,
): { content: string; parts: Array<Record<string, unknown>> } {
  const cleaned = ensureAssistantPersistContent(normalizeAgentAssistantText(text))
  let replacedText = false
  const parts = persistence.parts.flatMap((part) => {
    if (part.type !== 'text') return [part]
    if (replacedText) return []
    replacedText = true
    return [{ type: 'text', text: cleaned }]
  })
  if (!replacedText) parts.push({ type: 'text', text: cleaned })
  return {
    content: cleaned,
    parts,
  }
}

/**
 * Convex documents may not exceed 16 levels of nesting. Tool outputs (e.g. Notion API
 * responses) can easily exceed this. This helper truncates any object/array that is
 * deeper than `maxDepth` levels, replacing it with a sentinel string so the content
 * is still readable but safe to store.
 */
function clampNestingDepth(value: unknown, maxDepth = 10, currentDepth = 0): unknown {
  if (currentDepth >= maxDepth) {
    if (value === null || value === undefined) return value
    if (typeof value !== 'object') return value
    return '[truncated: too deeply nested]'
  }
  if (Array.isArray(value)) {
    return value.map((item) => clampNestingDepth(item, maxDepth, currentDepth + 1))
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const key of Object.keys(value as object)) {
      result[key] = clampNestingDepth((value as Record<string, unknown>)[key], maxDepth, currentDepth + 1)
    }
    return result
  }
  return value
}

export function compactAssistantPersistenceForConvex(input: {
  content: string
  parts: Array<Record<string, unknown>>
}): { content: string; parts: Array<Record<string, unknown>> } {
  const content = truncateForPersistence(input.content, MAX_PERSISTED_ASSISTANT_CONTENT_CHARS)
  const parts: Array<Record<string, unknown>> = []
  let remainingPartTextChars = MAX_PERSISTED_PART_TEXT_TOTAL_CHARS

  for (const part of input.parts) {
    if (parts.length >= MAX_PERSISTED_ASSISTANT_PARTS) break

    if (part.type === 'text') {
      const text = typeof part.text === 'string' ? part.text : ''
      const max = Math.min(MAX_PERSISTED_TEXT_PART_CHARS, Math.max(0, remainingPartTextChars))
      if (!max) continue
      const nextText = truncateForPersistence(text, max)
      remainingPartTextChars -= Math.min(text.length, max)
      parts.push({ ...part, text: nextText })
      continue
    }

    if (part.type === 'reasoning') {
      const text = typeof part.text === 'string' ? part.text : ''
      const max = Math.min(MAX_PERSISTED_REASONING_PART_CHARS, Math.max(0, remainingPartTextChars))
      if (!max) continue
      const nextText = truncateForPersistence(text, max)
      remainingPartTextChars -= Math.min(text.length, max)
      parts.push({ ...part, text: nextText, state: part.state ?? 'done' })
      continue
    }

    if (part.type === 'tool-invocation') {
      const invocation = part.toolInvocation && typeof part.toolInvocation === 'object'
        ? (part.toolInvocation as Record<string, unknown>)
        : {}
      const toolName = typeof invocation.toolName === 'string' ? invocation.toolName : ''
      const webSources = compactWebSourcesForPersistence(toolName, invocation.toolOutput)
      const compactedToolOutput = compactToolValueForPersistence(invocation.toolOutput)
      parts.push({
        ...part,
        toolInvocation: {
          ...invocation,
          toolInput: compactToolValueForPersistence(invocation.toolInput),
          toolOutput: attachWebSourcesToToolOutput(compactedToolOutput, webSources),
        },
      })
      continue
    }

    if (part.type === 'data' && part.dataType === GENERATED_UI_DATA_TYPE) {
      const normalized = normalizeGeneratedUiData(part.data)
      const id = typeof part.id === 'string' && part.id.trim() ? part.id.trim() : ''
      if (normalized && id) {
        parts.push({
          type: 'data',
          id,
          dataType: GENERATED_UI_DATA_TYPE,
          data: normalized,
          ...(part.transient === true ? { transient: true } : {}),
        })
      }
      continue
    }

    parts.push(clampNestingDepth(part) as Record<string, unknown>)
  }

  if (input.parts.length > parts.length) {
    parts.push({
      type: 'text',
      text: `[${input.parts.length - parts.length} additional assistant parts omitted for storage]`,
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

function toolOutputForOutcome(outcome: ResolvedToolOutcome | undefined): unknown {
  return outcome?.hasOutput ? outcome.output : undefined
}

function toolInvocationForPersistence(
  call: PersistedToolCall,
  outcome: ResolvedToolOutcome | undefined,
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
    toolInput: clampNestingDepth(call.input),
    toolOutput: clampNestingDepth(toolOutputForOutcome(outcome)),
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
): { content: string; parts: Array<Record<string, unknown>> } {
  const list = steps ?? []
  const textSegments: string[] = []
  const synthesizedToolSegments: string[] = []
  const generatedUiTextSegments: string[] = []
  const toolOutcomes = resolveToolOutcomes(list)

  for (const step of list) {
    const trimmedText = step.text?.trim()
    if (trimmedText) {
      textSegments.push(normalizeAgentAssistantText(trimmedText))
    }
    for (const tc of toolCallsForStep(step)) {
      const outcome = toolOutcomes.get(tc.toolCallId)
      const toolOutput = toolOutputForOutcome(outcome)
      if (tc.toolName === 'present_generated_ui') {
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
  for (const step of list) {
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
    // SDK content preserves generation order; the convenience fields group by type.
    const orderedContent: readonly Record<string, unknown>[] = step.content?.length ? step.content as readonly Record<string, unknown>[] : [
      ...(reasoningText ? [{ type: 'reasoning' as const, text: reasoningText }] : []),
      ...(step.toolCalls ?? []).map((call) => ({ ...call, type: 'tool-call' as const })),
      ...(step.text?.trim() ? [{ type: 'text' as const, text: step.text }] : []),
    ]
    for (const tc of orderedContent) {
      if (tc.type === 'text' || tc.type === 'reasoning') {
        if (typeof tc.text === 'string' && tc.text.trim()) {
          parts.push({
            type: tc.type,
            text: normalizeAgentAssistantText(tc.text.trim()),
            ...(tc.type === 'reasoning' ? { state: 'done' } : {}),
          })
        }
        continue
      }
      const call = toolCallFromPart(tc)
      if (!call) continue
      const outcome = toolOutcomes.get(call.toolCallId)
      const toolOutput = toolOutputForOutcome(outcome)
      if (tc.toolName === 'present_generated_ui') {
        const output = toolOutput && typeof toolOutput === 'object'
          ? toolOutput as Record<string, unknown>
          : null
        const part = outcome?.state === 'output-available' && output?.success === true
          ? buildGeneratedUiPart(
              (typeof output.id === 'string' && output.id.trim()) || call.toolCallId,
              output.generatedUi,
            )
          : null
        if (part) parts.push(part)
        continue
      }
      const toolPart = {
        type: 'tool-invocation',
        toolInvocation: toolInvocationForPersistence(call, outcome),
      }
      const existingIndex = renderedToolCallIds.get(call.toolCallId)
      if (existingIndex === undefined) {
        renderedToolCallIds.set(call.toolCallId, parts.length)
        parts.push(toolPart)
      } else {
        parts[existingIndex] = toolPart
      }
    }
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
