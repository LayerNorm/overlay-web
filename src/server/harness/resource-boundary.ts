import { FatalError, sleep } from 'workflow'
import { assertSafeResourceMicros } from '@overlay/agent-runtime/harness-resource'
import { reservedHarnessCostMicros, type HarnessSnapshot } from '@overlay/agent-runtime/harness-state'
import { consumeHarnessResourceWait, createHarnessResourceToken, publishHarnessResourceWait } from './resource-wait-steps'
import { waitForHarnessResources, type HarnessResourceWaitPorts } from './resource-waits'
import type { HarnessExecutionReference } from './state-steps'

type ResourceBoundaryPorts = HarnessResourceWaitPorts & { token: typeof createHarnessResourceToken }
const resourcePorts: ResourceBoundaryPorts = {
  publish: publishHarnessResourceWait, consume: consumeHarnessResourceWait, token: createHarnessResourceToken,
}

function isHumanWait(state: HarnessSnapshot, kind?: 'input' | 'approval'): boolean {
  return (kind !== 'approval' && state.status === 'waiting_for_input'
    && (state.blocker?.kind === 'input' || state.blocker?.kind === 'stuck'))
    || (kind !== 'input' && state.status === 'waiting_for_approval' && state.blocker?.kind === 'approval')
}

async function waitForHarnessBoundaryResources(
  reference: HarnessExecutionReference,
  requiredCostMicros: number,
  read: () => Promise<HarnessSnapshot>,
  resources: ResourceBoundaryPorts,
  humanWait?: 'input' | 'approval',
): Promise<HarnessSnapshot> {
  assertSafeResourceMicros(requiredCostMicros, 'Required cost')
  while (true) {
    const state = await read()
    if (state.policy.resourcePauseVersion !== 1) return state
    if (state.policy.deadlineAt === null || state.policy.maxCostMicros === null) {
      throw new FatalError('HARNESS_RESOURCE_LIMITS_INVALID')
    }
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
    if (humanWait ? !isHumanWait(state, humanWait) : state.status !== 'running') return state
    const commitments = state.usage.costMicros + reservedHarnessCostMicros(state) + requiredCostMicros
    assertSafeResourceMicros(commitments, 'Current commitments and forecast')
    const reason = Date.now() >= state.policy.deadlineAt ? 'time'
      : !humanWait && commitments > state.policy.maxCostMicros ? 'model_spend' : undefined
    if (!reason) return state
    const identity = { ...reference, expectedRevision: state.revision }
    const token = await resources.token(identity)
    const result = await waitForHarnessResources({ ...identity, token, reason, requiredCostMicros }, resources)
    if (result === 'retry') await sleep('1s')
  }
}

export function waitForHarnessModelResources(
  reference: HarnessExecutionReference,
  requiredCostMicros: number,
  read: () => Promise<HarnessSnapshot>,
  resources: ResourceBoundaryPorts = resourcePorts,
): Promise<HarnessSnapshot> {
  return waitForHarnessBoundaryResources(reference, requiredCostMicros, read, resources)
}

export async function waitForHarnessHumanReply<T>(
  reference: HarnessExecutionReference,
  pending: PromiseLike<T>,
  kind: 'input' | 'approval',
  read: () => Promise<HarnessSnapshot>,
  resources: ResourceBoundaryPorts = resourcePorts,
): Promise<T | null> {
  let received: { value: T } | { error: unknown } | undefined
  const reply = Promise.resolve(pending).then(
    value => { received = { value } },
    error => { received = { error } },
  )
  while (true) {
    const state = await waitForHarnessBoundaryResources(reference, 0, read, resources, kind)
    if (['completed', 'failed', 'cancelled'].includes(state.status)) return null
    if (state.policy.resourcePauseVersion !== 1 || !isHumanWait(state, kind)) {
      throw new FatalError('HARNESS_HUMAN_WAIT_CHANGED')
    }
    if (state.policy.deadlineAt === null || state.policy.maxCostMicros === null) {
      throw new FatalError('HARNESS_RESOURCE_LIMITS_INVALID')
    }
    if (received) {
      if ('error' in received) throw received.error
      return received.value
    }
    await Promise.race([reply, sleep(new Date(state.policy.deadlineAt))])
  }
}
