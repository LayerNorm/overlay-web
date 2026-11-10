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

/** Work stops once less than this fraction of the workspace budget is left. */
export const WORKSPACE_BUDGET_STOP_FRACTION = 0.02

/**
 * The only automatic spending limit: the real balance, read before work and after every paid call.
 * Never an estimate of what the next call will cost.
 */
export function workspaceBudgetLow(input: { remainingCents: number; totalCents?: number }): boolean {
  if (!Number.isFinite(input.remainingCents) || input.remainingCents <= 0) return true
  const total = input.totalCents
  if (total === undefined || !Number.isFinite(total) || total <= 0) return false
  return input.remainingCents < total * WORKSPACE_BUDGET_STOP_FRACTION
}

/** Cents a top-up must add so the workspace is back above the stop line. */
export function workspaceBudgetShortfallCents(input: { remainingCents: number; totalCents?: number }): number {
  const floor = Math.max(1, Math.ceil((input.totalCents ?? 0) * WORKSPACE_BUDGET_STOP_FRACTION))
  return Math.max(1, floor - Math.max(0, Math.floor(input.remainingCents)))
}

/** Eligibility is independent of reservations; only admission of new work checks available funds. */
export function workspaceExecutionAccess(input: {
  billingEnabled: boolean
  accountStatus?: string
  subscription?: ExecutionSubscription | null
  remainingCents: number
  totalCents?: number
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
  if (input.checkBudget !== false && workspaceBudgetLow(input)) {
    return access('budget_exhausted')
  }
  return access('ready')
}

export const EXECUTION_ACCESS_MESSAGES: Record<WorkspaceExecutionState, string> = {
  subscription_required: 'Subscribe to this workspace before starting work.',
  payment_pending: 'Your payment has not been confirmed yet. Your draft is saved.',
  ready: 'Your task is ready when you are.',
  budget_exhausted: 'Your workspace has less than 2% of its budget left. Add usage before starting more work.',
  billing_suspended: 'Workspace billing needs attention before work can continue.',
}
