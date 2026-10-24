'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { CircleAlert, CreditCard, Loader2, RefreshCw, WalletCards } from 'lucide-react'
import { Button, EmptyState, Toggle, toast } from '@overlay/ui/primitives'
import type { WorkspaceBillingSummaryResponse, WorkspaceSummary } from '@overlay/workspace-contracts'
import { currentLegalAcceptancePayload } from '@/shared/legal/legal-documents'
import type { WorkspaceManagementClient } from '@/shared/workspaces/types'
import {
  PAID_PLAN_MAX_AMOUNT_CENTS,
  PAID_PLAN_MIN_AMOUNT_CENTS,
  TOP_UP_MAX_AMOUNT_CENTS,
  TOP_UP_MIN_AMOUNT_CENTS,
} from '@/shared/billing/billing-pricing'
import { formatBytes } from '@/shared/storage/storage-limits'
import { DollarAmountInput } from './DollarAmountInput'
import { WorkspaceAutoTopUpCard } from './WorkspaceAutoTopUpCard'
import { WorkspaceUsagePanel } from './WorkspaceUsagePanel'


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
    return <div className="flex min-h-72 items-center justify-center text-sm text-(--muted)"><Loader2 size={16} className="mr-2 animate-spin" />Loading workspace billing…</div>
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
  const handledCheckoutRef = useRef<string | null>(null)
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
    const checkoutKey = sessionId && kind ? `${kind}:${sessionId}` : null
    if (!checkoutKey || handledCheckoutRef.current === checkoutKey) return
    handledCheckoutRef.current = checkoutKey
    setBusy('verify')
    void client
      .verifyBillingCheckout(workspace.id, { kind, sessionId })
      .then(() => {
        toast.success(kind === 'paid_plan' ? 'Workspace subscription activated.' : 'Workspace credits added.')
        setRefreshKey((value) => value + 1)
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : 'Checkout verification failed.'))
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
    try {
      const result = await operation()
      if ('url' in result && result.url) {
        window.location.assign(result.url)
        return
      }
      toast.success('Billing settings updated.')
      setRefreshKey((value) => value + 1)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Workspace billing action failed.')
    } finally {
      setBusy(null)
    }
  }

  return {
    state,
    busy,
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
  const { busy, run } = billing

  return (
    <div data-testid="workspace-billing" className="space-y-4 p-5">
      {summary.storage ? (
        <dl className="flex items-center justify-between gap-4 rounded-xl border border-(--border) px-4 py-3 text-sm">
          <div className="flex w-full items-center justify-between gap-4">
            <dt className="font-medium text-(--foreground)">Storage</dt>
            <dd className="text-(--muted)">{formatBytes(summary.storage.usedBytes)} of {formatBytes(summary.storage.limitBytes)}</dd>
            <dd className="text-(--muted-light)">Included</dd>
          </div>
        </dl>
      ) : null}
      {!summary.initialized ? (
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
    <div className="rounded-xl border border-(--border) p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium text-(--foreground)">Free</p>
          <p className="mt-1 max-w-xl text-xs leading-5 text-(--muted)">Everyone working in this workspace shares one free weekly allowance of chat turns. Add a plan to give the workspace its own pool of credits for agents, files, automations, browser runs, and other hosted work, shared by every member.</p>
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
  const checkoutAvailable = summary.canTopUp

  return (
    <>
      <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
        <WalletCreditsCard summary={summary} />
        <WalletSubscriptionCard summary={summary} />
      </div>

      {summary.usage ? <WorkspaceUsagePanel usage={summary.usage} /> : null}

      {summary.autoTopUp ? (
        <WorkspaceAutoTopUpCard
          key={`${summary.autoTopUp.enabled}:${summary.autoTopUp.amountCents}:${summary.autoTopUp.monthlyLimitCents}`}
          autoTopUp={summary.autoTopUp}
          canManage={summary.canManage}
          periodEnd={summary.subscription.currentPeriodEnd}
          busy={busy === 'auto-top-up'}
          onSave={(input) => void run('auto-top-up', () => client.updateBillingAutoTopUp(workspaceId, input))}
        />
      ) : null}

      {checkoutAvailable ? <CheckoutActions client={client} workspaceId={workspaceId} summary={summary} billing={billing} /> : null}

      {summary.canManage ? (
        <div className="flex justify-end"><Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void run('portal', () => client.createBillingPortal(workspaceId))}>Manage billing</Button></div>
      ) : <p className="text-xs text-(--muted)">{summary.canTopUp ? 'Only workspace owners and admins can change the subscription.' : 'Only workspace owners and admins can add credits or change the subscription.'}</p>}

    </>
  )
}

function WalletCreditsCard({ summary }: { summary: WorkspaceBillingSummaryResponse }) {
  const allowanceUsed = Math.min(100, Math.max(0, summary.credits.allowancePercentUsed))
  return (
    <div className="rounded-xl border border-(--border) p-4">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-(--foreground)">Workspace credits</p>
          <p className="mt-1 text-xs text-(--muted)">{formatCredits(summary.credits.remaining)} remaining</p>
        </div>
        <span className="text-xs text-(--muted)">{allowanceUsed.toFixed(0)}% allowance used</span>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-(--surface-subtle)" aria-label={`${allowanceUsed.toFixed(0)}% allowance used`}>
        <div className="h-full rounded-full bg-(--foreground) transition-[width]" style={{ width: `${allowanceUsed}%` }} />
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
        <div><dt className="text-(--muted-light)">Used this period</dt><dd className="mt-1 text-(--foreground)">{formatCredits(summary.credits.used)}</dd></div>
        <div><dt className="text-(--muted-light)">Top-up credits</dt><dd className="mt-1 text-(--foreground)">{formatCredits(summary.credits.topUpBalance)}</dd></div>
      </dl>
    </div>
  )
}

function WalletSubscriptionCard({ summary }: { summary: WorkspaceBillingSummaryResponse }) {
  return (
    <div className="rounded-xl border border-(--border) p-4">
      <p className="text-sm font-medium text-(--foreground)">{summary.subscription.planKind === 'paid' ? `$${summary.subscription.planAmountCents / 100}/month` : 'No subscription'}</p>
      <p className="mt-1 text-xs leading-5 text-(--muted)">One plan for the whole workspace. Unlimited members. Owners and admins control funding.</p>
      {summary.subscription.status ? <span className="mt-3 inline-flex rounded-full bg-(--surface-subtle) px-2 py-1 text-[10px] font-medium capitalize text-(--muted)">{summary.subscription.status}</span> : null}
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
        {summary.canManage ? <BillingActionCard title="Monthly workspace credits" description="Choose a monthly amount from $8 to $500. It becomes the workspace’s credit each month.">
          <DollarAmountInput label="Workspace monthly plan" valueCents={planAmountCents} minCents={PAID_PLAN_MIN_AMOUNT_CENTS} maxCents={PAID_PLAN_MAX_AMOUNT_CENTS} suffix="/month" onChange={setPlanAmountCents} />
          <Button size="sm" disabled={busy !== null || !acceptedCheckoutTerms} onClick={() => void run('checkout', () => client.createBillingCheckout(workspaceId, { planAmountCents, topUpAmountCents, autoTopUpEnabled: false, ...currentLegalAcceptancePayload() }))}>{busy === 'checkout' ? <Loader2 size={13} className="animate-spin" /> : <CreditCard size={13} />}{summary.subscription.planKind === 'paid' ? 'Change plan' : 'Subscribe'}</Button>
        </BillingActionCard> : null}
        <BillingActionCard title="One-time top-up" description="Add credits to this workspace now. Like the monthly credit, it does not carry over to next month.">
          <DollarAmountInput label="Workspace top-up" valueCents={topUpAmountCents} minCents={TOP_UP_MIN_AMOUNT_CENTS} maxCents={TOP_UP_MAX_AMOUNT_CENTS} suffix="credit" onChange={setTopUpAmountCents} />
          <Button size="sm" variant="ghost" disabled={busy !== null || !acceptedCheckoutTerms} onClick={() => void run('topup', () => client.createBillingTopUp(workspaceId, { amountCents: topUpAmountCents, ...currentLegalAcceptancePayload() }))}>{busy === 'topup' ? <Loader2 size={13} className="animate-spin" /> : null}Add credits</Button>
        </BillingActionCard>
      </div>

      <div className="flex items-start gap-3 text-xs leading-5 text-(--muted)"><Toggle checked={acceptedCheckoutTerms} onCheckedChange={setAcceptedCheckoutTerms} aria-label="Agree to the Terms of Service, Privacy Policy, and billing terms" /><span>I agree to the current <a className="underline" href="/terms">Terms of Service</a>, <a className="underline" href="/privacy">Privacy Policy</a>, and <a className="underline" href="/refunds">billing and cancellation terms</a>.</span></div>
    </>
  )
}

function BillingActionCard({ children, description, title }: { children: ReactNode; description: string; title: string }) {
  return <div className="rounded-xl border border-(--border) p-4"><p className="text-sm font-medium text-(--foreground)">{title}</p><p className="mt-1 min-h-10 text-xs leading-5 text-(--muted)">{description}</p><div className="mt-4 flex items-center gap-2">{children}</div></div>
}

const CREDITS_FORMATTER = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

function formatCredits(value: number): string {
  return `${CREDITS_FORMATTER.format(value)} credits`
}
