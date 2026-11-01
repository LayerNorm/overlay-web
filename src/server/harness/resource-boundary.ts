import { FatalError, sleep } from 'workflow'
import { assertSafeResourceMicros } from '@overlay/agent-runtime/harness-resource'
import { reservedHarnessCostMicros, type HarnessSnapshot } from '@overlay/agent-runtime/harness-state'
import { consumeHarnessResourceWait, createHarnessResourceToken, publishHarnessResourceWait } from './resource-wait-steps'
import { waitForHarnessResources, type HarnessResourceWaitPorts } from './resource-waits'
import type { HarnessExecutionReference } from './state-steps'

export async function waitForHarnessModelResources(
  reference: HarnessExecutionReference,
  requiredCostMicros: number,
  read: () => Promise<HarnessSnapshot>,
  resources: HarnessResourceWaitPorts & { token: typeof createHarnessResourceToken } = {
    publish: publishHarnessResourceWait, consume: consumeHarnessResourceWait, token: createHarnessResourceToken,
  },
): Promise<HarnessSnapshot> {
  assertSafeResourceMicros(requiredCostMicros, 'Required cost')
  while (true) {
    const state = await read()
    if (state.policy.resourcePauseVersion !== 1) return state
    if (state.runId !== reference.runId || state.workflowRunId !== reference.workflowRunId
      || state.policy.actorUserId !== reference.actorUserId || state.parentRunId || state.rootRunId !== reference.runId
      || state.policy.maxDepth !== 0 || state.policy.maxParallelChildren !== 0 || state.children.length) {
      throw new FatalError('HARNESS_RESOURCE_BOUNDARY_NOT_OWNED')
    }
    if (['completed', 'failed', 'cancelled'].includes(state.status)) return state
    if (state.status === 'waiting_for_resources') {
      if (!state.resourceRequestToken) throw new FatalError('HARNESS_RESOURCE_WAIT_MISSING_TOKEN')
      await waitForHarnessResources({ ...reference, token: state.resourceRequestToken }, resources)
      continue
    }
    if (state.status !== 'running') return state
    const commitments = state.usage.costMicros + reservedHarnessCostMicros(state) + requiredCostMicros
    assertSafeResourceMicros(commitments, 'Current commitments and forecast')
    const reason = Date.now() >= state.policy.deadlineAt ? 'time'
      : commitments > state.policy.maxCostMicros ? 'model_spend' : undefined
    if (!reason) return state
    const identity = { ...reference, expectedRevision: state.revision }
    const token = await resources.token(identity)
    const result = await waitForHarnessResources({ ...identity, token, reason, requiredCostMicros }, resources)
    if (result === 'retry') await sleep('1s')
  }
}
