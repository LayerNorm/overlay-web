import { createHook, getWorkflowMetadata, sleep } from 'workflow'
import { advanceRemoteRun, claimRemoteRunCoordinator, readRemoteRun, restoreStoppedRemoteRun, stopUnreachableRemoteRun, wakeRemoteRun } from '@/server/agents/remote-agent-run-lifecycle'

/** External execution stays in the host. Only short, repeatable lifecycle operations are steps. */
export async function remoteAgentRunWorkflow(input: { runId: string; generation: number }) {
  'use workflow'
  const { workflowRunId } = getWorkflowMetadata()
  const owner = { ...input, coordinatorId: workflowRunId }
  using hook = createHook<{ runId: string; revision: number }>({ token: `remote-run:${input.runId}:${input.generation}:${workflowRunId}` })
  // createHook alone is lazy in 4.8.9; this suspension commits hook registration before dispatch.
  if (await hook.getConflict()) return
  if (!await claimRemoteRunCoordinator(owner)) return
  await wakeRemoteRun(owner)
  const signals = hook[Symbol.asyncIterator]()
  let nextSignal = signals.next()
  for (;;) {
    const state = await advanceRemoteRun(owner)
    if (!state) return
    if (state.phase === 'completed' || state.phase === 'cancelled' || state.phase === 'failed') return
    // A delivered cancel notification may precede stop eligibility. Durable timer
    // passes retry the proof check after that notification is consumed.
    if (state.phase === 'cancelling') await stopUnreachableRemoteRun(input.runId)
    if (state.phase === 'needs_attention' || state.phase === 'recovering') await restoreStoppedRemoteRun(owner)
    // Read after registration/each signal. An early decision or lost callback is in canonical state.
    const snapshot = await readRemoteRun(input.runId)
    if (!snapshot || snapshot.lifecycle.coordinatorId !== workflowRunId) return
    const result = await Promise.race([nextSignal.then(() => 'signal' as const), sleep('30s').then(() => 'timeout' as const)])
    if (result === 'signal') nextSignal = signals.next()
  }
}
