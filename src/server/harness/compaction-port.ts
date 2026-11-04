import type { LanguageModelV4CallOptions } from '@ai-sdk/provider'
import { WorkflowAgent } from '@ai-sdk/workflow'
import { isLoopFinished } from 'ai'
import { sleep } from 'workflow'
import { effectiveHarnessDeadlineAt, type HarnessSnapshot } from '@overlay/agent-runtime/harness-state'
import { estimateContextTokens } from '@/server/chat/context-compaction-core'
import { harnessSummaryInstructions } from './continuity-policy'
import type { HarnessExecutionPorts } from './ports'
import { HarnessLanguageModel } from './secure-model'
import { applyHarnessOperation, readHarnessState, type HarnessExecutionReference } from './state-steps'
import { readHarnessModelLimits } from './model-preparation'
import { HarnessYield } from './model-recovery'
import { waitForHarnessModelRecovery } from './model-recovery'
import { waitForHarnessModelResources } from './resource-boundary'
import type { HarnessModelPurpose, PreparedHarnessModel } from './model-port-types'

type ModelStep = Parameters<HarnessExecutionPorts['recordModelStep']>[0]

type CompactionDependencies = {
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

type SummaryAttempt = {
  prompt: string
  targetSummaryTokens: number
  receiptId: string
  cycleId: string
  retryCount: number
}

function assertSummaryRunnable(reference: HarnessExecutionReference, state: HarnessSnapshot): void {
  if (state.status !== 'running' || state.workflowRunId !== reference.workflowRunId
    || Date.now() >= effectiveHarnessDeadlineAt(state.policy)) throw new HarnessYield()
}

async function reconcileLateSummaryReceipt(
  reference: HarnessExecutionReference,
  state: HarnessSnapshot,
): Promise<HarnessSnapshot> {
  if (state.compaction?.status !== 'awaiting_reconciliation'
    || state.modelReservation?.id === state.compaction.attemptId
    || state.latestReceipt?.id !== state.compaction.attemptId) return state
  await applyHarnessOperation(reference, `compaction-late-receipt:${state.compaction.attemptId}`, {
    type: 'set_compaction',
    compaction: {
      cycleId: state.compaction.cycleId,
      attemptId: state.compaction.attemptId,
      status: 'interrupted',
      retryCount: state.compaction.retryCount,
      failureReason: 'stream_aborted',
      updatedAt: Date.now(),
    },
  })
  return readHarnessState(reference)
}

async function pollExistingSummaryHold(
  reference: HarnessExecutionReference,
  state: HarnessSnapshot,
  attempt: SummaryAttempt,
  cycleId: string,
  retryCount: number,
): Promise<HarnessSnapshot> {
  if (state.modelReservation?.id !== attempt.receiptId) return state
  let current = state
  for (const delayMs of [5_000, 15_000, 30_000]) {
    assertSummaryRunnable(reference, current)
    await sleep(new Date(Math.min(Date.now() + delayMs, effectiveHarnessDeadlineAt(current.policy))))
    current = await readHarnessState(reference)
    if (current.modelReservation?.id !== attempt.receiptId) break
  }
  assertSummaryRunnable(reference, current)
  if (current.modelReservation?.id === attempt.receiptId) {
    await applyHarnessOperation(reference, `compaction-awaiting:${attempt.receiptId}`, {
      type: 'set_compaction',
      compaction: {
        cycleId, attemptId: attempt.receiptId, status: 'awaiting_reconciliation',
        retryCount, failureReason: 'hold_unsettled', updatedAt: Date.now(),
      },
    })
    await applyHarnessOperation(reference, `compaction-block:${attempt.receiptId}`, {
      type: 'block', blocker: {
        kind: 'stuck', question: 'Compaction is awaiting provider settlement. Full history is preserved; retry after the hold reconciles.',
      },
    })
    throw new HarnessYield()
  }
  if (current.latestReceipt?.id !== attempt.receiptId) throw new HarnessYield()
  await applyHarnessOperation(reference, `compaction-settled:${attempt.receiptId}`, {
    type: 'set_compaction',
    compaction: {
      cycleId, attemptId: attempt.receiptId, status: 'interrupted',
      retryCount, failureReason: 'stream_aborted', updatedAt: Date.now(),
    },
  })
  throw new Error('The previous summary attempt settled without a usable output.')
}

async function rejectAlreadySettledSummary(
  reference: HarnessExecutionReference,
  state: HarnessSnapshot,
  attempt: SummaryAttempt,
): Promise<void> {
  if (state.modelReservation || state.latestReceipt?.id !== attempt.receiptId) return
  await applyHarnessOperation(reference, `compaction-settled:${attempt.receiptId}`, {
    type: 'set_compaction',
    compaction: {
      cycleId: attempt.cycleId,
      attemptId: attempt.receiptId,
      status: 'interrupted',
      retryCount: attempt.retryCount,
      failureReason: 'stream_aborted',
      updatedAt: Date.now(),
    },
  })
  throw new Error('The previous summary attempt already settled without a usable output.')
}

async function waitForSummaryResources(
  reference: HarnessExecutionReference,
): Promise<HarnessSnapshot> {
  const state = await waitForHarnessModelResources(reference, 0, () => readHarnessState(reference))
  if (state.policy.resourcePauseVersion === 1 && state.status !== 'running') throw new HarnessYield()
  assertSummaryRunnable(reference, state)
  if (state.modelReservation) throw new HarnessYield()
  return state
}

function validateSummary(summary: string, prompt: string, targetSummaryTokens: number): void {
  const summaryTokens = estimateContextTokens(summary)
  const sourceTokens = estimateContextTokens(prompt)
  if (summary.trim().length < 200 || summaryTokens > targetSummaryTokens
    || summaryTokens >= sourceTokens || /^\s*(user|response) safety\s*:/im.test(summary)) {
    throw new Error('Context summarization did not produce a usable summary; the full history was preserved.')
  }
}

async function invokeSummary(
  dependencies: CompactionDependencies,
  attempt: SummaryAttempt,
  modelId: string,
  limits: Awaited<ReturnType<typeof readHarnessModelLimits>>,
): Promise<string> {
  const maxOutputTokens = Math.min(limits.maxOutputTokens ?? 8_192, attempt.targetSummaryTokens + 2_048)
  const instructions = harnessSummaryInstructions(attempt.targetSummaryTokens)
  const prepared = await dependencies.prepare({
    modelId,
    receiptId: attempt.receiptId,
    purpose: 'summary',
    options: {
      maxOutputTokens,
      prompt: [{ role: 'system', content: instructions }, { role: 'user', content: [{ type: 'text', text: attempt.prompt }] }],
    },
  })
  await applyHarnessOperation(dependencies.reference, `reserve:${attempt.receiptId}`, {
    type: 'reserve_model', id: attempt.receiptId, maxCostMicros: prepared.estimatedCostMicros,
  })
  const agent = new WorkflowAgent({
    model: new HarnessLanguageModel(prepared.model), instructions, tools: {}, stopWhen: isLoopFinished(), maxRetries: 0,
    maxOutputTokens, providerOptions: prepared.options.providerOptions,
    onStepEnd: async step => dependencies.settle(step, attempt.receiptId, prepared),
  })
  const result = await agent.stream({ messages: [{ role: 'user', content: attempt.prompt }] })
  if ('error' in result && result.error) throw result.error
  if (result.steps.length !== 1 || result.steps[0].finishReason !== 'stop') {
    throw new Error('Context summarization did not finish; the full history was preserved.')
  }
  const summary = result.steps[0].text
  try {
    validateSummary(summary, attempt.prompt, attempt.targetSummaryTokens)
  } catch (error) {
    await applyHarnessOperation(dependencies.reference, `compaction-validation:${attempt.receiptId}`, {
      type: 'set_compaction',
      compaction: {
        cycleId: attempt.cycleId,
        attemptId: attempt.receiptId,
        status: 'interrupted',
        retryCount: attempt.retryCount,
        failureReason: 'validation_failed',
        updatedAt: Date.now(),
      },
    })
    throw error
  }
  await applyHarnessOperation(dependencies.reference, `compaction-complete:${attempt.receiptId}`, {
    type: 'set_compaction',
    compaction: {
      cycleId: attempt.cycleId,
      attemptId: attempt.receiptId,
      status: 'completed',
      retryCount: attempt.retryCount,
      updatedAt: Date.now(),
    },
  })
  return summary
}

async function reconcileSummaryFailure(
  dependencies: CompactionDependencies,
  attempt: SummaryAttempt,
  cycleId: string,
  retryCount: number,
  error: unknown,
): Promise<never> {
  let current = await readHarnessState(dependencies.reference)
  if (current.modelReservation?.id === attempt.receiptId) {
    for (const delayMs of [5_000, 15_000, 30_000]) {
      if (current.status !== 'running' || current.workflowRunId !== dependencies.reference.workflowRunId
        || Date.now() >= effectiveHarnessDeadlineAt(current.policy)) break
      await sleep(new Date(Math.min(Date.now() + delayMs, effectiveHarnessDeadlineAt(current.policy))))
      current = await readHarnessState(dependencies.reference)
      if (current.modelReservation?.id !== attempt.receiptId) break
    }
  }
  const matchingHold = current.modelReservation?.id === attempt.receiptId
  if (!['running', 'waiting_for_input'].includes(current.status)) throw error
  if (current.compaction?.attemptId !== attempt.receiptId || current.compaction.status !== 'interrupted') {
    await applyHarnessOperation(dependencies.reference, `compaction-interrupted:${attempt.receiptId}`, {
      type: 'set_compaction',
      compaction: {
        cycleId, attemptId: attempt.receiptId,
        status: matchingHold ? 'awaiting_reconciliation' : 'interrupted',
        retryCount,
        failureReason: matchingHold ? 'hold_unsettled' : 'provider_error',
        updatedAt: Date.now(),
      },
    })
  }
  if (matchingHold) {
    if (current.status === 'running') {
      await applyHarnessOperation(dependencies.reference, `compaction-block:${attempt.receiptId}`, {
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

export function createHarnessCompactionPort(dependencies: CompactionDependencies): {
  summarize: (prompt: string, targetSummaryTokens: number, receiptId: string) => Promise<string>
} {
  async function summarizeAttempt(attempt: SummaryAttempt): Promise<string> {
    let state = await readHarnessState(dependencies.reference)
    assertSummaryRunnable(dependencies.reference, state)
    state = await reconcileLateSummaryReceipt(dependencies.reference, state)
    await pollExistingSummaryHold(dependencies.reference, state, attempt, attempt.cycleId, attempt.retryCount)
    if (state.modelReservation) throw new HarnessYield()
    await rejectAlreadySettledSummary(dependencies.reference, state, attempt)
    state = await waitForSummaryResources(dependencies.reference)
    await applyHarnessOperation(dependencies.reference, `compaction-start:${attempt.receiptId}`, {
      type: 'set_compaction',
      compaction: {
        cycleId: attempt.cycleId, attemptId: attempt.receiptId, status: 'started',
        retryCount: attempt.retryCount, updatedAt: Date.now(),
      },
    })
    const modelId = dependencies.getCurrentModelId()
    const limits = await readHarnessModelLimits(modelId)
    try {
      return await invokeSummary(dependencies, attempt, modelId, limits)
    } catch (error) {
      return reconcileSummaryFailure(dependencies, attempt, attempt.cycleId, attempt.retryCount, error)
    }
  }

  async function summarize(prompt: string, targetSummaryTokens: number, receiptId: string): Promise<string> {
    const retryMatch = /:retry:(\d+)$/.exec(receiptId)
    const startingRetryCount = retryMatch ? Number(retryMatch[1]) : 0
    if (startingRetryCount > 1) throw new Error('Summary attempts exhausted.')
    const cycleId = retryMatch ? receiptId.slice(0, retryMatch.index) : receiptId
    for (let retryCount = startingRetryCount; retryCount < 2; retryCount++) {
      const id = retryCount ? `${cycleId}:retry:${retryCount}` : cycleId
      try {
        return await summarizeAttempt({
          prompt,
          targetSummaryTokens,
          receiptId: id,
          cycleId,
          retryCount,
        })
      } catch (error) {
        const state = await readHarnessState(dependencies.reference)
        if (state.modelReservation?.id === id || state.compaction?.status === 'awaiting_reconciliation') {
          throw new HarnessYield()
        }
        const recovered = state.summaryRecovery?.receiptId === id
          ? await waitForHarnessModelRecovery(dependencies.reference, id)
          : false
        if ((recovered || (state.compaction?.cycleId === cycleId
          && state.compaction.status === 'interrupted' && state.status === 'running')) && retryCount === 0) continue
        throw error
      }
    }
    throw new Error('Summary attempts exhausted.')
  }

  return { summarize }
}
