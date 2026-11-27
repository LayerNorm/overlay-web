'use client'

import { useEffect, useState } from 'react'
import { ArrowRight, Check, Download } from 'lucide-react'
import { Button, DialogFrame } from '@overlay/ui/primitives'
import type { WorkspaceBillingSummaryResponse } from '@overlay/workspace-contracts'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { currentLegalAcceptancePayload, LEGAL_DOCUMENTS } from '@/shared/legal/legal-documents'
import { DESKTOP_DOWNLOAD_PATH } from '@/shared/web/latest-release'
import { navigateToOnboardingCheckout } from './checkout-navigation'
import { trackOnboarding } from './onboarding-analytics'

const FREE = ['Overlay Desktop on your Mac', 'Runs on your own AI subscription', 'Personal chief and local tasks']
const USAGE = ['$8 of usage credit every month', 'Cloud computers and team threads', 'Connectors, Slack and automations']

/** Free or paid, shown once the first task is done and whenever a workspace without a plan reaches a paid feature. */
export function OnboardingPlanChoice({ open, workspaceId, summary, reason, onClose }: {
  open: boolean
  workspaceId: string
  summary: WorkspaceBillingSummaryResponse
  reason: 'first_task' | 'paid_feature'
  onClose(): void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { if (open) trackOnboarding('onboarding_plan_shown', { reason }) }, [open, reason])
  const chooseFree = () => {
    trackOnboarding('onboarding_plan_chosen', { plan: 'free', reason })
    window.open(DESKTOP_DOWNLOAD_PATH, '_blank', 'noopener')
    onClose()
  }
  const choosePaid = async () => {
    if (busy) return
    trackOnboarding('onboarding_plan_chosen', { plan: 'usage', reason })
    if (!summary.canManage) { window.location.assign(`/app/w/${encodeURIComponent(workspaceId)}/settings?section=workspace&workspace_tab=billing`); return }
    setBusy(true); setError(null)
    try {
      if (!summary.initialized) await overlayAppClient.workspaces.initializeBilling(workspaceId)
      const { url } = await overlayAppClient.workspaces.createBillingCheckout(workspaceId, {
        planAmountCents: 800, topUpAmountCents: 800, autoTopUpEnabled: false, ...currentLegalAcceptancePayload(),
      })
      if (!url) throw new Error('Checkout could not be opened. Please try again.')
      navigateToOnboardingCheckout(url)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Checkout could not be opened. Please try again.')
      setBusy(false)
    }
  }
  return (
    <DialogFrame open={open} onOpenChange={(next) => { if (!next) onClose() }} className="max-w-2xl"
      title={reason === 'first_task' ? 'Your first task is done' : 'Pick a plan to keep going'}
      description={reason === 'first_task' ? 'Keep Overlay working for you. Choose how you want to run it.' : 'This needs a plan. Choose how you want to run Overlay.'}>
      <div className="grid gap-3 sm:grid-cols-2">
        <section className="flex flex-col rounded-xl border border-(--border) p-4">
          <p className="text-sm font-medium">Free</p>
          <p className="mt-1"><strong className="text-2xl font-semibold">$0</strong></p>
          <ul className="mt-3 flex-1 space-y-1.5 text-[13px] text-muted-foreground">{FREE.map((item) => <li key={item} className="flex gap-2"><Check size={14} className="mt-0.5 shrink-0" />{item}</li>)}</ul>
          <Button className="mt-4" variant="secondary" size="sm" onClick={chooseFree}><Download size={14} />Download for Mac</Button>
        </section>
        <section className="flex flex-col rounded-xl border border-(--foreground)/30 p-4">
          <p className="text-sm font-medium">Usage</p>
          <p className="mt-1"><strong className="text-2xl font-semibold">$8</strong><span className="text-sm text-muted-foreground"> / month, then pay as you go</span></p>
          <ul className="mt-3 flex-1 space-y-1.5 text-[13px] text-muted-foreground">{USAGE.map((item) => <li key={item} className="flex gap-2"><Check size={14} className="mt-0.5 shrink-0" />{item}</li>)}</ul>
          <Button className="mt-4" variant="primary" size="sm" disabled={busy} onClick={() => void choosePaid()}>{summary.canManage ? 'Subscribe' : 'Ask an admin'}<ArrowRight size={14} /></Button>
        </section>
      </div>
      {error ? <p role="alert" className="mt-3 text-xs text-destructive">{error}</p> : null}
      <p className="mt-3 text-xs text-muted-foreground">By subscribing you agree to the <a className="underline" href={LEGAL_DOCUMENTS.terms.href} target="_blank" rel="noreferrer">Terms</a> and <a className="underline" href={LEGAL_DOCUMENTS.privacy.href} target="_blank" rel="noreferrer">Privacy Policy</a>. Cancel anytime in billing settings.</p>
    </DialogFrame>
  )
}

/** When the plan choice should show: the onboarding task finished, or the trial ran out with no plan. */
export function planChoiceReason(args: { taskStatus?: string; summary: WorkspaceBillingSummaryResponse | null | undefined; seen: { firstTask: boolean; paidFeature: boolean } }): 'first_task' | 'paid_feature' | null {
  const summary = args.summary
  if (!summary || (summary.subscription.planKind === 'paid' && summary.subscription.status !== 'canceled')) return null
  if (!args.seen.firstTask && (args.taskStatus === 'review' || args.taskStatus === 'done')) return 'first_task'
  const state = summary.executionAccess?.state
  if (!args.seen.paidFeature && summary.subscription.status !== 'trialing' && state === 'subscription_required') return 'paid_feature'
  if (!args.seen.paidFeature && summary.subscription.status === 'trialing' && state === 'budget_exhausted') return 'paid_feature'
  return null
}

const SEEN_KEY = (workspaceId: string) => `overlay:onboarding-plan-seen:${workspaceId}`

function readSeen(workspaceId: string): { firstTask: boolean; paidFeature: boolean } {
  try {
    const raw = JSON.parse(window.localStorage.getItem(SEEN_KEY(workspaceId)) ?? '{}') as Record<string, unknown>
    return { firstTask: raw.firstTask === true, paidFeature: raw.paidFeature === true }
  } catch { return { firstTask: false, paidFeature: false } }
}

/** Watches the onboarding task and the workspace's plan, and shows the plan choice once for each reason. */
export function OnboardingPlanGate({ workspaceId, taskStatus, summary }: {
  workspaceId: string
  taskStatus?: string
  summary: WorkspaceBillingSummaryResponse | null | undefined
}) {
  const [seen, setSeen] = useState(() => (typeof window === 'undefined' ? { firstTask: true, paidFeature: true } : readSeen(workspaceId)))
  const reason = planChoiceReason({ taskStatus, summary, seen })
  useEffect(() => { if (reason === 'first_task') trackOnboarding('onboarding_task_completed', {}) }, [reason])
  if (!reason || !summary) return null
  const close = () => {
    const next = { ...seen, [reason === 'first_task' ? 'firstTask' : 'paidFeature']: true }
    try { window.localStorage.setItem(SEEN_KEY(workspaceId), JSON.stringify(next)) } catch { /* private mode */ }
    setSeen(next)
  }
  return <OnboardingPlanChoice open workspaceId={workspaceId} summary={summary} reason={reason} onClose={close} />
}
