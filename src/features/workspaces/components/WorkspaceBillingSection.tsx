'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { CircleAlert, CreditCard, Loader2, RefreshCw, WalletCards } from 'lucide-react'
import { Button, EmptyState, Select, Toggle } from '@overlay/ui/primitives'
import type { WorkspaceBillingSummaryResponse, WorkspaceSummary } from '@overlay/workspace-contracts'
import { currentLegalAcceptancePayload } from '@/shared/legal/legal-documents'
import type { WorkspaceManagementClient } from '@/shared/workspaces/types'

const AMOUNTS = [800, 2_000, 5_000, 10_000, 20_000] as const

type BillingState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; summary: WorkspaceBillingSummaryResponse }

export function WorkspaceBillingSection({
  client,
  workspace,
}: {
  client: WorkspaceManagementClient
  workspace: WorkspaceSummary
}) {
  const billing = useWorkspaceBilling(client, workspace)
  const { state } = billing

  if (state.status === 'loading') {
    return <div className="flex min-h-72 items-center justify-center text-sm text-[var(--muted)]"><Loader2 size={16} className="mr-2 animate-spin" />Loading workspace billing…</div>
  }
  if (state.status === 'error') {
    return (
      <EmptyState
        className="min-h-72 px-6 py-12"
        icon={<CircleAlert size={28} />}
        title="Workspace billing is unavailable"
        description={state.message}
        action={<Button size="sm" onClick={billing.refresh}><RefreshCw size={13} />Try again</Button>}
      />
    )
  }

  return <WorkspaceBillingLoaded client={client} workspaceId={workspace.id} summary={state.summary} billing={billing} />
}

type WorkspaceBilling = ReturnType<typeof useWorkspaceBilling>

function useWorkspaceBilling(client: WorkspaceManagementClient, workspace: WorkspaceSummary) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [state, setState] = useState<BillingState>({ status: 'loading' })
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [planAmountCents, setPlanAmountCents] = useState(800)
  const [topUpAmountCents, setTopUpAmountCents] = useState(800)
  const [refreshKey, setRefreshKey] = useState(0)
  const [acceptedCheckoutTerms, setAcceptedCheckoutTerms] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    setState({ status: 'loading' })
    void client
      .billing(workspace.id, controller.signal)
      .then((summary) => {
        if (controller.signal.aborted) return
        setState({ status: 'ready', summary })
        if (summary.subscription.planAmountCents >= 800) {
          setPlanAmountCents(summary.subscription.planAmountCents)
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setState({ status: 'error', message: error instanceof Error ? error.message : 'Could not load workspace billing.' })
        }
      })
    return () => controller.abort()
  }, [client, refreshKey, workspace.id])

  useEffect(() => {
    const sessionId = searchParams?.get('workspace_session_id')
    const kind = searchParams?.get('workspace_billing_success') === 'true'
      ? 'paid_plan'
      : searchParams?.get('workspace_topup_success') === 'true'
        ? 'budget_topup'
        : null
    if (!sessionId || !kind) return
    setBusy('verify')
    void client
      .verifyBillingCheckout(workspace.id, { kind, sessionId })
      .then(() => {
        setMessage(kind === 'paid_plan' ? 'Workspace subscription activated.' : 'Workspace credits added.')
        setRefreshKey((value) => value + 1)
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : 'Checkout verification failed.'))
      .finally(() => {
        setBusy(null)
        window.history.replaceState(
          null,
          '',
          '/app/settings?section=workspace&workspace_tab=billing',
        )
      })
  }, [client, router, searchParams, workspace.id])

  const run = async (key: string, operation: () => Promise<{ url: string | null } | WorkspaceBillingSummaryResponse>) => {
    setBusy(key)
    setMessage(null)
    try {
      const result = await operation()
      if ('url' in result && result.url) {
        window.location.assign(result.url)
        return
      }
      setRefreshKey((value) => value + 1)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Workspace billing action failed.')
    } finally {
      setBusy(null)
    }
  }

  return {
    state,
    busy,
    message,
    planAmountCents,
    setPlanAmountCents,
    topUpAmountCents,
    setTopUpAmountCents,
    acceptedCheckoutTerms,
    setAcceptedCheckoutTerms,
    refresh: () => setRefreshKey((value) => value + 1),
    run,
  }
}

function WorkspaceBillingLoaded({
  client,
  workspaceId,
  summary,
  billing,
}: {
  client: WorkspaceManagementClient
  workspaceId: string
  summary: WorkspaceBillingSummaryResponse
  billing: WorkspaceBilling
}) {
  const { busy, message, run } = billing

  return (
    <div data-testid="workspace-billing" className="space-y-4 p-5">
      {message ? (
        <div
          role='status'
          className='rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] px-4 py-3 text-sm text-[var(--foreground)]'
        >
          {message}
        </div>
      ) : null}

      {!summary.rollout.eligible ? (
        <RolloutNotice />
      ) : !summary.initialized ? (
        <WalletSetupCard
          canManage={summary.canManage}
          busy={busy}
          onSetup={() => void run('initialize', () => client.initializeBilling(workspaceId))}
        />
      ) : (
        <WalletOverview client={client} workspaceId={workspaceId} summary={summary} billing={billing} />
      )}
    </div>
  )
}

function RolloutNotice() {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-4">
      <p className="text-sm font-medium text-[var(--foreground)]">Free</p>
      <p className="mt-1 text-xs leading-5 text-[var(--muted)]">Everyone working in this workspace shares one free weekly allowance of chat turns. Workspace plans are not open for this workspace yet.</p>
    </div>
  )
}

function WalletSetupCard({
  canManage,
  busy,
  onSetup,
}: {
  canManage: boolean
  busy: string | null
  onSetup: () => void
}) {
  return (
    <div className="rounded-xl border border-[var(--border)] p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium text-[var(--foreground)]">Free</p>
          <p className="mt-1 max-w-xl text-xs leading-5 text-[var(--muted)]">Everyone working in this workspace shares one free weekly allowance of chat turns. Add a plan to give the workspace its own pool of credits for agents, files, automations, browser runs, and other hosted work, shared by every member.</p>
        </div>
        {canManage ? <Button size="sm" disabled={busy !== null} onClick={onSetup}>{busy === 'initialize' ? <Loader2 size={13} className="animate-spin" /> : <WalletCards size={13} />}Add a plan</Button> : null}
      </div>
    </div>
  )
}

function WalletOverview({
  client,
  workspaceId,
  summary,
  billing,
}: {
  client: WorkspaceManagementClient
  workspaceId: string
  summary: WorkspaceBillingSummaryResponse
  billing: WorkspaceBilling
}) {
  const { busy, run } = billing
  const checkoutAvailable = summary.canTopUp && summary.rollout.checkoutEnabled

  return (
    <>
      <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
        <WalletCreditsCard summary={summary} />
        <WalletSubscriptionCard summary={summary} />
      </div>

      {checkoutAvailable ? <CheckoutActions client={client} workspaceId={workspaceId} summary={summary} billing={billing} /> : null}

      {summary.canManage ? (
        <div className="flex justify-end"><Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void run('portal', () => client.createBillingPortal(workspaceId))}>Manage billing</Button></div>
      ) : <p className="text-xs text-[var(--muted)]">{summary.canTopUp ? 'Only workspace owners and admins can change the subscription.' : 'Only workspace owners and admins can add credits or change the subscription.'}</p>}

      {summary.observability ? <MarginPanel report={summary.observability} /> : null}
    </>
  )
}

function WalletCreditsCard({ summary }: { summary: WorkspaceBillingSummaryResponse }) {
  const allowanceUsed = Math.min(100, Math.max(0, summary.credits.allowancePercentUsed))
  return (
    <div className="rounded-xl border border-[var(--border)] p-4">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-[var(--foreground)]">Workspace credits</p>
          <p className="mt-1 text-xs text-[var(--muted)]">{formatCredits(summary.credits.remaining)} remaining</p>
        </div>
        <span className="text-xs text-[var(--muted)]">{allowanceUsed.toFixed(0)}% allowance used</span>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-[var(--surface-subtle)]" aria-label={`${allowanceUsed.toFixed(0)}% allowance used`}>
        <div className="h-full rounded-full bg-[var(--foreground)] transition-[width]" style={{ width: `${allowanceUsed}%` }} />
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
        <div><dt className="text-[var(--muted-light)]">Used this period</dt><dd className="mt-1 text-[var(--foreground)]">{formatCredits(summary.credits.used)}</dd></div>
        <div><dt className="text-[var(--muted-light)]">Top-up credits</dt><dd className="mt-1 text-[var(--foreground)]">{formatCredits(summary.credits.topUpBalance)}</dd></div>
      </dl>
    </div>
  )
}

function WalletSubscriptionCard({ summary }: { summary: WorkspaceBillingSummaryResponse }) {
  return (
    <div className="rounded-xl border border-[var(--border)] p-4">
      <p className="text-sm font-medium text-[var(--foreground)]">{summary.subscription.planKind === 'paid' ? `$${summary.subscription.planAmountCents / 100}/month` : 'No subscription'}</p>
      <p className="mt-1 text-xs leading-5 text-[var(--muted)]">One plan for the whole workspace. Unlimited members. Owners and admins control funding.</p>
      {summary.subscription.status ? <span className="mt-3 inline-flex rounded-full bg-[var(--surface-subtle)] px-2 py-1 text-[10px] font-medium capitalize text-[var(--muted)]">{summary.subscription.status}</span> : null}
    </div>
  )
}

function CheckoutActions({
  client,
  workspaceId,
  summary,
  billing,
}: {
  client: WorkspaceManagementClient
  workspaceId: string
  summary: WorkspaceBillingSummaryResponse
  billing: WorkspaceBilling
}) {
  const {
    busy,
    planAmountCents,
    setPlanAmountCents,
    topUpAmountCents,
    setTopUpAmountCents,
    acceptedCheckoutTerms,
    setAcceptedCheckoutTerms,
    run,
  } = billing

  return (
    <>
      <div className="grid gap-3 lg:grid-cols-2">
        {summary.canManage ? <BillingActionCard title="Monthly workspace credits" description="Choose a recurring allowance from $8 to $200. Existing personal subscriptions are untouched.">
          <Select aria-label="Workspace monthly plan" value={String(planAmountCents)} onChange={(event) => setPlanAmountCents(Number(event.target.value))}>{AMOUNTS.map((amount) => <option key={amount} value={amount}>{`$${amount / 100}/month`}</option>)}</Select>
          <Button size="sm" disabled={busy !== null || !acceptedCheckoutTerms} onClick={() => void run('checkout', () => client.createBillingCheckout(workspaceId, { planAmountCents, topUpAmountCents, autoTopUpEnabled: false, ...currentLegalAcceptancePayload() }))}>{busy === 'checkout' ? <Loader2 size={13} className="animate-spin" /> : <CreditCard size={13} />}{summary.subscription.planKind === 'paid' ? 'Change plan' : 'Subscribe'}</Button>
        </BillingActionCard> : null}
        <BillingActionCard title="One-time top-up" description="Add credits directly to this workspace. Personal-wallet transfers are not supported.">
          <Select aria-label="Workspace top-up" value={String(topUpAmountCents)} onChange={(event) => setTopUpAmountCents(Number(event.target.value))}>{AMOUNTS.map((amount) => <option key={amount} value={amount}>{`$${amount / 100} in credits`}</option>)}</Select>
          <Button size="sm" variant="ghost" disabled={busy !== null || !acceptedCheckoutTerms} onClick={() => void run('topup', () => client.createBillingTopUp(workspaceId, { amountCents: topUpAmountCents, ...currentLegalAcceptancePayload() }))}>{busy === 'topup' ? <Loader2 size={13} className="animate-spin" /> : null}Add credits</Button>
        </BillingActionCard>
      </div>

      <div className="flex items-start gap-3 text-xs leading-5 text-[var(--muted)]"><Toggle checked={acceptedCheckoutTerms} onCheckedChange={setAcceptedCheckoutTerms} aria-label="Agree to the Terms of Service, Privacy Policy, and billing terms" /><span>I agree to the current <a className="underline" href="/terms">Terms of Service</a>, <a className="underline" href="/privacy">Privacy Policy</a>, and <a className="underline" href="/refunds">billing and cancellation terms</a>.</span></div>
    </>
  )
}

function BillingActionCard({ children, description, title }: { children: ReactNode; description: string; title: string }) {
  return <div className="rounded-xl border border-[var(--border)] p-4"><p className="text-sm font-medium text-[var(--foreground)]">{title}</p><p className="mt-1 min-h-10 text-xs leading-5 text-[var(--muted)]">{description}</p><div className="mt-4 flex items-center gap-2">{children}</div></div>
}

function MarginPanel({ report }: { report: NonNullable<WorkspaceBillingSummaryResponse['observability']> }) {
  return (
    <div
      data-testid='workspace-margin-report'
      className='rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-4'
    >
      <div className='flex items-center justify-between gap-3'>
        <p className='text-sm font-medium text-[var(--foreground)]'>
          Billing health
        </p>
        <span className='text-[10px] uppercase tracking-[0.14em] text-[var(--muted-light)]'>
          Owners & admins
        </span>
      </div>
      <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-3">
        <Metric label="Provider cost" value={`$${(report.actualProviderCostCents / 100).toFixed(2)}`} />
        <Metric label="Retail usage" value={formatCredits(report.retailCredits)} />
        <Metric label="Realized margin" value={report.realizedMarginPercent === null ? '—' : `${report.realizedMarginPercent.toFixed(1)}%`} />
        <Metric label="Cost coverage" value={`${report.costCoveragePercent.toFixed(0)}%`} />
        <Metric label="Reconcile queue" value={String(report.reconciliationReservations)} />
        <Metric label="Past 15m SLA" value={String(report.staleReconciliationReservations)} danger={report.staleReconciliationReservations > 0} />
      </dl>
    </div>
  )
}

function Metric({
  danger,
  label,
  value,
}: {
  danger?: boolean
  label: string
  value: string
}) {
  return (
    <div>
      <dt className='text-[var(--muted-light)]'>{label}</dt>
      <dd
        className={`mt-1 font-medium ${danger ? 'text-red-500' : 'text-[var(--foreground)]'}`}
      >
        {value}
      </dd>
    </div>
  )
}

const CREDITS_FORMATTER = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

function formatCredits(value: number): string {
  return `${CREDITS_FORMATTER.format(value)} credits`
}
