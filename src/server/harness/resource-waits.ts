import { createHook, FatalError, sleep } from 'workflow'
import type { HarnessResourcePauseInput, HarnessResourceRequestReference } from '@overlay/agent-runtime/harness-resource'

export type HarnessResourcePublication = 'paused' | 'retry' | 'inactive'
export type HarnessResourceConsumption = 'pending' | 'consumed' | 'inactive'

export type HarnessResourceWaitPorts = {
  publish(input: HarnessResourcePauseInput): Promise<HarnessResourcePublication>
  consume(reference: HarnessResourceRequestReference): Promise<HarnessResourceConsumption>
}

// Call only at a settled boundary. A tool cannot wait for its model's receipt:
// WorkflowAgent settles that receipt after the tool has returned.
export async function waitForHarnessResources(
  input: HarnessResourcePauseInput,
  ports: HarnessResourceWaitPorts,
): Promise<'consumed' | 'retry' | 'inactive'> {
  using hook = createHook<unknown>({ token: input.token })
  if (await hook.getConflict()) throw new FatalError('Harness resource wait token is already owned.')
  const publication = await ports.publish(input)
  if (publication !== 'paused') return publication
  const reference = {
    actorUserId: input.actorUserId, runId: input.runId,
    workflowRunId: input.workflowRunId, token: input.token,
  }
  const events = hook[Symbol.asyncIterator]()
  let notification: Promise<{ kind: 'notification'; closed: boolean }> | undefined
  let poll: Promise<{ kind: 'poll' }> | undefined
  let closed = false
  while (true) {
    const result = await ports.consume(reference)
    if (result !== 'pending') return result
    // Retain both losing promises. Repeated polls must not queue new hook reads,
    // and repeated notifications must not postpone the safety poll.
    poll ??= sleep(new Date(Date.now() + 60_000)).then(() => ({ kind: 'poll' as const }))
    if (!closed) notification ??= events.next().then(event => ({ kind: 'notification' as const, closed: Boolean(event.done) }))
    const wake = await Promise.race(notification ? [poll, notification] : [poll])
    if (wake.kind === 'poll') poll = undefined
    else {
      closed = wake.closed
      notification = undefined
    }
  }
}
