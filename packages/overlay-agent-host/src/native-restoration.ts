import {driveStartDescriptorSchema, type AgentHostCommand} from '@layernorm/overlay-agent-bridge-protocol'
import type {StoredRemoteSession} from './state.js'

/** The authenticated control plane attests provider isolation; local state still pins the exact former writer. */
export function requireNativeRestorationSource(
  command: Extract<AgentHostCommand, {type: 'start'}>, stored: StoredRemoteSession | undefined,
): StoredRemoteSession {
  const restore = command.payload.restore, current = command.execution
  if (!restore || !current || !stored?.execution || command.payload.fresh
    || stored.runId !== command.runId || command.payload.sessionId !== stored.remoteSessionId || command.payload.adapterId !== stored.adapterId)
    throw Error('Cannot admit fenced native restoration without its original persisted session')
  const previous = restore.previousExecution
  if (previous.attemptId !== stored.execution.attemptId || previous.generation !== stored.execution.generation
    || (previous.hostBootId !== undefined && previous.hostBootId !== stored.execution.hostBootId)
    || current.attemptId === previous.attemptId || current.generation !== previous.generation + 1)
    throw Error('Native restoration does not match the previous execution fence')
  const offset = command.payload.metadata.recoveryTextOffset
  if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0)
    throw Error('Native restoration requires a canonical text offset')
  if (command.payload.metadata.overlayDrive !== undefined
    && driveStartDescriptorSchema.parse(command.payload.metadata.overlayDrive).sessionId !== current.attemptId)
    throw Error('Native restoration requires drive credentials for its new attempt')
  return stored
}
