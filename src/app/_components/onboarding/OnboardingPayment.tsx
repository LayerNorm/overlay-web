'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { ArrowRight, Play } from 'lucide-react'
import { Button, Checkbox } from '@overlay/ui/primitives'
import type { WorkspaceBillingSummaryResponse } from '@overlay/workspace-contracts'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { useLiveWorkspaceBilling } from '@/hooks/use-billing'
import { currentLegalAcceptancePayload, LEGAL_DOCUMENTS } from '@/shared/legal/legal-documents'
import { EXECUTION_ACCESS_MESSAGES } from '@/shared/billing/execution-access'
import { navigateToOnboardingCheckout } from './checkout-navigation'
import { onboardingTaskMessage } from '@/shared/onboarding/billing-copy'
import { OverlayMark } from '@/components/brand/OverlayMark'

function BillingOffer({ canManage, locked, accepted, setAccepted }: {
  canManage: boolean
  locked: boolean
  accepted: boolean
  setAccepted(value: boolean): void
}) {
  return <>
    <div><p><strong className="text-2xl font-semibold">$8</strong><span className="text-sm text-muted-foreground"> / month</span></p>
      <p className="mt-2 text-sm">$8 in usage credit for models, computers and tools.</p>
      <p className="mt-1 text-xs text-muted-foreground">Renews monthly. Unused credit expires at renewal. Cancel in billing settings.</p>
    </div>
    {canManage ? <label className="flex items-start gap-2 text-xs text-muted-foreground">
      <Checkbox checked={accepted} disabled={locked} onCheckedChange={(value) => setAccepted(value === true)} aria-label="Accept terms and privacy policy" />
      <span>I agree to the <a className="underline" href={LEGAL_DOCUMENTS.terms.href} target="_blank" rel="noreferrer">Terms of Service</a> and <a className="underline" href={LEGAL_DOCUMENTS.privacy.href} target="_blank" rel="noreferrer">Privacy Policy</a>.</span>
    </label> : null}
  </>
}

function BillingStatus({ ready, pending, needsRecovery, access }: {
  ready: boolean
  pending: boolean
  needsRecovery: boolean
  access: WorkspaceBillingSummaryResponse['executionAccess'] | undefined
}) {
  if (ready) return null
  if (pending) return <p role="status" className="text-sm">Confirming your payment. Your task won’t start automatically.</p>
  return needsRecovery && access ? <p role="status" className="text-sm">{EXECUTION_ACCESS_MESSAGES[access.state]}</p> : null
}

function BillingActions({ workspaceId, ready, pending, needsRecovery, canManage, locked, accepted, onStart, onSubscribe, onRefresh, onEdit }: {
  workspaceId: string
  ready: boolean
  pending: boolean
  needsRecovery: boolean
  canManage: boolean
  locked: boolean
  accepted: boolean
  onStart(): void
  onSubscribe(): void
  onRefresh(): void
  onEdit(): void
}) {
  return <div className="flex flex-wrap items-center gap-2">
    {ready ? <Button variant="primary" size="sm" disabled={locked} onClick={onStart}><Play size={13} />Start task</Button>
      : pending ? <Button variant="primary" size="sm" disabled={locked} onClick={onRefresh}>Check payment</Button>
        : needsRecovery ? canManage ? <Button variant="primary" size="sm" disabled={locked} onClick={() => window.location.assign(`/app/w/${encodeURIComponent(workspaceId)}/settings?section=workspace&workspace_tab=billing`)}>Open billing</Button> : null
          : canManage ? <Button variant="primary" size="sm" disabled={locked || !accepted} onClick={onSubscribe}>Subscribe<ArrowRight size={14} /></Button> : null}
    <Button variant="ghost" size="sm" disabled={locked} onClick={onEdit}>Edit task</Button>
  </div>
}

type PaymentProps = {
  workspaceId: string
  workspaceName?: string
  personal?: boolean
  billingContactName?: string | null
  showReply?: boolean
  summary?: WorkspaceBillingSummaryResponse | null
  requested?: boolean
  onRequestedChange?(requested: boolean): void
  title: string
  disabled: boolean
  onPrepare(): Promise<unknown>
  onStart(): Promise<void>
  onEdit(): void
  onOpenWork?(): Promise<void>
}

export function OnboardingPayment(props: PaymentProps) {
  return 'summary' in props ? <OnboardingPaymentState {...props} /> : <LiveOnboardingPayment {...props} />
}

function MemberBillingControls({ summary, ready, workspaceName, billingContactName, locked, requested, onRequest, onOpenWork, children }: {
  summary: WorkspaceBillingSummaryResponse
  ready: boolean
  workspaceName: string
  billingContactName?: string | null
  locked: boolean
  requested: boolean
  onRequest(): void
  onOpenWork?: () => void
  children: ReactNode
}) {
  const memberRequest = !summary.canManage && summary.executionAccess?.state === 'subscription_required'
  const contact = billingContactName || 'An admin'
  return <>
    <div className="flex flex-wrap items-center gap-2">
      {memberRequest ? <Button variant="primary" size="sm" disabled={locked || requested} onClick={onRequest}>{requested ? 'Request sent' : billingContactName ? `Ask ${billingContactName} to subscribe` : 'Ask an admin to subscribe'}</Button> : null}
      {children}
      {!ready && !summary.canManage && onOpenWork ? <Button variant="secondary" size="sm" disabled={locked} onClick={onOpenWork}>Open Work</Button> : null}
    </div>
    {requested ? <p role="status" className="text-xs text-muted-foreground">{ready
      ? `${workspaceName} is now subscribed. Your task is ready when you are.`
      : `${contact} has been asked. Your draft starts when you choose, once ${workspaceName} is subscribed.`}</p> : null}
  </>
}

function LiveOnboardingPayment(props: PaymentProps) {
  const summary = useLiveWorkspaceBilling(props.workspaceId)
  return <OnboardingPaymentState {...props} summary={summary} />
}

export function OnboardingPaymentState({
  workspaceId,
  workspaceName = 'Your workspace',
  personal = true,
  billingContactName,
  showReply = true,
  summary,
  requested: controlledRequested,
  onRequestedChange,
  title,
  disabled,
  onPrepare,
  onStart,
  onEdit,
  onOpenWork,
}: PaymentProps) {
  const [busy, setBusy] = useState(false)
  const [localRequested, setLocalRequested] = useState(false)
  const requested = controlledRequested ?? localRequested
  const setRequested = onRequestedChange ?? setLocalRequested
  const [accepted, setAccepted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [checkoutReturn, setCheckoutReturn] = useState<string | null>(null)
  const [verificationError, setVerificationError] = useState<string | null>(null)

  // Returning from checkout: confirm the session (again on "Check payment"); the live summary then shows the result.
  const verifyCheckout = useCallback(async (signal?: AbortSignal) => {
    const params = new URLSearchParams(window.location.search)
    const sessionId = params.get('onboarding_session_id')
    if (!sessionId || params.get('onboarding_billing') !== 'success') return
    try {
      await overlayAppClient.workspaces.verifyBillingCheckout(workspaceId, { kind: 'paid_plan', sessionId }, { signal })
      setVerificationError(null)
    } catch (failure) {
      if (!signal?.aborted) setVerificationError(failure instanceof Error ? failure.message : 'Payment is not confirmed yet.')
    }
  }, [workspaceId])
  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams(window.location.search)
    queueMicrotask(() => setCheckoutReturn(params.get('onboarding_billing')))
    void verifyCheckout(controller.signal)
    return () => controller.abort()
  }, [verifyCheckout])

  const canExecute = summary?.executionAccess?.canExecute === true
  useEffect(() => {
    if (!canExecute) return
    const params = new URLSearchParams(window.location.search)
    if (!params.has('onboarding_session_id')) return
    params.delete('onboarding_session_id'); params.delete('onboarding_billing')
    window.history.replaceState(null, '', `${window.location.pathname}${params.size ? `?${params}` : ''}${window.location.hash}`)
  }, [canExecute])
  const shownError = error ?? (canExecute ? null : verificationError)

  const run = async (operation: () => Promise<void>) => {
    if (busy || disabled) return
    setBusy(true); setError(null)
    try { await operation() }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Your draft is saved. Please retry.') }
    finally { setBusy(false) }
  }
  const subscribe = () => run(async () => {
    if (!accepted || !summary?.canManage) return
    await onPrepare()
    if (!summary.initialized) await overlayAppClient.workspaces.initializeBilling(workspaceId)
    const { url } = await overlayAppClient.workspaces.createBillingCheckout(workspaceId, {
      planAmountCents: 800, topUpAmountCents: 800, autoTopUpEnabled: false, returnTo: 'onboarding', ...currentLegalAcceptancePayload(),
    })
    if (!url) throw new Error('Checkout could not be opened. Your draft is saved.')
    navigateToOnboardingCheckout(url)
  })
  const requestBilling = () => run(async () => {
    await onPrepare()
    const response = await fetch(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/billing/request`, {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}',
    })
    const body = await response.json().catch(() => null)
    if (!response.ok) throw new Error(body?.error ?? 'Could not request billing. Your draft is saved.')
    setRequested(true)
  })
  const access = summary?.executionAccess
  const ready = access?.canExecute === true
  const pending = !ready && (checkoutReturn === 'success' || access?.state === 'payment_pending')
  const needsRecovery = access?.state === 'budget_exhausted' || access?.state === 'billing_suspended'
  const locked = disabled || busy

  if (summary === undefined) return <p role="status" className="text-sm text-muted-foreground">Loading workspace billing...</p>
  if (summary === null) return <p role="alert" className="text-sm text-muted-foreground">Workspace billing is unavailable. Please reload and try again.</p>

  return <div className="space-y-4">
    {showReply ? <p className="text-sm leading-relaxed">{onboardingTaskMessage(summary, workspaceName)}</p> : null}
    <div className="rounded-xl bg-(--surface-subtle) p-4">
      <p className="text-[11px] text-muted-foreground">First task</p>
      <p className="mt-1 text-sm font-medium break-words">{title}</p>
      <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><OverlayMark size={16} />Overlay<span className="ml-2">{personal ? 'Personal' : workspaceName}</span></div>
    </div>
    {summary.canManage && !ready && !pending && !needsRecovery ? <BillingOffer canManage locked={locked} accepted={accepted} setAccepted={setAccepted} /> : null}
    {checkoutReturn === 'canceled' ? <p role="status" className="text-xs text-muted-foreground">Checkout wasn’t completed. Your draft is saved.</p> : null}
    <BillingStatus ready={ready} pending={pending} needsRecovery={needsRecovery} access={access} />
    {!summary.canManage && needsRecovery ? <p className="text-sm">Ask a workspace owner or admin to activate billing. Your draft is saved.</p> : null}
    <MemberBillingControls summary={summary} ready={ready} workspaceName={workspaceName}
      billingContactName={billingContactName} locked={locked} requested={requested}
      onRequest={() => void requestBilling()} onOpenWork={onOpenWork && (() => void run(onOpenWork))}>
      <BillingActions workspaceId={workspaceId} ready={ready} pending={pending} needsRecovery={needsRecovery}
        canManage={summary.canManage} locked={locked} accepted={accepted}
        onStart={() => void run(onStart)} onSubscribe={() => void subscribe()}
        onRefresh={() => void run(() => verifyCheckout())} onEdit={onEdit} />
    </MemberBillingControls>
    {ready || summary.canManage ? <p className="text-xs text-muted-foreground">{ready ? `Usage is charged to ${workspaceName}'s workspace budget.` : 'No trial. Payment won’t start your task automatically.'}</p> : null}
    {shownError ? <p role="alert" className="text-xs text-destructive">{shownError}</p> : null}
  </div>
}
