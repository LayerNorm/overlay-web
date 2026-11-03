import { WorkflowAgent } from '@ai-sdk/workflow'
import type { LanguageModelV4CallOptions } from '@ai-sdk/provider'
import { isLoopFinished } from 'ai'
import { FatalError, sleep } from 'workflow'
import type { HarnessSnapshot } from '@overlay/agent-runtime/harness-state'
import { compactHarnessPrompt, estimateContextTokens, FALLBACK_CONTEXT_WINDOW } from '@/server/chat/context-compaction-core'
import { isByokModelId } from '@/shared/ai/gateway/byok-model-conversion'
import { isKimiK3ModelId } from '@/shared/ai/gateway/model-types'
import { buildHarnessStepInstructions } from './context'
import { captureHarnessModelUsage } from './model-usage'
import { readHarnessModelLimits } from './model-preparation'
import type { HarnessExecutionPorts } from './ports'
import { HarnessLanguageModel, type HarnessModelReference } from './secure-model'
import { settleHarnessModelUsage } from './settle-model-step'
import { applyHarnessOperation, readHarnessState, type HarnessExecutionReference } from './state-steps'
import { createHarnessCapacityWaiter } from './model-capacity'
import { waitForHarnessModelRecovery } from './model-recovery'
import { HarnessYield } from './model-recovery'
import { waitForHarnessModelResources } from './resource-boundary'
import { buildHarnessEvidenceEnvelope, harnessCandidateDigest, parseHarnessVerificationResponse } from './continuity'
import {
  HARNESS_ANSWER_VERIFICATION_INSTRUCTIONS,
  harnessSummaryInstructions,
} from './continuity-policy'
import { OPENROUTER_FREE_MODEL_ID, OVERLAY_FREE_MODEL_ID } from '@/shared/ai/gateway/overlay-free-policy'
import {
  externalizeOlderHarnessToolResults,
  harnessArtifactDigest,
  harnessArtifactId,
  serializeHarnessArtifactOutput,
  shouldExternalizeHarnessToolOutput,
  estimateHarnessPromptTokens,
  parseHarnessArtifactOutput,
} from './artifact-context'
import { storeHarnessArtifact } from './artifact-steps'
import { findResourceIdentity } from './tool-evidence'

export type PreparedHarnessModel = {
  model: HarnessModelReference
  options: LanguageModelV4CallOptions
  contextWindow: number | null
  estimatedCostMicros: number
}
export type HarnessModelPurpose = 'response' | 'summary' | 'verification'
type ModelStep = Parameters<HarnessExecutionPorts['recordModelStep']>[0]

export type HarnessModelRouting = {
  candidateIds: string[]
  onFallback?: (event: { from: string; to: string; receiptId: string; reason: 'budget' | 'model_unavailable' }) => Promise<void>
}

function routingCandidates(modelId: string, routing?: HarnessModelRouting): string[] {
  const candidates = routing?.candidateIds ?? [modelId]
  if (!candidates.length || candidates.length > 5 || candidates[0] !== modelId
    || candidates.some(id => !id.trim() || id.length > 256) || new Set(candidates).size !== candidates.length
    || (candidates.some(isByokModelId) && candidates.length !== 1)) throw new Error('Invalid admitted model routing.')
  return [...candidates]
}

export function createHarnessModelPorts(input: {
  reference: HarnessExecutionReference
  modelId: string
  prepare: (request: { modelId: string; receiptId: string; purpose: HarnessModelPurpose; options: LanguageModelV4CallOptions }) => Promise<PreparedHarnessModel>
  // A working-context policy, not a claim about an unknown provider's capacity.
  contextBudgetTokens?: number
}, routing?: HarnessModelRouting): Pick<HarnessExecutionPorts, 'prepareModel' | 'recordModelStep' | 'recoverModelFailure' | 'verifyFinalAnswer'> {
  const preparedCalls = new Map<string, PreparedHarnessModel>()
  const capacity = createHarnessCapacityWaiter()
  const candidates = routingCandidates(input.modelId, routing)
  let candidateIndex = 0
  const { reference, prepare } = input
  const contextBudgetTokens = input.contextBudgetTokens ?? 32_000
  if (!Number.isSafeInteger(contextBudgetTokens) || contextBudgetTokens < 1_024) throw new Error('Invalid harness working-context budget.')

  async function settle(step: ModelStep, receiptId: string, prepared: PreparedHarnessModel) {
    await settleHarnessModelUsage({ reference, receiptId, contextWindow: prepared.contextWindow,
      observation: captureHarnessModelUsage(step, prepared.model.modelId) })
    capacity.reset()
  }

  async function summarizeAttempt(prompt: string, targetSummaryTokens: number, receiptId: string): Promise<string> {
    const cycleId = receiptId.replace(/:retry:\d+$/, '')
    const retryCount = receiptId === cycleId ? 0 : 1
    let state = await readHarnessState(reference)
    if (state.status !== 'running' || state.workflowRunId !== reference.workflowRunId
      || Date.now() >= state.policy.deadlineAt) {
      throw new HarnessYield()
    }
    if (state.modelReservation?.id === receiptId) {
      for (const delayMs of [5_000, 15_000, 30_000]) {
        if (state.status !== 'running' || state.workflowRunId !== reference.workflowRunId
          || Date.now() >= state.policy.deadlineAt) throw new HarnessYield()
        await sleep(new Date(Math.min(Date.now() + delayMs, state.policy.deadlineAt)))
        state = await readHarnessState(reference)
        if (state.modelReservation?.id !== receiptId) break
      }
      if (state.status !== 'running' || state.workflowRunId !== reference.workflowRunId
        || Date.now() >= state.policy.deadlineAt) throw new HarnessYield()
      if (state.modelReservation?.id === receiptId) {
        await applyHarnessOperation(reference, `compaction-awaiting:${receiptId}`, {
          type: 'set_compaction',
          compaction: {
            cycleId, attemptId: receiptId, status: 'awaiting_reconciliation',
            retryCount, failureReason: 'hold_unsettled', updatedAt: Date.now(),
          },
        })
        await applyHarnessOperation(reference, `compaction-block:${receiptId}`, {
          type: 'block', blocker: {
            kind: 'stuck', question: 'Compaction is awaiting provider settlement. Full history is preserved; retry after the hold reconciles.',
          },
        })
        throw new HarnessYield()
      }
      if (state.latestReceipt?.id !== receiptId) throw new HarnessYield()
      await applyHarnessOperation(reference, `compaction-settled:${receiptId}`, {
        type: 'set_compaction',
        compaction: {
          cycleId, attemptId: receiptId, status: 'interrupted',
          retryCount, failureReason: 'stream_aborted', updatedAt: Date.now(),
        },
      })
      throw new Error('The previous summary attempt settled without a usable output.')
    }
    if (state.modelReservation) throw new HarnessYield()
    if (state.latestReceipt?.id === receiptId) {
      await applyHarnessOperation(reference, `compaction-settled:${receiptId}`, {
        type: 'set_compaction',
        compaction: {
          cycleId, attemptId: receiptId, status: 'interrupted',
          retryCount, failureReason: 'stream_aborted', updatedAt: Date.now(),
        },
      })
      throw new Error('The previous summary attempt already settled without a usable output.')
    }
    state = await waitForHarnessModelResources(reference, 0, () => readHarnessState(reference))
    if (state.policy.resourcePauseVersion === 1 && state.status !== 'running') {
      throw new HarnessYield()
    }
    if (state.status !== 'running' || state.workflowRunId !== reference.workflowRunId
      || Date.now() >= state.policy.deadlineAt || state.modelReservation) {
      throw new HarnessYield()
    }
    await applyHarnessOperation(reference, `compaction-start:${receiptId}`, {
      type: 'set_compaction',
      compaction: { cycleId, attemptId: receiptId, status: 'started', retryCount, updatedAt: Date.now() },
    })
    const limits = await readHarnessModelLimits(candidates[candidateIndex])
    const maxOutputTokens = Math.min(limits.maxOutputTokens ?? 8_192, targetSummaryTokens + 2_048)
    const instructions = harnessSummaryInstructions(targetSummaryTokens)
    try {
      const prepared = await prepare({ modelId: candidates[candidateIndex], receiptId, purpose: 'summary', options: {
        maxOutputTokens, prompt: [{ role: 'system', content: instructions }, { role: 'user', content: [{ type: 'text', text: prompt }] }],
      } })
      await applyHarnessOperation(reference, `reserve:${receiptId}`, { type: 'reserve_model', id: receiptId, maxCostMicros: prepared.estimatedCostMicros })
      const agent = new WorkflowAgent({
        model: new HarnessLanguageModel(prepared.model), instructions, tools: {}, stopWhen: isLoopFinished(), maxRetries: 0,
        maxOutputTokens, providerOptions: prepared.options.providerOptions,
        onStepEnd: async step => settle(step, receiptId, prepared),
      })
      const result = await agent.stream({ messages: [{ role: 'user', content: prompt }] })
      if ('error' in result && result.error) throw result.error
      if (result.steps.length !== 1 || result.steps[0].finishReason !== 'stop') {
        throw new Error('Context summarization did not finish; the full history was preserved.')
      }
      const summary = result.steps[0].text
      if (summary.trim().length < 200 || /^\s*(user|response) safety\s*:/im.test(summary)) {
        throw new Error('Context summarization did not produce a usable summary; the full history was preserved.')
      }
      await applyHarnessOperation(reference, `compaction-complete:${receiptId}`, {
        type: 'set_compaction',
        compaction: { cycleId, attemptId: receiptId, status: 'completed', retryCount, updatedAt: Date.now() },
      })
      return summary
    } catch (error) {
      let current = await readHarnessState(reference)
      const reservation = current.modelReservation
      const dispatch = reservation?.dispatch
      const isExactFreeHold = reservation?.id === receiptId && reservation.maxCostMicros === 0
        && dispatch?.billingReservationId === null
        && (dispatch.modelId === OPENROUTER_FREE_MODEL_ID || dispatch.modelId === OVERLAY_FREE_MODEL_ID)
      if (isExactFreeHold) {
        await applyHarnessOperation(reference, `summary-failed:${receiptId}`, {
          type: 'record_receipt',
          receipt: {
            id: receiptId, modelId: dispatch.modelId, provider: 'overlay-free-router',
            inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
            contextWindow: null, costMicros: 0, costSource: 'catalog', rejectionReason: 'summary_failed',
          },
        })
        current = await readHarnessState(reference)
      }
      if (!isExactFreeHold && current.modelReservation?.id === receiptId) {
        for (const delayMs of [5_000, 15_000, 30_000]) {
          if (current.status !== 'running' || current.workflowRunId !== reference.workflowRunId
            || Date.now() >= current.policy.deadlineAt) break
          await sleep(new Date(Math.min(Date.now() + delayMs, current.policy.deadlineAt)))
          current = await readHarnessState(reference)
          if (current.modelReservation?.id !== receiptId) break
        }
      }
      const matchingHold = current.modelReservation?.id === receiptId
      if (!['running', 'waiting_for_input'].includes(current.status)) throw error
      await applyHarnessOperation(reference, `compaction-interrupted:${receiptId}`, {
        type: 'set_compaction',
        compaction: {
          cycleId, attemptId: receiptId,
          status: matchingHold ? 'awaiting_reconciliation' : 'interrupted',
          retryCount,
          failureReason: matchingHold ? 'hold_unsettled' : 'stream_aborted',
          updatedAt: Date.now(),
        },
      })
      if (matchingHold) {
        if (current.status === 'running') {
          await applyHarnessOperation(reference, `compaction-block:${receiptId}`, {
            type: 'block', blocker: {
              kind: 'stuck',
              question: 'Compaction is awaiting provider settlement. Full history is preserved; retry after the hold reconciles.',
            },
          })
        }
        throw new HarnessYield()
      }
      throw error
    }
  }

  async function summarize(prompt: string, targetSummaryTokens: number, receiptId: string): Promise<string> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const id = attempt ? `${receiptId}:retry:1` : receiptId
      try {
        return await summarizeAttempt(prompt, targetSummaryTokens, id)
      } catch (error) {
        const state = await readHarnessState(reference)
        if (state.modelReservation?.id === id || state.compaction?.status === 'awaiting_reconciliation') {
          throw new HarnessYield()
        }
        const recovered = state.summaryRecovery?.receiptId === id
          ? await waitForHarnessModelRecovery(reference, id)
          : await capacity.wait(state, id, candidates[candidateIndex])
        if ((recovered || (state.compaction?.cycleId === receiptId
          && state.compaction.status === 'interrupted' && state.status === 'running')) && attempt === 0) continue
        throw error
      }
    }
    throw new Error('Summary attempts exhausted.')
  }

  async function verifyFinalAnswer(input: { state: HarnessSnapshot; candidate: string }) {
    const digest = await harnessCandidateDigest(input.candidate)
    let current = await waitForHarnessModelResources(reference, 0, () => readHarnessState(reference))
    if (current.status !== 'running' || current.workflowRunId !== reference.workflowRunId) {
      throw new HarnessYield()
    }
    const pendingReceiptId = current.modelReservation?.id
    if (pendingReceiptId?.startsWith('verification:')) {
      for (const delayMs of [5_000, 15_000, 30_000]) {
        if (current.status !== 'running' || current.workflowRunId !== reference.workflowRunId
          || Date.now() >= current.policy.deadlineAt) break
        await sleep(new Date(Math.min(Date.now() + delayMs, current.policy.deadlineAt)))
        current = await readHarnessState(reference)
        if (current.modelReservation?.id !== pendingReceiptId) break
      }
      if (current.modelReservation?.id === pendingReceiptId) throw new HarnessYield()
    }
    if (current.modelReservation) throw new HarnessYield()
    const previous = current.finalVerification
    if (previous?.candidateDigest === digest && previous.planRevision === current.planRevision
      && previous.evidenceRevision === current.progressRevision) {
      return { supported: previous.supported, reason: previous.reason, evidenceIds: previous.evidenceIds }
    }
    const receiptPrefix = `verification:${current.planRevision}:${current.progressRevision}:${digest}:`
    if (current.latestReceipt?.id.startsWith(receiptPrefix)) {
      return {
        supported: false,
        reason: 'The previous verification dispatch settled without a usable validation result.',
        evidenceIds: [],
      }
    }
    const receiptId = `${receiptPrefix}${current.revision}`
    const limits = await readHarnessModelLimits(candidates[candidateIndex])
    const instructions = HARNESS_ANSWER_VERIFICATION_INSTRUCTIONS
    const prepared = await prepare({
      modelId: candidates[candidateIndex],
      receiptId,
      purpose: 'verification',
      options: {
        maxOutputTokens: Math.min(1_200, limits.maxOutputTokens ?? 1_200),
        prompt: [
          { role: 'system', content: instructions },
          { role: 'user', content: [{ type: 'text', text: buildHarnessEvidenceEnvelope(current, input.candidate) }] },
        ],
      },
    })
    await applyHarnessOperation(reference, `reserve:${receiptId}`, {
      type: 'reserve_model', id: receiptId, maxCostMicros: prepared.estimatedCostMicros,
    })
    const agent = new WorkflowAgent({
      model: new HarnessLanguageModel(prepared.model),
      instructions,
      tools: {},
      stopWhen: isLoopFinished(),
      maxRetries: 0,
      maxOutputTokens: Math.min(1_200, limits.maxOutputTokens ?? 1_200),
      providerOptions: prepared.options.providerOptions,
      onStepEnd: async step => settle(step, receiptId, prepared),
    })
    const result = await agent.stream({ messages: [{
      role: 'user', content: buildHarnessEvidenceEnvelope(current, input.candidate),
    }] })
    if ('error' in result && result.error) throw result.error
    if (result.steps.length !== 1 || result.steps[0].finishReason !== 'stop') {
      throw new Error('Final answer verification did not finish.')
    }
    const raw = result.steps[0].text.trim()
    return parseHarnessVerificationResponse(raw, new Set(current.evidence.map(item => item.id)))
  }

  return {
    verifyFinalAnswer,
    recoverModelFailure: async receiptId => {
      const state = await readHarnessState(reference)
      const receipt = state.latestReceipt
      if (state.status !== 'running' || state.modelReservation || receipt?.id !== receiptId) return false
      if (state.modelRecovery?.receiptId === receiptId) {
        preparedCalls.delete(receiptId)
        return waitForHarnessModelRecovery(reference, receiptId)
      }
      if (!receipt.rejectionReason || receipt.modelId !== candidates[candidateIndex]) return false
      if (receipt.rejectionReason === 'route_capacity') {
        preparedCalls.delete(receiptId)
        return capacity.wait(state, receiptId, candidates[candidateIndex])
      }
      if (receipt.rejectionReason === 'route_interrupted') {
        preparedCalls.delete(receiptId)
        return (state.routeInterruptionCount ?? 0) <= 2
      }
      if (receipt.rejectionReason === 'summary_failed') return false
      if (receipt.rejectionReason === 'route_unavailable') {
        preparedCalls.delete(receiptId)
        return false
      }
      if (candidateIndex + 1 >= candidates.length) return false
      const from = candidates[candidateIndex++]
      preparedCalls.delete(receiptId)
      await routing?.onFallback?.({ from, to: candidates[candidateIndex], receiptId, reason: receipt.rejectionReason })
      return true
    },
    prepareModel: async request => {
      const limits = await readHarnessModelLimits(candidates[candidateIndex])
      const modelContextWindow = limits.contextWindow ?? FALLBACK_CONTEXT_WINDOW
      const contextWindow = Math.min(contextBudgetTokens, modelContextWindow)
      const maxOutputTokens = Math.min(request.settings.maxOutputTokens ?? 8_192,
        limits.maxOutputTokens ?? 8_192, Math.max(1, Math.floor(contextWindow / 4)))
      let state = await readHarnessState(reference)
      let promptMessages = request.messages
      try {
        const artifacts = new Map()
        for (const message of request.messages) {
          if (message.role !== 'tool') continue
          for (const part of message.content) {
            if (part.type !== 'tool-result' || part.toolName === 'harness_read_artifact'
              || !shouldExternalizeHarnessToolOutput(part.output)) continue
            const data = serializeHarnessArtifactOutput(part.output)
            const digest = await harnessArtifactDigest(data)
            const resource = findResourceIdentity(part.output)
            const artifact = await storeHarnessArtifact(reference, {
              artifactId: await harnessArtifactId(reference.runId, part.toolCallId, digest),
              toolCallId: part.toolCallId, toolName: part.toolName, digest, data,
              mediaPartCount: parseHarnessArtifactOutput(data).binaryParts.length,
              ...(resource ? { resource } : {}),
            })
            artifacts.set(part.toolCallId, artifact)
          }
        }
        promptMessages = externalizeOlderHarnessToolResults(request.messages, artifacts)
      } catch (_error) {
        const current = await readHarnessState(reference)
        if (current.status === 'running' && !current.modelReservation) {
          await applyHarnessOperation(reference, `artifact-unavailable:${request.receiptId}`, {
            type: 'block',
            blocker: { kind: 'stuck', question: 'Large tool context could not be stored safely. The original conversation remains intact; resume after artifact storage is available.' },
          })
        }
        throw new HarnessYield()
      }
      const fixedState: HarnessSnapshot = { ...state, workingSummary: '' }
      const fixedOverheadTokens = estimateContextTokens(buildHarnessStepInstructions(fixedState, request.instructionContext))
        + estimateContextTokens(request.toolDefinitions)
      let summaryIndex = 0
      const compacted = await compactHarnessPrompt({ messages: promptMessages, contextWindow,
        outputReserveTokens: maxOutputTokens, fixedOverheadTokens, previousSummary: state.workingSummary,
        estimatePromptTokens: estimateHarnessPromptTokens,
        generateSummaryText: ({ prompt, targetSummaryTokens }) => summarize(prompt, targetSummaryTokens,
          `summary:${request.receiptId}:${summaryIndex++}`),
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
        const fallbackMaxOutputTokens = Math.min(request.settings.maxOutputTokens ?? 8_192,
          limits.maxOutputTokens ?? 8_192, Math.max(1, Math.floor(modelContextWindow / 4)))
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
        state = await readHarnessState(reference)
        instructions = buildHarnessStepInstructions(state, request.instructionContext)
      }
      const prepared = await prepare({ modelId: candidates[candidateIndex], receiptId: request.receiptId, purpose: 'response', options: {
        ...request.settings, maxOutputTokens: responseMaxOutputTokens, tools: request.toolDefinitions,
        prompt: [{ role: 'system', content: instructions }, ...messages],
      } })
      preparedCalls.set(request.receiptId, prepared)
      const reasoning = isKimiK3ModelId(candidates[candidateIndex]) && request.settings.reasoning !== undefined
        ? 'xhigh'
        : request.settings.reasoning
      return {
        messages, instructions, activeToolNames: request.toolNames,
        estimatedCostMicros: prepared.estimatedCostMicros, model: prepared.model,
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
      preparedCalls.delete(receiptId)
    },
  }
}
