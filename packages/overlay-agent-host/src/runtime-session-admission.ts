import type {AgentHostCommand} from '@layernorm/overlay-agent-bridge-protocol'
import type {AgentAdapter, AgentAdapterSession} from './adapter.js'
import {agentSettingsSchema, type AgentSettings} from './acp-settings.js'
import {requireNativeRestorationSource} from './native-restoration.js'
import type {SqliteHostStateStore, StoredRemoteSession} from './state.js'

type StartCommand = Extract<AgentHostCommand, {type: 'start'}>
type Admission = {kind: 'already-active'} | {kind: 'admitted'; settings: AgentSettings; offset?: number; restored?: StoredRemoteSession}

function restorationSource(command: StartCommand, adapter: AgentAdapter, state: SqliteHostStateStore) {
  if (!command.payload.restore) return undefined
  if (!adapter.capability.recovery?.fencedSessionRestoration || !adapter.capability.recovery.sessionLoading)
    throw Error('This adapter cannot admit fenced native restoration')
  return requireNativeRestorationSource(command, state.getSession(command.runId))
}

function claimStart(command: StartCommand, state: SqliteHostStateStore, restored: StoredRemoteSession | undefined) {
  if (!command.execution) return
  // Restoration transfers ownership only after credentials/drive preparation, immediately before native startup.
  if (restored) return
  if (!state.claimExecution(command.runId, command.execution.attemptId))
    throw Error('execution start outcome is unknown; inspect the existing process before continuing')
}

/** Validate before teardown; transfer durable ownership once, retaining native identity on restoration. */
export async function admitHostSession(input: {command: StartCommand; adapter: AgentAdapter; state: SqliteHostStateStore;
  sessions: Map<string, AgentAdapterSession>}): Promise<Admission> {
  const {command, adapter, state, sessions} = input
  const settings = agentSettingsSchema.parse(command.payload.metadata)
  const restored = restorationSource(command, adapter, state)
  const requested = command.payload.metadata.recoveryTextOffset
  let offset: number | undefined
  if (requested !== undefined) {
    if ((!restored && command.payload.fresh !== true) || typeof requested !== 'number' || !Number.isSafeInteger(requested) || requested < 0)
      throw Error('Invalid recovery text offset')
    offset = requested
  }
  if (command.payload.fresh) {
    await sessions.get(command.runId)?.stop('Starting a fresh session')
    sessions.delete(command.runId)
    state.deleteSession(command.runId)
    state.deleteAdapterSessionState(command.runId)
  } else if (!restored) {
    if (sessions.has(command.runId)) return {kind: 'already-active'}
    if (state.getSession(command.runId)) throw Error('persisted execution exists; observe or inspect its outcome before starting again')
  }
  claimStart(command, state, restored)
  return {kind: 'admitted', settings, offset, restored}
}
