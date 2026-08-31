export type AgentStartFailureClass = 'host_offline' | 'start_failed'

export function agentStartFailureClass(error: unknown): AgentStartFailureClass {
  const message = error instanceof Error ? error.message : String(error)
  return /offline|environment_unavailable|no connected environment/i.test(message)
    ? 'host_offline'
    : 'start_failed'
}

export function agentStartFailureMessage(agentName: string, error: unknown): string {
  return agentStartFailureClass(error) === 'host_offline'
    ? `${agentName} could not start because its connected environment is offline. Reconnect the environment, then send this message again.`
    : `${agentName} could not start this turn. Your message was saved; please try sending it again.`
}
