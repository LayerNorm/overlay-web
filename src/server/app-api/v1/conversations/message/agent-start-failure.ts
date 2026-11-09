export type AgentStartFailureClass = 'host_offline' | 'runtime_removed' | 'machine_gone' | 'billing' | 'start_failed'

type BillingState = 'subscription_required' | 'payment_pending' | 'budget_exhausted' | 'billing_suspended'
type BillingRecovery = 'billing' | 'contact_owner' | 'unknown'

const BILLING_STATES: readonly BillingState[] = ['subscription_required', 'payment_pending', 'budget_exhausted', 'billing_suspended']

/**
 * Billing refusals reach this point in two forms:
 * - `WorkspaceExecutionError` from the admission gate, which carries the state and who can fix it.
 * - Convex's bare `workspace_execution_required`, when a budget reservation finds no paid workspace account.
 * Both are detected by shape, so this module stays free of server-only imports.
 */
function billingRefusal(error: unknown): { state: BillingState; recovery: BillingRecovery } | null {
  if (error && typeof error === 'object') {
    const payload = (error as { payload?: { code?: unknown; recovery?: unknown } }).payload
    if ((error as { name?: unknown }).name === 'WorkspaceExecutionError' && payload
      && BILLING_STATES.includes(payload.code as BillingState)) {
      return {
        state: payload.code as BillingState,
        recovery: payload.recovery === 'billing' || payload.recovery === 'contact_owner' ? payload.recovery : 'unknown',
      }
    }
  }
  const message = error instanceof Error ? error.message : String(error)
  return /workspace_execution_required/.test(message) ? { state: 'subscription_required', recovery: 'unknown' } : null
}

export function agentStartFailureClass(error: unknown): AgentStartFailureClass {
  if (billingRefusal(error)) return 'billing'
  const message = error instanceof Error ? error.message : String(error)
  if (/hosted runtime is no longer available|hosted_runtime_retired|hosted Overlay Cloud runtime is retired/i.test(message)) return 'runtime_removed'
  if (/MANAGED_SANDBOX_LEASE_UNAVAILABLE|cloud_agent_unavailable|machine is not available/i.test(message)) return 'machine_gone'
  return /offline|environment_unavailable|no connected environment/i.test(message)
    ? 'host_offline'
    : 'start_failed'
}

const BILLING_CAUSE: Record<BillingState, string> = {
  subscription_required: "this workspace doesn't have a paid plan",
  payment_pending: "this workspace's payment hasn't been confirmed yet",
  budget_exhausted: "this workspace's usage budget is used up",
  billing_suspended: "this workspace's billing needs attention",
}

const BILLING_ACTION: Record<BillingRecovery, string> = {
  billing: 'Open Workspace Billing to fix this, then send this message again.',
  contact_owner: 'Ask a workspace owner to fix this in Workspace Billing, then send this message again.',
  unknown: 'Open Workspace Billing (or ask a workspace owner), then send this message again.',
}

export function agentStartFailureMessage(agentName: string, error: unknown): string {
  const billing = billingRefusal(error)
  if (billing) return `${agentName} can't start because ${BILLING_CAUSE[billing.state]}. ${BILLING_ACTION[billing.recovery]}`
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

const BILLING_REASON: Record<BillingState, string> = {
  subscription_required: 'Paid plan required.',
  payment_pending: 'Payment not confirmed yet.',
  budget_exhausted: 'Usage budget used up.',
  billing_suspended: 'Workspace billing needs attention.',
}

/** The short reason shown on the failed reply, in place of "No failure reason is available". */
export function agentStartFailureReason(error: unknown): { code: string; message: string; retryable: boolean } {
  const billing = billingRefusal(error)
  if (billing) return { code: billing.state, message: BILLING_REASON[billing.state], retryable: false }
  switch (agentStartFailureClass(error)) {
    case 'runtime_removed': return { code: 'runtime_removed', message: 'Hosted runtime retired.', retryable: false }
    case 'machine_gone': return { code: 'machine_gone', message: "The agent's computer is unavailable.", retryable: false }
    case 'host_offline': return { code: 'host_offline', message: 'Connected environment is offline.', retryable: true }
    default: return { code: 'start_failed', message: 'The turn could not be started.', retryable: true }
  }
}
