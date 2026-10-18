import type { AgentHostEvent } from '@layernorm/overlay-agent-bridge-protocol'
import type { AgentAdapterSession, EmitAgentEvent } from './adapter.js'

type Execution = AgentHostEvent['execution']
type NativeTerminalIntentOptions = {
  execution: Execution
  currentExecution(): Execution
  shuttingDown(): boolean
  markEnded(): void
}

export function createNativeTerminalIntent(options: NativeTerminalIntentOptions): () => void {
  return () => {
    if (options.shuttingDown()) return
    const current = options.currentExecution()
    if (options.execution?.attemptId === current?.attemptId
      && options.execution?.generation === current?.generation) options.markEnded()
  }
}

/** An observation started earlier cannot revoke a finished or replaced execution. */
export async function observeActiveNativeRuns(
  sessions: ReadonlyMap<string, AgentAdapterSession>, executions: ReadonlyMap<string, Execution>,
  ended: ReadonlySet<string>, report: (runId: string, process: 'live' | 'lost' | 'unknown', execution: Execution) => Promise<void>,
): Promise<void> {
  for (const [runId, session] of sessions) {
    const execution = executions.get(runId)
    if (!execution || ended.has(runId)) continue
    const process = await session.observe?.() ?? 'unknown'
    if (ended.has(runId) || executions.get(runId) !== execution) continue
    await report(runId, process, execution)
  }
}

/** Native work can finish before the host has drained its final text and file writes. */
export function withNativeTerminalBoundary(options: NativeTerminalIntentOptions & {
  forward: EmitAgentEvent
}): EmitAgentEvent {
  const markEnded = createNativeTerminalIntent(options)
  return event => {
    const terminal = ['completed', 'failed', 'cancelled'].includes(event.type)
    if (options.shuttingDown() && terminal) return Promise.resolve()
    // A stale provider callback must never stop the replacement writer's probes.
    if (terminal) markEnded()
    return options.forward(event)
  }
}
