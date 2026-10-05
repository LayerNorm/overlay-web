export type AgentStartFailureClass = 'host_offline' | 'runtime_removed' | 'machine_gone' | 'start_failed'

export function agentStartFailureClass(error: unknown): AgentStartFailureClass {
  const message = error instanceof Error ? error.message : String(error)
  if (/hosted runtime is no longer available/i.test(message)) return 'runtime_removed'
  if (/MANAGED_SANDBOX_LEASE_UNAVAILABLE|cloud_agent_unavailable|machine is not available/i.test(message)) return 'machine_gone'
  return /offline|environment_unavailable|no connected environment/i.test(message)
    ? 'host_offline'
    : 'start_failed'
}

export function agentStartFailureMessage(agentName: string, error: unknown): string {
  if (agentStartFailureClass(error) === 'runtime_removed') {
    return `${agentName} ran on a hosted runtime that is no longer available. Recreate it as an Overlay agent, or connect an agent running on your own machine.`
  }
  if (agentStartFailureClass(error) === 'machine_gone') {
    return `${agentName}'s computer is gone (usually because credit ran low). Open the agent's page and choose Start a new machine, then send this message again.`
  }
  return agentStartFailureClass(error) === 'host_offline'
    ? `${agentName} could not start because its connected environment is offline. Reconnect the environment, then send this message again.`
    : `${agentName} could not start this turn. Your message was saved; please try sending it again.`
}
