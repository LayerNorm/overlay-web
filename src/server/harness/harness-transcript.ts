import { GENERATED_UI_DATA_TYPE } from '@overlay/chat-core/generated-ui'
import type { StepResult, ToolSet } from 'ai'
import { readHarnessState, applyHarnessOperation, type HarnessExecutionReference } from './state-steps'
import { createHarnessDiagnostic, stableHarnessDiagnosticId } from '@overlay/agent-runtime/harness-diagnostic'
import type { HarnessExecutionResult } from './runner'
import type {
  HarnessTranscriptPage,
  HarnessTranscriptPersistence,
  HarnessTranscriptStep,
} from '@overlay/agent-runtime/harness-store'
import { buildAssistantPersistenceFromSteps, compactAssistantPersistenceForConvex } from '@/shared/chat/persist-assistant-turn'
import { HARNESS_CONTROL_TOOLS } from './context'
import { hasTextualToolCalls } from './textual-tool-calls'
import { stripHarnessBookkeeping } from './public-text'
import { ConvexHarnessRepository } from './ConvexHarnessRepository'
import { HarnessAuthorizationError, HarnessPersistenceError } from './harness-diagnostics'

function transcriptError(error: unknown): Error {
  if (error instanceof HarnessAuthorizationError || error instanceof HarnessPersistenceError) return error
  const message = error instanceof Error ? error.message : ''
  if (['HARNESS_TRANSCRIPT_ACCESS_DENIED', 'HARNESS_EXECUTION_NOT_OWNED', 'HARNESS_RUN_NOT_FOUND',
    'CONVERSATION_ACCESS_DENIED'].some(code => message.includes(code))) return new HarnessAuthorizationError()
  return new HarnessPersistenceError()
}

export function publicHarnessStepPersistence(
  step: StepResult<ToolSet>,
  activeToolNames: ReadonlySet<string>,
  options: { textOnly?: boolean } = {},
): HarnessTranscriptPersistence {
  const toolNames = new Set([...HARNESS_CONTROL_TOOLS, ...activeToolNames])
  if (options.textOnly && (step.toolCalls.length || hasTextualToolCalls(step.text ?? '', toolNames))) {
    return { content: '', parts: [] }
  }
  const sanitize = (text: string) => stripHarnessBookkeeping(text, toolNames)
  const controls = new Set<string>(HARNESS_CONTROL_TOOLS)
  const isPublic = (part: { type: string; toolName?: string; toolCall?: unknown }) => {
    if (options.textOnly) return part.type === 'text'
    const nested = part.toolCall && typeof part.toolCall === 'object' && 'toolName' in part.toolCall
      ? part.toolCall.toolName : undefined
    return !controls.has(part.toolName ?? (typeof nested === 'string' ? nested : ''))
  }
  const displayResult = <T extends { type: string }>(part: T): T => {
    if (part.type !== 'tool-result' || !('output' in part)) return part
    const output = part.output
    if (!output || typeof output !== 'object' || !('display' in output) || !('success' in output)) return part
    return { ...part, output: output.display }
  }
  const publicStep: StepResult<ToolSet> = {
    ...step,
    reasoningText: undefined,
    reasoning: [],
    text: typeof step.text === 'string' ? sanitize(step.text) : step.text,
    content: step.content?.filter(part => part.type !== 'reasoning' && isPublic(part)).map(part => {
      const cleaned = part.type === 'text' && typeof part.text === 'string'
        ? { ...part, text: sanitize(part.text) }
        : part
      return displayResult(cleaned)
    }),
    toolCalls: step.toolCalls.filter(isPublic),
    toolResults: step.toolResults.filter(isPublic).map(displayResult),
  }
  const hasPublicContent = publicStep.text?.trim() || publicStep.toolCalls.length || publicStep.toolResults.length
    || publicStep.content?.some(part => part.type !== 'text' || part.text.trim())
  // Internal-only and reasoning-only steps still have a settled receipt, but no
  // public output. Do not turn hidden bookkeeping into an empty-response bubble.
  if (!hasPublicContent) return { content: '', parts: [] }
  let persistence = buildAssistantPersistenceFromSteps([publicStep], publicStep.text ?? '', { fullValues: true })
  const hasModelText = publicStep.text?.trim() || publicStep.content?.some(part => part.type === 'text' && part.text.trim())
  if (!hasModelText && !persistence.parts.some(part => part.type === GENERATED_UI_DATA_TYPE)) {
    // Keep genuine work-tool rows, without turning their synthesized summaries
    // into additional assistant narration at every journal boundary.
    persistence = { content: '', parts: persistence.parts.filter(part => part.type !== 'text') }
  }
  return {
    ...persistence,
    parts: persistence.parts.filter(part => part.type !== 'reasoning'),
  }
}

export async function writeSettledHarnessTranscriptStep(
  reference: HarnessExecutionReference,
  receiptId: string,
  stepNumber: number,
  persistence: HarnessTranscriptPersistence,
): Promise<void> {
  'use step'
  try {
    const repository = new ConvexHarnessRepository()
    const state = await repository.get(reference)
    if (!state) throw new HarnessAuthorizationError()
    if (state.policy.publicProgressVersion !== 1) return
    await repository.writeTranscriptStep({
      actorUserId: reference.actorUserId,
      runId: reference.runId,
      workflowRunId: reference.workflowRunId,
      receiptId,
      stepNumber,
      persistence,
    })
  } catch (error) {
    throw transcriptError(error)
  }
}

export async function readSettledHarnessTranscriptPage(
  reference: HarnessExecutionReference,
  cursor: string | null,
): Promise<HarnessTranscriptPage> {
  'use step'
  try {
    const repository = new ConvexHarnessRepository()
    const state = await repository.get(reference)
    if (!state) throw new HarnessAuthorizationError()
    if (state.policy.publicProgressVersion !== 1) return { steps: [], cursor: '', isDone: true }
    return await repository.listTranscriptSteps({
      actorUserId: reference.actorUserId,
      runId: reference.runId,
      workflowRunId: reference.workflowRunId,
      cursor,
    })
  } catch (error) {
    throw transcriptError(error)
  }
}

const MAX_SETTLED_TRANSCRIPT_STEPS = 500
const MAX_SETTLED_TRANSCRIPT_CHARS = 4_000_000

export type SettledHarnessTranscriptWindow = {
  persistence: HarnessTranscriptPersistence
  steps: HarnessTranscriptStep[]
  truncated: boolean
  newestSequence: number | null
  oldestSequence: number | null
}

export function compactHarnessTranscriptPersistence(input: HarnessTranscriptPersistence): HarnessTranscriptPersistence {
  const contentPrefix = '[earlier transcript content omitted]\n\n'
  const content = input.content.length > 160_000
    ? `${contentPrefix}${input.content.slice(-(160_000 - contentPrefix.length))}` : input.content
  const parts = input.parts.map(part => {
    if (part.type !== 'text' || typeof part.text !== 'string' || part.text.length <= 80_000) return part
    return { ...part, text: `[earlier text omitted]\n\n${part.text.slice(-79_970)}` }
  })
  return compactAssistantPersistenceForConvex({ content, parts })
}

export async function readSettledHarnessTranscript(
  reference: HarnessExecutionReference,
  pageReader: typeof readSettledHarnessTranscriptPage = readSettledHarnessTranscriptPage,
): Promise<{
  persistence: HarnessTranscriptPersistence
  steps: HarnessTranscriptStep[]
  truncated: boolean
  newestSequence: number | null
  oldestSequence: number | null
}> {
  let cursor: string | null = null
  const newestFirst: HarnessTranscriptStep[] = []
  let totalChars = 0
  let pageCount = 0
  let truncated = false
  while (true) {
    const page = await pageReader(reference, cursor)
    if (!page || !Array.isArray(page.steps) || typeof page.isDone !== 'boolean'
      || (page.cursor !== null && typeof page.cursor !== 'string')) throw new HarnessPersistenceError()
    for (let index = 0; index < page.steps.length; index++) {
      const step = page.steps[index]!
      if (!step || typeof step.receiptId !== 'string' || !Number.isSafeInteger(step.sequence)
        || !Number.isSafeInteger(step.stepNumber) || !step.persistence
        || typeof step.persistence.content !== 'string' || !Array.isArray(step.persistence.parts)) {
        throw new HarnessPersistenceError()
      }
      const serialized = JSON.stringify(step.persistence)
      if (typeof serialized !== 'string') throw new HarnessPersistenceError()
      const stepChars = serialized.length
      if (newestFirst.length >= MAX_SETTLED_TRANSCRIPT_STEPS
        || totalChars + stepChars > MAX_SETTLED_TRANSCRIPT_CHARS) {
        truncated = true
        break
      }
      totalChars += stepChars
      newestFirst.push(step)
      if (newestFirst.length >= MAX_SETTLED_TRANSCRIPT_STEPS
        || totalChars >= MAX_SETTLED_TRANSCRIPT_CHARS) {
        truncated = !page.isDone || index < page.steps.length - 1
        break
      }
    }
    if (truncated || newestFirst.length >= MAX_SETTLED_TRANSCRIPT_STEPS
      || totalChars >= MAX_SETTLED_TRANSCRIPT_CHARS) break
    if (page.isDone) break
    if (++pageCount >= Math.ceil(MAX_SETTLED_TRANSCRIPT_STEPS / 25)) throw new HarnessPersistenceError()
    if (!page.cursor || page.cursor === cursor) throw new HarnessPersistenceError()
    cursor = page.cursor
  }
  const newestSequence = newestFirst[0]?.sequence ?? null
  const oldestSequence = newestFirst.at(-1)?.sequence ?? null
  const steps = newestFirst.reverse()
  const persistence = compactHarnessTranscriptPersistence({
    content: steps.map(step => step.persistence.content).filter(Boolean).join('\n\n'),
    parts: steps.flatMap(step => step.persistence.parts),
  })
  return {
    persistence, steps, truncated,
    newestSequence,
    oldestSequence,
  }
}

/** A journal outage must not strand finalization or cause work to run again. */
export async function readHarnessTranscriptForDelivery(
  reference: HarnessExecutionReference,
  result: HarnessExecutionResult,
  reader: typeof readSettledHarnessTranscript = readSettledHarnessTranscript,
): Promise<SettledHarnessTranscriptWindow | undefined> {
  try {
    return await reader(reference)
  } catch (error) {
    if (error instanceof HarnessAuthorizationError) throw error
    const state = await readHarnessState(reference)
    if (state.workflowRunId !== reference.workflowRunId
      || (state.executionGeneration ?? 0) !== (reference.executionGeneration ?? 0)) throw new HarnessAuthorizationError()
    const operationId = 'transcript-read'
    const diagnostic = createHarnessDiagnostic({
      diagnosticId: stableHarnessDiagnosticId(state.runId, operationId, state.revision),
      code: 'PERSISTENCE_FAILED', stage: 'persistence', operationId, occurredAt: Date.now(),
    })
    result.snapshot = await applyHarnessOperation(reference, 'transcript-read-failed', { type: 'record_diagnostic', diagnostic })
    return undefined
  }
}
