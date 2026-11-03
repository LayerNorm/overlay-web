import type { LanguageModelV4CallOptions } from '@ai-sdk/provider'
import { WorkflowAgent } from '@ai-sdk/workflow'
import { isLoopFinished } from 'ai'
import { sleep } from 'workflow'
import type { HarnessSnapshot } from '@overlay/agent-runtime/harness-state'
import { HARNESS_ANSWER_VERIFICATION_INSTRUCTIONS } from './continuity-policy'
import { buildHarnessEvidenceEnvelope, harnessCandidateDigest, parseHarnessVerificationResponse } from './continuity'
import type { HarnessExecutionPorts } from './ports'
import { HarnessLanguageModel } from './secure-model'
import { applyHarnessOperation, readHarnessState, type HarnessExecutionReference } from './state-steps'
import { readHarnessModelLimits } from './model-preparation'
import { HarnessYield } from './model-recovery'
import { waitForHarnessModelResources } from './resource-boundary'
import { OPENROUTER_FREE_MODEL_ID, OVERLAY_FREE_MODEL_ID } from '@/shared/ai/gateway/overlay-free-policy'
import type { HarnessModelPurpose, PreparedHarnessModel } from './model-port-types'

type ModelStep = Parameters<HarnessExecutionPorts['recordModelStep']>[0]

type VerificationDependencies = {
  reference: HarnessExecutionReference
  prepare: (request: {
    modelId: string
    receiptId: string
    purpose: HarnessModelPurpose
    options: LanguageModelV4CallOptions
  }) => Promise<PreparedHarnessModel>
  settle: (step: ModelStep, receiptId: string, prepared: PreparedHarnessModel) => Promise<void>
  getCurrentModelId: () => string
}

type VerificationResult = {
  supported: boolean
  reason: string
  evidenceIds: string[]
}

function assertVerificationRunnable(reference: HarnessExecutionReference, state: HarnessSnapshot): void {
  if (state.status !== 'running' || state.workflowRunId !== reference.workflowRunId
    || Date.now() >= state.policy.deadlineAt) throw new HarnessYield()
}

async function waitForExistingVerificationHold(
  dependencies: VerificationDependencies,
  state: HarnessSnapshot,
): Promise<HarnessSnapshot> {
  const pendingReceiptId = state.modelReservation?.id
  if (!pendingReceiptId?.startsWith('verification:')) return state
  let current = state
  for (const delayMs of [5_000, 15_000, 30_000]) {
    assertVerificationRunnable(dependencies.reference, current)
    await sleep(new Date(Math.min(Date.now() + delayMs, current.policy.deadlineAt)))
    current = await readHarnessState(dependencies.reference)
    if (current.modelReservation?.id !== pendingReceiptId) break
  }
  assertVerificationRunnable(dependencies.reference, current)
  if (current.modelReservation?.id === pendingReceiptId) throw new HarnessYield()
  return current
}

function isExactFreeVerificationHold(state: HarnessSnapshot, receiptId: string): boolean {
  const reservation = state.modelReservation
  const dispatch = reservation?.dispatch
  return reservation?.id === receiptId && reservation.maxCostMicros === 0
    && dispatch?.billingReservationId === null
    && (dispatch.modelId === OPENROUTER_FREE_MODEL_ID || dispatch.modelId === OVERLAY_FREE_MODEL_ID)
}

async function runVerificationStream(
  prepared: PreparedHarnessModel,
  dependencies: VerificationDependencies,
  receiptId: string,
  instructions: string,
  prompt: string,
  maxOutputTokens: number,
): Promise<string> {
  const agent = new WorkflowAgent({
    model: new HarnessLanguageModel(prepared.model),
    instructions,
    tools: {},
    stopWhen: isLoopFinished(),
    maxRetries: 0,
    maxOutputTokens,
    providerOptions: prepared.options.providerOptions,
    onStepEnd: async step => dependencies.settle(step, receiptId, prepared),
  })
  const result = await agent.stream({ messages: [{ role: 'user', content: prompt }] })
  if ('error' in result && result.error) throw result.error
  if (result.steps.length !== 1 || result.steps[0].finishReason !== 'stop') {
    throw new Error('Final answer verification did not finish.')
  }
  return result.steps[0].text.trim()
}

async function reconcileVerificationFailure(
  dependencies: VerificationDependencies,
  receiptId: string,
  error: unknown,
): Promise<VerificationResult> {
  let after = await readHarnessState(dependencies.reference)
  const hold = after.modelReservation
  const dispatch = hold?.dispatch
  if (isExactFreeVerificationHold(after, receiptId) && dispatch) {
    await applyHarnessOperation(dependencies.reference, `verification-failed:${receiptId}`, {
      type: 'record_receipt',
      receipt: {
        id: receiptId, modelId: dispatch.modelId, provider: 'overlay-free-router',
        inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0,
        cacheWriteTokens: 0, contextWindow: null, costMicros: 0, costSource: 'catalog',
        rejectionReason: 'verification_failed',
      },
    })
    return { supported: false, reason: 'Final-answer verification was interrupted; no answer was accepted.', evidenceIds: [] }
  }
  if (hold?.id === receiptId) {
    for (const delayMs of [5_000, 15_000, 30_000]) {
      assertVerificationRunnable(dependencies.reference, after)
      await sleep(new Date(Math.min(Date.now() + delayMs, after.policy.deadlineAt)))
      after = await readHarnessState(dependencies.reference)
      if (after.modelReservation?.id !== receiptId) break
    }
    assertVerificationRunnable(dependencies.reference, after)
    if (after.modelReservation?.id === receiptId) throw new HarnessYield()
  }
  if (after.latestReceipt?.id === receiptId) {
    return { supported: false, reason: 'Final-answer verification settled without a usable validation result.', evidenceIds: [] }
  }
  throw error
}

export function createHarnessVerificationPort(dependencies: VerificationDependencies): {
  verifyFinalAnswer: (input: { state: HarnessSnapshot; candidate: string }) => Promise<VerificationResult>
} {
  async function verifyFinalAnswer(input: { state: HarnessSnapshot; candidate: string }): Promise<VerificationResult> {
    if (input.candidate.length > 16_000) {
      return {
        supported: false,
        reason: 'The proposed answer exceeds the verification limit. Produce a shorter answer that can be checked in full.',
        evidenceIds: [],
      }
    }
    const digest = await harnessCandidateDigest(input.candidate)
    let current = await waitForHarnessModelResources(dependencies.reference, 0, () => readHarnessState(dependencies.reference))
    assertVerificationRunnable(dependencies.reference, current)
    current = await waitForExistingVerificationHold(dependencies, current)
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
    const limits = await readHarnessModelLimits(dependencies.getCurrentModelId())
    const instructions = `${HARNESS_ANSWER_VERIFICATION_INSTRUCTIONS}\nThe envelope explicitly marks omitted observations and truncated summaries. These are incomplete evidence, not proof of absence. Reject any material claim that needs missing details.`
    const prompt = buildHarnessEvidenceEnvelope(current, input.candidate)
    const maxOutputTokens = Math.min(1_200, limits.maxOutputTokens ?? 1_200)
    const prepared = await dependencies.prepare({
      modelId: dependencies.getCurrentModelId(),
      receiptId,
      purpose: 'verification',
      options: {
        maxOutputTokens,
        prompt: [
          { role: 'system', content: instructions },
          { role: 'user', content: [{ type: 'text', text: prompt }] },
        ],
      },
    })
    await applyHarnessOperation(dependencies.reference, `reserve:${receiptId}`, {
      type: 'reserve_model', id: receiptId, maxCostMicros: prepared.estimatedCostMicros,
    })
    try {
      const raw = await runVerificationStream(prepared, dependencies, receiptId, instructions, prompt, maxOutputTokens)
      return parseHarnessVerificationResponse(raw, new Set(current.evidence.slice(-48).map(item => item.id)))
    } catch (error) {
      return reconcileVerificationFailure(dependencies, receiptId, error)
    }
  }

  return { verifyFinalAnswer }
}
