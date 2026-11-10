import { publicHarnessStepPersistence, writeSettledHarnessTranscriptStep } from './harness-transcript'
import type { LanguageModelV4CallOptions } from '@ai-sdk/provider'
import { FatalError } from 'workflow'
import type { HarnessSnapshot } from '@overlay/agent-runtime/harness-state'
import { compactHarnessPrompt, estimateContextTokens } from '@/server/chat/context-compaction-core'
import { isKimiK3ModelId } from '@/shared/ai/gateway/model-types'
import { buildHarnessStepInstructions } from './context'
import { prepareHarnessArtifactPrompt } from './artifact-prompt'
import { createHarnessCompactionPort } from './compaction-port'
import { captureHarnessModelUsage } from './model-usage'
import type { HarnessExecutionPorts, HarnessModelSettings } from './ports'
import { DEFAULT_MAX_OUTPUT_TOKENS, type HarnessModelPurpose, type PreparedHarnessModel } from './model-port-types'
import { readHarnessModelLimits } from './model-preparation'
import { settleHarnessModelUsage } from './settle-model-step'
import { applyHarnessOperation, readHarnessState, type HarnessExecutionReference } from './state-steps'
import { estimateHarnessPromptTokens } from './artifact-context'
import { recordPublicStreamMetric } from './public-stream-metrics'

export type { HarnessModelPurpose, PreparedHarnessModel } from './model-port-types'
import { HarnessYield, waitForHarnessModelRecovery } from './model-recovery'

type ModelStep = Parameters<HarnessExecutionPorts['recordModelStep']>[0]

function recordPreparationMetricIfEligible(
  reference: HarnessExecutionReference,
  publicStreamVersion: number | undefined,
  receiptId: string,
  modelId: string,
): void {
  if (publicStreamVersion !== 1) return
  recordPublicStreamMetric({
    event: 'preparation_complete',
    runId: reference.runId,
    generation: reference.executionGeneration ?? 0,
    receiptId,
    modelId,
  })
}

/**
 * Context window assumed for a model the catalog does not describe (bring-your-own
 * keys, subscriptions). Generous on purpose: the provider rejects a real overflow,
 * and compaction still runs once the prompt approaches this size.
 */
export const UNKNOWN_MODEL_CONTEXT_WINDOW = 200_000

/**
 * Output limits for one harness model call.
 *
 * Compaction keeps the prompt inside the working context and reserves up to a
 * quarter of it for output. By default the working context is the model's whole
 * context window, so the reserve is the output room. A smaller working context
 * (tests, the Preview QA hook) leaves everything between it and the model window
 * free for output.
 */
export function harnessOutputLimits(
  requested: number | undefined,
  modelMaxOutput: number | null,
  workingContextTokens: number,
  modelContextWindow: number,
): { maxOutputTokens: number; compactionOutputReserve: number } {
  const allowed = Math.min(requested ?? DEFAULT_MAX_OUTPUT_TOKENS, modelMaxOutput ?? DEFAULT_MAX_OUTPUT_TOKENS)
  const reserve = Math.max(1, Math.floor(workingContextTokens / 4))
  const headroom = Math.max(reserve, modelContextWindow - workingContextTokens)
  return { maxOutputTokens: Math.min(allowed, headroom), compactionOutputReserve: Math.min(allowed, reserve) }
}

/** Below this many visible tokens, a capped call is treated as having written nothing. */
const THINKING_ONLY_VISIBLE_TOKENS = 64

type ReasoningSetting = NonNullable<HarnessModelSettings['reasoning']>

/**
 * Reasoning for the next response call.
 *
 * Thinking is not carried into the next call, so a call that hit its output limit
 * with nothing but thinking would make every continuation think from scratch and
 * write nothing. When the previous response receipt shows that, the continuation
 * runs with thinking off so it writes the answer.
 */
export function harnessReasoningSetting(
  modelId: string,
  requested: ReasoningSetting | undefined,
  truncatedResponse: boolean,
  previousReceipt: { id: string; outputTokens: number; reasoningTokens: number } | undefined,
): ReasoningSetting | undefined {
  if (truncatedResponse && previousReceipt?.id.startsWith('model:') && previousReceipt.reasoningTokens > 0
    && previousReceipt.outputTokens - previousReceipt.reasoningTokens < THINKING_ONLY_VISIBLE_TOKENS) return 'none'
  return isKimiK3ModelId(modelId) && requested !== undefined ? 'xhigh' : requested
}

export function createHarnessModelPorts(input: {
  reference: HarnessExecutionReference
  modelId: string
  prepare: (request: {
    modelId: string
    receiptId: string
    purpose: HarnessModelPurpose
    publicStreamVersion?: 1
    /** This response call continues text the previous call stopped at its output cap. */
    continuesPrevious?: boolean
    options: LanguageModelV4CallOptions
  }) => Promise<PreparedHarnessModel>
  contextBudgetTokens?: number
}): Pick<HarnessExecutionPorts, 'prepareModel' | 'recordModelStep' | 'recoverModelFailure'> {
  const preparedCalls = new Map<string, PreparedHarnessModel>()
  const publicProgressReceipts = new Map<string, boolean>()
  const { reference, prepare } = input
  let activeToolNames = new Set<string>()
  // Whether the last call with public output stopped at its output cap. Unknown until
  // this segment records a step; a handed-off segment starts from the runner's flag.
  let lastOutputCutOff: boolean | undefined
  const continuationFields = (truncatedResponse: boolean) =>
    (lastOutputCutOff ?? truncatedResponse) ? { continuesPrevious: true } : {}
  // Catalog limits are fixed for a model, so read them once per run.
  const limitsByModel = new Map<string, Awaited<ReturnType<typeof readHarnessModelLimits>>>()
  async function modelLimits(modelId: string) {
    let limits = limitsByModel.get(modelId)
    if (!limits) limitsByModel.set(modelId, limits = await readHarnessModelLimits(modelId))
    return limits
  }
  if (input.contextBudgetTokens !== undefined
    && (!Number.isSafeInteger(input.contextBudgetTokens) || input.contextBudgetTokens < 1_024)) {
    throw new Error('Invalid harness working-context budget.')
  }

  async function settle(step: ModelStep, receiptId: string, prepared: PreparedHarnessModel) {
    await settleHarnessModelUsage({
      reference, receiptId, contextWindow: prepared.contextWindow,
      observation: captureHarnessModelUsage(step, prepared.model.modelId),
    })
  }

  const compaction = createHarnessCompactionPort({
    reference,
    prepare,
    settle,
    getCurrentModelId: () => input.modelId,
  })

  return {
    recoverModelFailure: async receiptId => {
      const state = await readHarnessState(reference)
      const receipt = state.latestReceipt
      if (state.status !== 'running' || state.modelReservation || receipt?.id !== receiptId) return false
      if (state.modelRecovery?.receiptId === receiptId) {
        preparedCalls.delete(receiptId)
        return waitForHarnessModelRecovery(reference, receiptId)
      }
      return false
    },
    prepareModel: async request => {
      publicProgressReceipts.set(request.receiptId, request.instructionContext.publicProgress === true)
      activeToolNames = new Set(request.toolNames)
      const limits = await modelLimits(input.modelId)
      const modelContextWindow = limits.contextWindow ?? UNKNOWN_MODEL_CONTEXT_WINDOW
      // The working context is the model's real window; compaction runs only as the
      // prompt approaches it. Callers and the Preview QA hook may choose a smaller one.
      const contextWindow = Math.min(
        input.contextBudgetTokens ?? limits.previewContextBudgetTokens ?? modelContextWindow, modelContextWindow)
      const { maxOutputTokens, compactionOutputReserve } = harnessOutputLimits(
        request.settings.maxOutputTokens, limits.maxOutputTokens, contextWindow, modelContextWindow)
      let state = request.state
      let promptMessages = request.messages
      promptMessages = await prepareHarnessArtifactPrompt({
        reference, state, messages: request.messages, receiptId: request.receiptId,
      })
      const fixedState: HarnessSnapshot = { ...state, workingSummary: '' }
      const fixedOverheadTokens = estimateContextTokens(buildHarnessStepInstructions(fixedState, request.instructionContext))
        + estimateContextTokens(request.toolDefinitions)
      let summaryIndex = 0
      const resumableCycle = state.compaction
        && (state.compaction.status === 'interrupted' || state.compaction.status === 'awaiting_reconciliation')
        ? state.compaction : undefined
      let resumeCycleUsed = false
      const compacted = await compactHarnessPrompt({
        messages: promptMessages,
        contextWindow,
        outputReserveTokens: compactionOutputReserve,
        fixedOverheadTokens,
        previousSummary: state.workingSummary,
        estimatePromptTokens: estimateHarnessPromptTokens,
        generateSummaryText: ({ prompt, targetSummaryTokens }) => {
          if (resumableCycle && !resumeCycleUsed) {
            resumeCycleUsed = true
            if (resumableCycle.retryCount >= 1) throw new Error('The compaction retry budget is exhausted.')
            return compaction.summarize(prompt, targetSummaryTokens,
              `${resumableCycle.cycleId}:retry:${resumableCycle.retryCount + 1}`)
          }
          return compaction.summarize(prompt, targetSummaryTokens, `summary:${request.receiptId}:${summaryIndex++}`)
        },
      })
      let messages = compacted.messages
      let instructions: string
      let responseMaxOutputTokens = maxOutputTokens
      if (compacted.summaryFailed || !compacted.fitsBudget) {
        state = await readHarnessState(reference)
        if (state.compaction?.status === 'awaiting_reconciliation'
          || state.modelReservation?.id.startsWith('summary:')) throw new HarnessYield()
        const fallbackInstructions = buildHarnessStepInstructions(state, request.instructionContext)
        const fallbackMessages = promptMessages.filter(message => message.role !== 'system')
        const fallbackMaxOutputTokens = Math.min(request.settings.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
          limits.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS, Math.max(1, Math.floor(modelContextWindow / 4)))
        const fallbackFixedOverheadTokens = estimateContextTokens(fallbackInstructions)
          + estimateContextTokens(request.toolDefinitions)
        const fallbackMessageTokens = estimateHarnessPromptTokens(fallbackMessages)
        const fitsFullHistory = fallbackFixedOverheadTokens + fallbackMessageTokens + fallbackMaxOutputTokens <= modelContextWindow
        if (state.modelReservation || !fitsFullHistory) {
          if (state.status === 'running') {
            await applyHarnessOperation(reference, `compaction-unavailable:${request.receiptId}`, {
              type: 'block',
              blocker: {
                kind: 'stuck',
                question: state.modelReservation
                  ? 'Compaction is awaiting provider settlement. Full history is preserved.'
                  : 'The full history exceeds the provider context window; no safe compacted continuation is available.',
              },
            })
          }
          throw new HarnessYield()
        }
        // eslint-disable-next-line no-console
        console.warn('[harness] compaction failed; continuing with uncompacted history within the model context window')
        messages = fallbackMessages
        instructions = fallbackInstructions
        responseMaxOutputTokens = fallbackMaxOutputTokens
      } else if (compacted.didCompact) {
        state = await applyHarnessOperation(reference, `compact:${request.receiptId}`, {
          type: 'checkpoint', summary: compacted.summary, purpose: 'compaction',
        })
        instructions = buildHarnessStepInstructions(state, request.instructionContext)
      } else {
        // Nothing was written since the boundary read: no summary, no checkpoint.
        instructions = buildHarnessStepInstructions(state, request.instructionContext)
      }
      const prepared = await prepare({
        modelId: input.modelId,
        receiptId: request.receiptId,
        purpose: 'response',
        publicStreamVersion: request.state.policy.publicStreamVersion,
        ...continuationFields(request.instructionContext.truncatedResponse),
        options: {
          ...request.settings,
          maxOutputTokens: responseMaxOutputTokens,
          tools: request.toolDefinitions,
          prompt: [{ role: 'system', content: instructions }, ...messages],
        },
      })
      preparedCalls.set(request.receiptId, prepared)
      recordPreparationMetricIfEligible(
        reference, request.state.policy.publicStreamVersion, request.receiptId, prepared.model.modelId,
      )
      const reasoning = harnessReasoningSetting(input.modelId, request.settings.reasoning,
        request.instructionContext.truncatedResponse, request.state.latestReceipt)
      return {
        messages,
        instructions,
        activeToolNames: request.toolNames,
        model: prepared.model,
        settings: {
          ...request.settings,
          ...(reasoning !== undefined ? { reasoning } : {}),
          maxOutputTokens: responseMaxOutputTokens,
          providerOptions: prepared.options.providerOptions,
        },
      }
    },
    recordModelStep: async (step, receiptId) => {
      const prepared = preparedCalls.get(receiptId)
      if (!prepared) {
        if ((await readHarnessState(reference)).latestReceipt?.id === receiptId) return
        throw new FatalError('Model usage has no corresponding prepared dispatch.')
      }
      await settle(step, receiptId, prepared)
      const persistence = publicHarnessStepPersistence(step, activeToolNames, { textOnly: publicProgressReceipts.get(receiptId) === true })
      await writeSettledHarnessTranscriptStep(reference, receiptId, step.stepNumber, persistence)
      if (persistence.content || persistence.parts.length) lastOutputCutOff = persistence.outputLimitReached === true
      preparedCalls.delete(receiptId)
      publicProgressReceipts.delete(receiptId)
    },
  }
}
