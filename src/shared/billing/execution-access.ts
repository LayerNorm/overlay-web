export type WorkspaceExecutionState =
  | 'subscription_required'
  | 'payment_pending'
  | 'ready'
  | 'budget_exhausted'
  | 'billing_suspended'

export type WorkspaceExecutionAccess = {
  state: WorkspaceExecutionState
  canExecute: boolean
}

export type ExecutionSubscription = {
  planKind?: string
  status?: string
  paidPeriodStart?: number
  paidPeriodEnd?: number
}

/** Eligibility is independent of reservations; only admission of new work checks available funds. */
export function workspaceExecutionAccess(input: {
  billingEnabled: boolean
  accountStatus?: string
  subscription?: ExecutionSubscription | null
  remainingCents: number
  checkBudget?: boolean
  now?: number
}): WorkspaceExecutionAccess {
  const access = (state: WorkspaceExecutionState): WorkspaceExecutionAccess => ({ state, canExecute: state === 'ready' })
  if (!input.billingEnabled) return access('ready')
  if (input.accountStatus && input.accountStatus !== 'active') return access('billing_suspended')
  const subscription = input.subscription
  if (!input.accountStatus || !subscription || subscription.planKind !== 'paid') return access('subscription_required')
  if (subscription.status === 'past_due' || subscription.status === 'canceled' || subscription.status === 'unpaid' || subscription.status === 'paused') {
    return access('billing_suspended')
  }
  const now = input.now ?? Date.now()
  if (subscription.status !== 'active'
    || !Number.isFinite(subscription.paidPeriodStart)
    || !Number.isFinite(subscription.paidPeriodEnd)
    || subscription.paidPeriodStart! > now
    || subscription.paidPeriodEnd! <= now
    || subscription.paidPeriodEnd! <= subscription.paidPeriodStart!) return access('payment_pending')
  if (input.checkBudget !== false && (!Number.isFinite(input.remainingCents) || input.remainingCents <= 0)) {
    return access('budget_exhausted')
  }
  return access('ready')
}

export const EXECUTION_ACCESS_MESSAGES: Record<WorkspaceExecutionState, string> = {
  subscription_required: 'Subscribe to this workspace before starting work.',
  payment_pending: 'Your payment has not been confirmed yet. Your draft is saved.',
  ready: 'Your task is ready when you are.',
  budget_exhausted: 'Your workspace budget is exhausted. Add usage before starting more work.',
  billing_suspended: 'Workspace billing needs attention before work can continue.',
}
