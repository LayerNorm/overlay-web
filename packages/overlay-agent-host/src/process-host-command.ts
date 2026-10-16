import type {AgentHostCommand} from '@layernorm/overlay-agent-bridge-protocol'
import type {SqliteHostStateStore} from './state.js'
import {nativePreparationFingerprint} from './native-start-preparation.js'
import {isRetryablePreparationFailure} from './preparation-failure.js'

export async function processHostCommand(input: {command: AgentHostCommand; state: SqliteHostStateStore; environmentId: string; workspaceId: string;
  shuttingDown: boolean; resolvedThroughSequence: number; dispatch(command: AgentHostCommand): Promise<void>;
  errorMessage(error: unknown): string; acknowledge(command: AgentHostCommand, accepted: boolean, message?: string, code?: string): Promise<void>}): Promise<void> {
  const {command, state} = input
  if (input.shuttingDown) throw Error('Agent host shutdown is in progress')
  if (command.environmentId !== input.environmentId || command.workspaceId !== input.workspaceId) {
    throw new Error('command scope does not match this host')
  }
  const processed = state.getProcessedCommand(command.commandId)
  if (processed) {
    await input.acknowledge(command, processed.accepted, processed.errorMessage, processed.errorCode)
    return
  }
  const cursor = state.commandCursor()
  if (cursor === 0 && command.sequence > 1) {
    state.adoptCommandCursor(command.sequence - 1)
  }
  const expectedSequence = state.commandCursor() + 1
  if (command.sequence !== expectedSequence) {
    // The server attests which skipped numbers are already resolved; a hole it reports as
    // resolved is safe to jump over instead of wedging the whole command stream behind it.
    if (command.sequence > expectedSequence && command.sequence - 1 <= input.resolvedThroughSequence) {
      state.resumeCommandCursor(command.sequence - 1)
    } else {
      await input.acknowledge(command, false, `expected command sequence ${expectedSequence}`, 'command_sequence_gap')
      throw new Error(`expected command sequence ${expectedSequence}, received ${command.sequence}`)
    }
  }
  const claimed = command.type === 'start' && command.payload.restore && command.execution
    ? state.claimNativePreparation(command.commandId, nativePreparationFingerprint(command))
    : state.claimCommand(command.commandId)
  if (!claimed) {
    const message = 'The previous command outcome is unknown; inspect the current execution instead of replaying it.'
    state.recordCommandResult(command.commandId, { sequence: command.sequence, accepted: false, errorCode: 'command_outcome_unknown', errorMessage: message })
    await input.acknowledge(command, false, message, 'command_outcome_unknown')
    return
  }
  try {
    await input.dispatch(command)
    state.recordCommandResult(command.commandId, { sequence: command.sequence, accepted: true })
  } catch (error) {
    const message = input.errorMessage(error)
    const retryable = command.type === 'start' && command.payload.restore && command.execution
      && isRetryablePreparationFailure(error) && state.nativePreparationPending(command.commandId, nativePreparationFingerprint(command))
    const errorCode = retryable ? 'native_preparation_retryable' : 'command_rejected'
    state.recordCommandResult(command.commandId, { sequence: command.sequence, accepted: false, errorCode, errorMessage: message })
    await input.acknowledge(command, false, message, errorCode)
    throw error
  }
  await input.acknowledge(command, true)
}
