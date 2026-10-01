export type AgentStartFailureClass = 'host_offline' | 'runtime_removed' | 'start_failed'

export function agentStartFailureClass(error: unknown): AgentStartFailureClass {
  const message = error instanceof Error ? error.message : String(error)
  if (/hosted runtime is no longer available/i.test(message)) return 'runtime_removed'
  return /offline|environment_unavailable|no connected environment/i.test(message)
    ? 'host_offline'
    : 'start_failed'
}

export function agentStartFailureMessage(agentName: string, error: unknown): string {
  if (agentStartFailureClass(error) === 'runtime_removed') {
    return `${agentName} ran on a hosted runtime that is no longer available. Recreate it as an Overlay agent, or connect an agent running on your own machine.`
  }
  return agentStartFailureClass(error) === 'host_offline'
    ? `${agentName} could not start because its connected environment is offline. Reconnect the environment, then send this message again.`
    : `${agentName} could not start this turn. Your message was saved; please try sending it again.`
}
