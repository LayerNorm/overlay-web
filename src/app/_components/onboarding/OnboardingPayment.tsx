'use client'

import { useCallback, useEffect, useState } from 'react'
import { ArrowRight, Play } from 'lucide-react'
import { Button, Checkbox } from '@overlay/ui/primitives'
import type { WorkspaceBillingSummaryResponse } from '@overlay/workspace-contracts'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { currentLegalAcceptancePayload, LEGAL_DOCUMENTS } from '@/shared/legal/legal-documents'
import { EXECUTION_ACCESS_MESSAGES } from '@/shared/billing/execution-access'
import { navigateToOnboardingCheckout } from './checkout-navigation'

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
  if (ready) return <p role="status" className="text-sm">Your workspace is ready. Start when you are.</p>
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
          : <Button variant="primary" size="sm" disabled={locked || !accepted || !canManage} onClick={onSubscribe}>Subscribe<ArrowRight size={14} /></Button>}
    <Button variant="ghost" size="sm" disabled={locked} onClick={onEdit}>Edit task</Button>
    {!canManage || needsRecovery ? <Button variant="ghost" size="sm" disabled={locked} onClick={onRefresh}>Check billing</Button> : null}
  </div>
}

export function OnboardingPayment({ workspaceId, title, disabled, onPrepare, onStart, onEdit }: {
  workspaceId: string
  title: string
  disabled: boolean
  onPrepare(): Promise<unknown>
  onStart(): Promise<void>
  onEdit(): void
}) {
  const [summary, setSummary] = useState<WorkspaceBillingSummaryResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [accepted, setAccepted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [checkoutReturn, setCheckoutReturn] = useState<string | null>(null)

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const params = new URLSearchParams(window.location.search)
    const sessionId = params.get('onboarding_session_id')
    setCheckoutReturn(params.get('onboarding_billing'))
    let verificationError: string | null = null
    if (sessionId && params.get('onboarding_billing') === 'success') {
      try { await overlayAppClient.workspaces.verifyBillingCheckout(workspaceId, { kind: 'paid_plan', sessionId }, { signal }) }
      catch (failure) { verificationError = failure instanceof Error ? failure.message : 'Payment is not confirmed yet.' }
    }
    const next = await overlayAppClient.workspaces.billing(workspaceId, { signal, cache: 'no-store' })
    if (signal?.aborted) return
    setSummary(next)
    setError(next.executionAccess?.canExecute ? null : verificationError)
    if (next.executionAccess?.canExecute && sessionId) {
      params.delete('onboarding_session_id'); params.delete('onboarding_billing')
      window.history.replaceState(null, '', `${window.location.pathname}${params.size ? `?${params}` : ''}${window.location.hash}`)
      setCheckoutReturn(null)
    }
    return next
  }, [workspaceId])

  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let attempts = 0
    const check = async () => {
      try {
        const next = await refresh(controller.signal)
        const returning = new URLSearchParams(window.location.search).get('onboarding_billing') === 'success'
        if (!controller.signal.aborted && returning && !next?.executionAccess?.canExecute && ++attempts < 20) timer = setTimeout(() => { void check() }, 3000)
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Could not check workspace billing. Please retry.')
      }
    }
    void check()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [refresh])

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
  const access = summary?.executionAccess
  const ready = access?.canExecute === true
  const pending = !ready && (checkoutReturn === 'success' || access?.state === 'payment_pending')
  const needsRecovery = access?.state === 'budget_exhausted' || access?.state === 'billing_suspended'
  const locked = disabled || busy

  return <div className="space-y-4">
    <div className="rounded-xl bg-(--surface-elevated) p-3.5">
      <p className="text-[11px] font-medium text-muted-foreground">Your first task</p>
      <p className="mt-1 text-sm font-medium break-words">{title}</p>
      <p className="mt-1.5 text-xs text-muted-foreground">Saved as a draft. Nothing starts until you choose Start task.</p>
    </div>
    {!ready && !pending && !needsRecovery ? <BillingOffer canManage={summary?.canManage === true} locked={locked} accepted={accepted} setAccepted={setAccepted} /> : null}
    {checkoutReturn === 'canceled' ? <p role="status" className="text-xs text-muted-foreground">Checkout wasn’t completed. Your draft is saved.</p> : null}
    <BillingStatus ready={ready} pending={pending} needsRecovery={needsRecovery} access={access} />
    {summary && !summary.canManage && !ready ? <p className="text-sm">Ask a workspace owner or admin to activate billing. Your draft is saved.</p> : null}
    <BillingActions workspaceId={workspaceId} ready={ready} pending={pending} needsRecovery={needsRecovery}
      canManage={summary?.canManage === true} locked={locked} accepted={accepted}
      onStart={() => void run(onStart)} onSubscribe={() => void subscribe()}
      onRefresh={() => void run(async () => { await refresh() })} onEdit={onEdit} />
    <p className="text-xs text-muted-foreground">{ready ? 'Usage is charged to your workspace budget.' : 'No trial. Payment won’t start your task automatically.'}</p>
    {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
  </div>
}
