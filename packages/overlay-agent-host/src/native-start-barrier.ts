import type {AgentHostCommand} from '@layernorm/overlay-agent-bridge-protocol'
import type {NormalizedAgentEvent} from './adapter.js'
import type {SqliteHostStateStore} from './state.js'
import type {OutboxReceipts} from './outbox-receipts.js'

export async function drainNativeSource(input: {command: Extract<AgentHostCommand, {type: 'start'}>; state: SqliteHostStateStore;
  receipts: OutboxReceipts; signal?: AbortSignal; flush(): Promise<void>}): Promise<void> {
  const previous = input.command.payload.restore?.previousExecution
  if (!previous) throw Error('Native startup requires its original source')
  await input.receipts.drainThrough({state: input.state, runId: input.command.runId, attemptId: previous.attemptId,
    throughSequence: input.state.lastEventSequence(input.command.runId, previous.attemptId), flush: input.flush, signal: input.signal})
}

export async function requestNativeStart(input: {command: Extract<AgentHostCommand, {type: 'start'}>;
  state: SqliteHostStateStore; hostBootId: string; receipts: OutboxReceipts;
  emit(event: Extract<NormalizedAgentEvent, {type: 'native_start_requested'}>): Promise<void>; signal?: AbortSignal; flush(): Promise<void>}): Promise<number> {
  const {command} = input, previous = command.payload.restore?.previousExecution, execution = command.execution
  if (!previous || !execution || !command.payload.sessionId) throw Error('Native startup requires its original execution and conversation')
  // Drain durable source output before the server fixes the new writer's canonical cursor.
  const sourceEventCursor = input.state.lastEventSequence(command.runId, previous.attemptId)
  await input.receipts.drainThrough({state: input.state, runId: command.runId, attemptId: previous.attemptId,
    throughSequence: sourceEventCursor, flush: input.flush, signal: input.signal})
  input.signal?.throwIfAborted()
  await input.emit({type: 'native_start_requested', payload: {commandId: command.commandId,
    remoteSessionId: command.payload.sessionId, adapterId: command.payload.adapterId, sourceEventCursor}})
  const requestSequence = input.state.lastEventSequence(command.runId, execution.attemptId)
  await input.receipts.drainThrough({state: input.state, runId: command.runId, attemptId: execution.attemptId,
    throughSequence: requestSequence, flush: input.flush, signal: input.signal})
  const admitted = input.receipts.takeNativeAdmission(command.commandId)
  if (!admitted || admitted.attemptId !== execution.attemptId || admitted.generation !== execution.generation
    || admitted.hostBootId !== input.hostBootId || admitted.sourceEventCursor !== sourceEventCursor || Date.now() >= admitted.hardDeadlineAt)
    throw Error('Native startup admission was not acknowledged for this receiver')
  return admitted.canonicalTextOffset
}
