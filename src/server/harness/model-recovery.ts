import type { WorkflowAgentStreamResult } from '@ai-sdk/workflow'
import type { ModelMessage, StepResult, ToolSet } from 'ai'
import { sleep } from 'workflow'
import type { HarnessSnapshot } from '@overlay/agent-runtime/harness-state'
import { createHarnessDiagnostic, harnessDiagnosticMessage, stableHarnessDiagnosticId } from '@overlay/agent-runtime/harness-diagnostic'
import type { HarnessApprovalRequest, HarnessExecutionPorts } from './ports'
import { readHarnessState, type HarnessExecutionReference } from './state-steps'

export class HarnessYield extends Error {
  readonly name = 'HarnessYield'
  constructor(readonly receiptId?: string) {
    super(receiptId ? `HARNESS_SAFE_RESOURCE_PAUSE:${receiptId}` : 'HARNESS_SAFE_YIELD')
  }
}

type HarnessInvocationState = {
  messages: ModelMessage[]
  steps: StepResult<ToolSet>[]
  preparedReceiptId: string
  modelCall: number
}

type HarnessInvocationResult = HarnessInvocationState & {
  pending: HarnessApprovalRequest[]
  recovered: boolean
}

export async function runHarnessModelInvocation(
  stream: () => Promise<WorkflowAgentStreamResult<ToolSet>>,
  readState: () => HarnessInvocationState,
  pendingFor: (result: WorkflowAgentStreamResult<ToolSet>) => HarnessApprovalRequest[],
  recover: HarnessExecutionPorts['recoverModelFailure'],
  confirmYield: (receiptId: string) => Promise<boolean>,
  confirmBlocked?: () => Promise<boolean>,
): Promise<HarnessInvocationResult> {
  try {
    const result = await stream()
    if ('error' in result && result.error) throw result.error
    return { ...readState(), messages: result.messages, steps: result.steps, pending: pendingFor(result), recovered: false }
  } catch (error) {
    const state = readState()
    const message = error && typeof error === 'object' && 'message' in error
      && typeof error.message === 'string' ? error.message : ''
    const yieldedReceiptId = /(?:^|[^\w])HARNESS_SAFE_RESOURCE_PAUSE:((?:model:[0-9]+|summary:model:[0-9]+:[0-9]+(?::retry:[0-9]+)?))(?:$|[^\w:])/.exec(message)?.[1]
    const summaryForPrepared = yieldedReceiptId?.startsWith(`summary:${state.preparedReceiptId}:`) === true
    if (yieldedReceiptId && (yieldedReceiptId === state.preparedReceiptId || summaryForPrepared)
      && await confirmYield(yieldedReceiptId)) return {
      ...state,
      pending: [],
      recovered: true,
      modelCall: yieldedReceiptId === state.preparedReceiptId && state.preparedReceiptId === `model:${state.modelCall}`
        ? state.modelCall + 1 : state.modelCall,
    }
    if (/(?:^|[^\w])HARNESS_SAFE_YIELD(?:$|[^\w:])/.test(message) && await confirmBlocked?.()) {
      return { ...state, pending: [], recovered: false }
    }
    if (!await recover?.(state.preparedReceiptId)) throw error
    return {
      ...state,
      pending: [],
      recovered: true,
      modelCall: state.preparedReceiptId === `model:${state.modelCall}` ? state.modelCall + 1 : state.modelCall,
    }
  }
}

export async function waitForHarnessModelRecovery(reference: HarnessExecutionReference, receiptId: string): Promise<boolean> {
  const state = await readHarnessState(reference)
  const recoveryKey = receiptId.startsWith('summary:') ? 'summaryRecovery' : 'modelRecovery'
  const recovery = state[recoveryKey]
  if (state.workflowRunId !== reference.workflowRunId || state.status !== 'running' || state.modelReservation
    || state.latestReceipt?.id !== receiptId || recovery?.receiptId !== receiptId) return false
  await sleep(new Date(recovery.nextRetryAt))
  const resumed = await readHarnessState(reference)
  return resumed.workflowRunId === reference.workflowRunId && resumed.status === 'running'
    && !resumed.modelReservation && resumed.latestReceipt?.id === receiptId
    && resumed[recoveryKey]?.receiptId === receiptId
}

export async function terminateOnProviderFailure(
  state: HarnessSnapshot,
  finishReason: string | undefined,
  ports: HarnessExecutionPorts,
  segment: number,
): Promise<boolean> {
  if (!['completed', 'failed', 'cancelled'].includes(state.status)
    && (finishReason === 'content-filter' || finishReason === 'error' || finishReason === 'other')) {
    const operationId = state.latestReceipt?.id ?? `provider-failure:${segment}`
    const diagnostic = createHarnessDiagnostic({
      diagnosticId: stableHarnessDiagnosticId(state.runId, operationId, state.revision),
      code: finishReason === 'content-filter' ? 'PROVIDER_REJECTED' : 'PROVIDER_UNAVAILABLE',
      stage: 'model',
      operationId,
      occurredAt: Date.now(),
    })
    await ports.apply(`provider-failure:${segment}`, {
      type: 'terminate', status: 'failed', reason: harnessDiagnosticMessage(diagnostic), diagnostic,
    })
    return true
  }
  return false
}
