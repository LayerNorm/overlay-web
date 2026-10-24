import {setTimeout as wait} from 'node:timers/promises'
import type {AgentHostCommand, CommandPollResponse} from '@layernorm/overlay-agent-bridge-protocol'

type PollResponse = Omit<CommandPollResponse, 'protocolVersion'>

/** Keep delivery responsive while preserving serial dispatch and durable command acknowledgements. */
export async function processPolledCommands(input: {
  commands: AgentHostCommand[]; signal?: AbortSignal
  process(command: AgentHostCommand, preparationSignal?: AbortSignal): Promise<void>
  poll(signal: AbortSignal): Promise<PollResponse>
  received(response: PollResponse): void
  onError(error: unknown): void
}): Promise<void> {
  const queue = [...input.commands], seen = new Set(queue.map(command => command.commandId))
  for (let index = 0; index < queue.length && !input.signal?.aborted; index++) {
    const command = queue[index]
    if (command.type !== 'start') {await input.process(command); continue}
    const stopped = new AbortController(), finished = new AbortController()
    const deliverySignal = AbortSignal.any([finished.signal, ...(input.signal ? [input.signal] : [])])
    const preparationSignal = AbortSignal.any([stopped.signal, ...(input.signal ? [input.signal] : [])])
    const observeStop = (commands: AgentHostCommand[]) => {
      if (commands.some(candidate => interruptsPreparation(command, candidate))) stopped.abort(Error('Run stopped during preparation'))
    }
    observeStop(queue.slice(index + 1))
    const watching = (async () => {
      while (!deliverySignal.aborted && !stopped.signal.aborted) {
        try {
          const response = await input.poll(deliverySignal)
          if (deliverySignal.aborted) return
          input.received(response)
          observeStop(response.commands)
          for (const next of response.commands) if (!seen.has(next.commandId)) {seen.add(next.commandId); queue.push(next)}
          // Some transports return immediately for a redelivered start. Bound duplicate polling.
          await wait(Math.max(250, response.retryAfterMs ?? 0), undefined, {signal: deliverySignal})
        } catch (error) {
          if (deliverySignal.aborted) return
          input.onError(error)
          await wait(250, undefined, {signal: deliverySignal}).catch(() => undefined)
        }
      }
    })()
    try {await input.process(command, preparationSignal)}
    catch (error) {
      // The start rejection is already durable. Deliver the claimed Stop next, without waiting for its lease to expire.
      if (!stopped.signal.aborted || error !== preparationSignal.reason) throw error
    }
    finally {finished.abort(); await watching}
  }
}

function interruptsPreparation(start: AgentHostCommand, candidate: AgentHostCommand): boolean {
  return (candidate.type === 'cancel' || candidate.type === 'shutdown') && candidate.sequence > start.sequence
    && candidate.environmentId === start.environmentId && candidate.workspaceId === start.workspaceId && candidate.runId === start.runId
    && candidate.execution?.attemptId === start.execution?.attemptId && candidate.execution?.generation === start.execution?.generation
}
