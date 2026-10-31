import type { WorkflowAgentStreamResult } from '@ai-sdk/workflow'
import type { ModelMessage, StepResult, ToolSet } from 'ai'
import { sleep } from 'workflow'
import type { HarnessSnapshot } from '@overlay/agent-runtime/harness-state'
import type { HarnessApprovalRequest, HarnessExecutionPorts } from './ports'
import { readHarnessState, type HarnessExecutionReference } from './state-steps'

export class HarnessYield extends Error {}

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
): Promise<HarnessInvocationResult> {
  try {
    const result = await stream()
    if ('error' in result && result.error) throw result.error
    return { ...readState(), messages: result.messages, steps: result.steps, pending: pendingFor(result), recovered: false }
  } catch (error) {
    const state = readState()
    if (error instanceof HarnessYield) return { ...state, pending: [], recovered: false }
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
  const recovery = state.modelRecovery
  if (state.workflowRunId !== reference.workflowRunId || state.status !== 'running' || state.modelReservation
    || state.latestReceipt?.id !== receiptId || recovery?.receiptId !== receiptId) return false
  await sleep(new Date(recovery.nextRetryAt))
  const resumed = await readHarnessState(reference)
  return resumed.workflowRunId === reference.workflowRunId && resumed.status === 'running'
    && !resumed.modelReservation && resumed.latestReceipt?.id === receiptId
    && resumed.modelRecovery?.receiptId === receiptId
}

export async function terminateOnProviderFailure(
  state: HarnessSnapshot,
  finishReason: string | undefined,
  ports: HarnessExecutionPorts,
  segment: number,
): Promise<boolean> {
  if (!['completed', 'failed', 'cancelled'].includes(state.status)
    && (finishReason === 'content-filter' || finishReason === 'error' || finishReason === 'other')) {
    await ports.apply(`provider-failure:${segment}`, {
      type: 'terminate', status: 'failed', reason: `The provider could not finish the response (${finishReason}).`,
    })
    return true
  }
  return false
}
