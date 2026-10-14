/**
 * Shared shapes for an agent that runs on an Overlay Cloud machine: how far
 * its machine has got in starting, and what the agent page shows about it.
 */

export const CLOUD_AGENT_PHASES = ['queued', 'allocating', 'booting', 'connecting', 'ready', 'failed'] as const
export type CloudAgentPhase = (typeof CLOUD_AGENT_PHASES)[number]

/** Steps shown while a machine starts, in order. */
export const CLOUD_AGENT_STARTUP_STEPS: ReadonlyArray<{ phase: Exclude<CloudAgentPhase, 'failed'>; label: string }> = [
  { phase: 'queued', label: 'Getting ready' },
  { phase: 'allocating', label: 'Allocating a machine' },
  { phase: 'booting', label: 'Booting' },
  { phase: 'connecting', label: 'Connecting the agent' },
  { phase: 'ready', label: 'Ready' },
]

export function isCloudAgentStarting(phase: CloudAgentPhase | undefined): boolean {
  return phase === 'queued' || phase === 'allocating' || phase === 'booting' || phase === 'connecting'
}

/** What a person sees as the agent's state. */
export type CloudAgentState = 'ready' | 'paused' | 'starting' | 'needs_sign_in' | 'failed' | 'unavailable'

export type CloudAgentStatus = {
  agentId: string
  /** Which agent runs on the machine (from the agent's binding), known even when the machine is gone. */
  adapterId?: string
  provision: { phase: CloudAgentPhase; error?: string; updatedAt: number } | null
  environment: { id: string; status: string; lastSeenAt?: number; createdAt: number } | null
  /** The machine itself, read from the provider. `unknown` when it could not be reached. */
  machine: { state: 'running' | 'stopped' | 'unknown'; size?: string; image?: string; adapterId?: string } | null
  account: { id: string; label: string; provider: string; method: string; status: 'active' | 'needs_reauth' } | null
  state: CloudAgentState
}

export const CLOUD_AGENT_STATE_LABEL: Record<CloudAgentState, string> = {
  ready: 'Ready',
  paused: 'Paused',
  starting: 'Starting',
  needs_sign_in: 'Needs sign-in',
  failed: 'Failed',
  unavailable: 'Machine stopped',
}

/**
 * What the create dialog shows from one status read. Provisioning finishing is not the agent being ready:
 * the machine's host still has to check in. Until it has, the last step stays "Connecting the agent", and
 * the dialog keeps polling; only a `ready` state ends it (and only a failed provision ends it as an error).
 */
export function cloudCreateProgress(status: Pick<CloudAgentStatus, 'state' | 'provision'>): {
  phase: CloudAgentPhase
  error: string | null
  done: boolean
} {
  if (status.state === 'ready') return { phase: 'ready', error: null, done: true }
  const phase = status.provision?.phase
  if (phase === 'failed') return { phase: 'failed', error: status.provision?.error ?? 'Could not start the machine.', done: false }
  if (!phase) return { phase: 'queued', error: null, done: false }
  return { phase: phase === 'ready' ? 'connecting' : phase, error: null, done: false }
}

export type CloudAgentAction = 'pause' | 'resume' | 'restart'
export const CLOUD_AGENT_ACTIONS = ['pause', 'resume', 'restart'] as const satisfies readonly CloudAgentAction[]

/** Pure: the single state the agent page shows, from what the server knows. */
export function deriveCloudAgentState(input: Pick<CloudAgentStatus, 'provision' | 'environment' | 'machine' | 'account'>): CloudAgentState {
  if (input.provision?.phase === 'failed') return 'failed'
  if (isCloudAgentStarting(input.provision?.phase)) return 'starting'
  if (!input.environment) return 'unavailable'
  // The provisioning finished but no machine backs the agent any more (it was deleted, usually when credit ran out).
  if (input.machine === null && input.provision?.phase === 'ready') return 'unavailable'
  if (input.account?.status === 'needs_reauth') return 'needs_sign_in'
  if (input.machine?.state === 'stopped') return 'paused'
  if (input.machine?.state === 'unknown') return input.environment.status === 'online' ? 'ready' : 'unavailable'
  // Running machine: ready once its host has checked in, otherwise it is still coming up.
  return input.environment.status === 'online' ? 'ready' : 'starting'
}
