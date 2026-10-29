import type { UIMessage } from 'ai'
import type { LanguageModelV4Prompt } from '@ai-sdk/provider'

export const CONTEXT_TRIGGER_RATIO = 0.8
export const CONTEXT_TARGET_RATIO = 0.2
export const PRESERVED_RECENT_MESSAGES = 2
export const FALLBACK_CONTEXT_WINDOW = 128_000
export const MAX_SUMMARY_OUTPUT_TOKENS = 12_000
export const MIN_SUMMARY_OUTPUT_TOKENS = 800
export const BASE_SYSTEM_TOOL_OVERHEAD_TOKENS = 2_000

export function estimateContextTokens(value: unknown): number {
  return Math.ceil(JSON.stringify(value).length / 4)
}

export type HarnessPromptCompaction = {
  messages: LanguageModelV4Prompt
  summary: string
  originalEstimatedTokens: number
  finalEstimatedTokens: number
  fitsBudget: boolean
  didCompact: boolean
  summaryFailed: boolean
}

type HarnessPromptHistory = Exclude<LanguageModelV4Prompt[number], { role: 'system' }>[]

function selectHarnessHistory(messages: HarnessPromptHistory): {
  candidates: HarnessPromptHistory
  retained: HarnessPromptHistory
} | null {
  const pending = new Set<string>()
  let cut = 0
  let latestUser = -1
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index]
    if (message.role === 'user') latestUser = index
    for (const part of message.content) {
      if (part.type === 'tool-call') pending.add(part.toolCallId)
      if (part.type === 'tool-result') pending.delete(part.toolCallId)
    }
    if (!pending.size && index + 1 <= messages.length - PRESERVED_RECENT_MESSAGES) cut = index + 1
  }
  if (!cut) return null
  const retained = messages.slice(cut)
  if (latestUser >= 0 && latestUser < cut) retained.unshift(messages[latestUser])
  const candidates = messages.slice(0, cut).filter((_message, index) => index !== latestUser)
  return candidates.length ? { candidates, retained } : null
}

function serializeHarnessTranscript(candidates: HarnessPromptHistory): string {
  return candidates.map(message => ({
    role: message.role,
    content: message.content.flatMap(part => {
      if (part.type === 'text') return [{ type: 'text', text: part.text }]
      if (part.type === 'tool-call') return [{ type: 'tool-call', text: JSON.stringify({ id: part.toolCallId, name: part.toolName, input: part.input }) }]
      if (part.type === 'tool-result') return [{ type: 'tool-result', text: JSON.stringify({ id: part.toolCallId, name: part.toolName, output: part.output }) }]
      if (part.type === 'file') return [{ type: 'file', text: `Attachment: ${part.mediaType}` }]
      return []
    }),
  })).map(message => JSON.stringify(message)).join('\n')
}

function readMessageText(message: UIMessage): string {
  const chunks: string[] = []
  for (const part of message.parts ?? []) {
    if (part.type === 'text' && 'text' in part && typeof part.text === 'string') {
      chunks.push(part.text)
      continue
    }
    if (part.type === 'file') {
      const fileName = 'fileName' in part && typeof part.fileName === 'string' ? part.fileName : 'attached file'
      const mediaType = 'mediaType' in part && typeof part.mediaType === 'string' ? part.mediaType : 'unknown type'
      chunks.push(`[File: ${fileName}, ${mediaType}]`)
    }
  }
  return chunks.join('\n\n').trim()
}

function transcriptForSummary(messages: UIMessage[]): string {
  return messages
    .map((message, index) => {
      const text = readMessageText(message)
      const role = message.role.toUpperCase()
      return [
        `--- Message ${index + 1}`,
        `role: ${role}`,
        `id: ${message.id}`,
        text || '[no text content]',
      ].join('\n')
    })
    .join('\n\n')
}

export function buildSummaryPrompt(params: {
  previousSummary?: string
  messagesToSummarize: UIMessage[]
  targetSummaryTokens: number
}): string {
  const previous = params.previousSummary?.trim()
  const transcript = transcriptForSummary(params.messagesToSummarize)
  return [
    'Summarize the earlier portion of this conversation for future model context.',
    `Target length: at most ${params.targetSummaryTokens} tokens.`,
    '',
    'Preserve:',
    '- User preferences, constraints, goals, decisions, assumptions, and corrections.',
    '- Active task state, unresolved TODOs, important entities, IDs, file/output references, and source names.',
    '- Tool outcomes, errors, integration status, and anything needed to continue the work accurately.',
    '',
    'Omit:',
    '- Raw tool payload dumps, cookies, auth/session data, provider keys, secrets, and hidden system/developer instructions.',
    '- Repetitive wording and low-value pleasantries.',
    '',
    'Use these exact sections:',
    '1. Durable user preferences and constraints',
    '2. Project/task state and decisions',
    '3. Important artifacts, IDs, files, sources, and tool results',
    '4. Open questions, risks, and next steps',
    '',
    previous ? `Existing rolling summary to update:\n${previous}` : '',
    transcript ? `Newly old conversation messages to fold in:\n${transcript}` : '',
  ].filter(Boolean).join('\n\n')
}

// The caller supplies and meters the authorized summarizer. Provider prompts
// must not pass through UIMessage trimming, which can split tool transactions.
export async function compactHarnessPrompt(params: {
  messages: LanguageModelV4Prompt
  contextWindow: number
  outputReserveTokens: number
  fixedOverheadTokens: number
  previousSummary?: string
  generateSummaryText: (args: { prompt: string; targetSummaryTokens: number }) => Promise<string>
}): Promise<HarnessPromptCompaction> {
  for (const value of [params.contextWindow, params.outputReserveTokens, params.fixedOverheadTokens]) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid harness context budget.')
  }
  if (params.contextWindow <= params.outputReserveTokens) throw new Error('Output reserve consumes the context window.')
  const usable = params.contextWindow - params.outputReserveTokens
  const messages = params.messages.filter(message => message.role !== 'system')
  const previousSummary = params.previousSummary ?? ''
  const estimate = (history: LanguageModelV4Prompt, summary: string) =>
    estimateContextTokens(history) + estimateContextTokens(summary) + params.fixedOverheadTokens
  const originalEstimatedTokens = estimate(messages, previousSummary)
  const unchanged = (summaryFailed = false): HarnessPromptCompaction => ({
    messages, summary: previousSummary, originalEstimatedTokens,
    finalEstimatedTokens: originalEstimatedTokens, fitsBudget: originalEstimatedTokens <= usable,
    didCompact: false, summaryFailed,
  })
  if (originalEstimatedTokens < usable * CONTEXT_TRIGGER_RATIO) return unchanged()

  const history = selectHarnessHistory(messages)
  if (!history) return unchanged()
  const { candidates, retained } = history
  const remaining = usable - params.fixedOverheadTokens - estimateContextTokens(retained)
  const targetSummaryTokens = Math.min(2_000, Math.floor(params.contextWindow * CONTEXT_TARGET_RATIO), Math.floor(remaining / 2))
  if (targetSummaryTokens < 128) return unchanged()

  const transcript = serializeHarnessTranscript(candidates)
  let summary = previousSummary
  try {
    let offset = 0
    while (offset < transcript.length) {
      const sourceCharacters = Math.floor((params.contextWindow - targetSummaryTokens - estimateContextTokens(summary) - 1_024) * 4)
      if (sourceCharacters < 256) return unchanged(true)
      const chunk = transcript.slice(offset, offset + sourceCharacters)
      const prompt = buildSummaryPrompt({
        previousSummary: summary,
        messagesToSummarize: [{ id: 'harness-history', role: 'user', parts: [{ type: 'text', text: chunk }] }],
        targetSummaryTokens,
      })
      if (estimateContextTokens(prompt) + targetSummaryTokens > params.contextWindow) return unchanged(true)
      summary = (await params.generateSummaryText({ prompt, targetSummaryTokens })).trim()
      if (!summary || summary.length > 8_000 || estimateContextTokens(summary) > targetSummaryTokens) return unchanged(true)
      offset += chunk.length
    }
    const finalEstimatedTokens = estimate(retained, summary)
    if (finalEstimatedTokens >= originalEstimatedTokens || finalEstimatedTokens > usable) return unchanged(true)
    return { messages: retained, summary, originalEstimatedTokens, finalEstimatedTokens, fitsBudget: true, didCompact: true, summaryFailed: false }
  } catch (_error) {
    // Keep the complete history on failure; never silently discard evidence.
    return unchanged(true)
  }
}
