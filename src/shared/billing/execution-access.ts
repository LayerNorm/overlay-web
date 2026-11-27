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
  currentPeriodStart?: number
  currentPeriodEnd?: number
  paidPeriodStart?: number
  paidPeriodEnd?: number
}

/** A new workspace's free trial: Overlay funds this much usage for this long, then the $8 Usage plan is needed. */
export const WORKSPACE_TRIAL_CREDIT_CENTS = 100
export const WORKSPACE_TRIAL_DAYS = 3
export const WORKSPACE_TRIAL_DURATION_MS = WORKSPACE_TRIAL_DAYS * 24 * 60 * 60 * 1000
/** The most Overlay pays for one workspace's trial, whatever the last call costs. */
export const WORKSPACE_TRIAL_HARD_CAP_CENTS = 200

/** A trial is the free plan in the `trialing` state, started by Overlay (never by Stripe, whose plans are paid). */
export function isWorkspaceTrial(subscription: Pick<ExecutionSubscription, 'planKind' | 'status'> | null | undefined): boolean {
  return subscription?.planKind === 'free' && subscription.status === 'trialing'
}

export function workspaceTrialActive(subscription: ExecutionSubscription, now: number): boolean {
  const start = subscription.currentPeriodStart
  const end = subscription.currentPeriodEnd
  return isWorkspaceTrial(subscription) && Number.isFinite(start) && Number.isFinite(end)
    && start! <= now && now < end! && end! - start! <= WORKSPACE_TRIAL_DURATION_MS
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

/** The balance a workspace needs to keep working: 2% of its budget (at least one cent). Top-ups refill to this line. */
export function workspaceBudgetStopLineCents(input: { totalCents?: number }): number {
  return Math.max(1, Math.ceil((input.totalCents ?? 0) * WORKSPACE_BUDGET_STOP_FRACTION))
}

/** Eligibility is independent of reservations; only admission of new work checks available funds. */
export function workspaceExecutionAccess(input: {
  billingEnabled: boolean
  accountStatus?: string
  subscription?: ExecutionSubscription | null
  remainingCents: number
  totalCents?: number
  /** Spent this period; only a trial reads it, for its hard cap. */
  usedCents?: number
  checkBudget?: boolean
  now?: number
}): WorkspaceExecutionAccess {
  const access = (state: WorkspaceExecutionState): WorkspaceExecutionAccess => ({ state, canExecute: state === 'ready' })
  if (!input.billingEnabled) return access('ready')
  if (input.accountStatus && input.accountStatus !== 'active') return access('billing_suspended')
  const subscription = input.subscription
  const now = input.now ?? Date.now()
  if (input.accountStatus && subscription && isWorkspaceTrial(subscription)) {
    // A trial always checks its balance: Overlay pays for it, so it stops at the credit, not at an existing hold.
    if (!workspaceTrialActive(subscription, now)) return access('subscription_required')
    if ((input.usedCents ?? 0) >= WORKSPACE_TRIAL_HARD_CAP_CENTS || workspaceBudgetLow(input)) return access('budget_exhausted')
    return access('ready')
  }
  if (!input.accountStatus || !subscription || subscription.planKind !== 'paid') return access('subscription_required')
  if (subscription.status === 'past_due' || subscription.status === 'canceled' || subscription.status === 'unpaid' || subscription.status === 'paused') {
    return access('billing_suspended')
  }
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
