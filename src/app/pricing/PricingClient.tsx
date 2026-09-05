'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowRight, Check, ShieldCheck, Sparkles } from 'lucide-react'
import { DialogFrame } from '@overlay/ui/primitives'
import { MarketingFooter } from '@/features/marketing/components/MarketingFooter'
import { StaticMarketingShell } from '@/features/marketing/components/StaticMarketingShell'
import { AuthBoundary, useAuth } from '@/contexts/AuthContext'
import { LandingThemeProvider } from '@/contexts/LandingThemeContext'
import {
  PERSONAL_PLAN_CATALOG,
  TOP_UP_MIN_AMOUNT_CENTS,
  formatDollarAmount,
  type PersonalPlanDefinition,
  type PersonalPlanId,
} from '@/shared/billing/billing-pricing'
import { Reveal } from '@/features/marketing/components/Reveal'
import {
  minimalBody,
  minimalDisplay,
  minimalLabel,
  minimalPanel,
  minimalSection,
  minimalSerif,
} from '@/features/marketing/lib/minimalLayout'
import { formatBytes } from '@/shared/storage/storage-limits'
import { safeHttpUrl } from '@/shared/security/safe-url'
import { currentLegalAcceptancePayload, LEGAL_DOCUMENTS } from '@/shared/legal/legal-documents'

type PaidPlanId = Exclude<PersonalPlanId, 'free'>
type PaidPlan = PersonalPlanDefinition & { id: PaidPlanId }

type LandingSubscription = {
  planKind: 'free' | 'paid'
  planAmountCents: number
  planId: PersonalPlanId | null
  planDisplayName: string
  isLegacyPlan: boolean
  status: 'active' | 'trialing' | 'past_due' | 'canceled'
  cancelAtPeriodEnd?: boolean
  billingPeriodEnd?: number | string | null
}

type PlanChangePreview = {
  mode: 'preview'
  currency: string
  currentAmountCents: number
  currentQuantity: number
  direction: 'upgrade' | 'downgrade' | 'same'
  effectiveAt: number
  losesLegacyPricing: boolean
  planId: PaidPlanId
  prorationAmountCents: number
  targetAmountCents: number
  targetQuantity: number
}

const PLAN_COPY: Record<PersonalPlanId, { description: string; features: readonly string[] }> = {
  free: {
    description: 'Explore Overlay with the essentials.',
    features: [
      'Unlimited Auto model messages',
      'Chats, notes, files, and projects',
      'Core AI tools and workflows',
      '10 MB file storage',
    ],
  },
  starter: {
    description: 'For light, focused monthly use.',
    features: [
      '$8 included AI usage each month',
      'Premium models and agents',
      'Browser tasks and sandboxes',
      '1 GB file storage',
    ],
  },
  pro: {
    description: 'For regular individual work.',
    features: [
      '$24 included AI usage each month',
      'Premium models and agents',
      'Image and video generation',
      '3 GB file storage',
    ],
  },
  max: {
    description: 'For demanding daily workloads.',
    features: [
      '$96 included AI usage each month',
      'Premium models and agents',
      'Advanced generation and workflows',
      '12 GB file storage',
    ],
  },
}

const EMPTY_SUBSCRIPTION: LandingSubscription = {
  planKind: 'free',
  planAmountCents: 0,
  planId: 'free',
  planDisplayName: 'Free',
  isLegacyPlan: false,
  status: 'active',
}

function UserIdExtractor() {
  const searchParams = useSearchParams()

  useEffect(() => {
    const userId = searchParams?.get('userId')
    if (userId) sessionStorage.setItem('userId', userId)
  }, [searchParams])

  return null
}

function money(amountCents: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(amountCents / 100)
}

function dateLabel(timestamp: number | string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(timestamp))
}

type PricingLoadingState = 'checkout' | 'portal' | 'preview' | 'change' | null

function PricingHeader({ authLoading, isAuthenticated }: { authLoading: boolean; isAuthenticated: boolean }) {
  return (
    <Reveal>
      <div className="mx-auto max-w-3xl text-center">
        <p className={minimalLabel()}>Plans and pricing</p>
        <h1 className={`mt-6 ${minimalDisplay()}`} style={minimalSerif()}>
          A plan for the way you work.
        </h1>
        <p className={`mx-auto mt-6 max-w-2xl ${minimalBody()}`}>
          Every paid plan includes premium models and tools. Your monthly price becomes an included AI usage allowance—choose the level that fits your workload.
        </p>
        {!authLoading && !isAuthenticated ? (
          <p className="mt-5 text-sm text-[var(--muted)]">
            <Link href="/auth/sign-in?redirect=/pricing" className="font-medium text-[var(--foreground)] underline underline-offset-4">Sign in</Link>{' '}
            to subscribe or see your current plan.
          </p>
        ) : null}
      </div>
    </Reveal>
  )
}

function PricingNotices({
  error,
  loading,
  notice,
  onManageBilling,
  pendingPlan,
  subscription,
}: {
  error: string | null
  loading: PricingLoadingState
  notice: string | null
  onManageBilling: () => void
  pendingPlan: PaidPlan | null
  subscription: LandingSubscription
}) {
  return (
    <>
      {subscription.isLegacyPlan ? (
        <div className="flex flex-col gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-[var(--foreground)]">{subscription.planDisplayName} plan · Grandfathered</p>
            <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">You can keep your current price. Choosing a named plan permanently ends legacy pricing.</p>
          </div>
          <ShieldCheck className="h-5 w-5 shrink-0 text-amber-500" aria-hidden />
        </div>
      ) : null}

      {subscription.cancelAtPeriodEnd ? (
        <div className="flex flex-col gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-[var(--foreground)]">Cancellation scheduled</p>
            <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
              Your {subscription.planDisplayName} plan stays active
              {subscription.billingPeriodEnd ? ` until ${dateLabel(subscription.billingPeriodEnd)}` : ' through the current billing period'}.
              {' '}Resume it in billing before changing plans.
            </p>
          </div>
          <button
            type="button"
            onClick={onManageBilling}
            disabled={loading !== null}
            className="inline-flex shrink-0 items-center justify-center rounded-lg border border-[var(--button-secondary-border)] bg-[var(--button-secondary-bg)] px-4 py-2 text-sm font-medium text-[var(--button-secondary-text)] transition-[background-color,transform] hover:bg-[var(--surface-muted)] active:scale-[0.98] disabled:opacity-50"
          >
            {loading === 'portal' ? 'Opening billing…' : 'Manage billing'}
          </button>
        </div>
      ) : null}

      {notice ? (
        <div className="rounded-xl border border-[color:color-mix(in_srgb,var(--success)_35%,var(--border))] bg-[color:color-mix(in_srgb,var(--success)_9%,var(--surface-elevated))] px-5 py-4 text-sm text-[var(--success)]">{notice}</div>
      ) : null}
      {error && !pendingPlan ? (
        <div className="rounded-xl border border-[color:color-mix(in_srgb,var(--danger)_35%,var(--border))] bg-[color:color-mix(in_srgb,var(--danger)_10%,var(--surface-elevated))] px-5 py-4 text-sm text-[var(--danger)]">{error}</div>
      ) : null}
    </>
  )
}

function PricingContent({ billingEnabled }: { billingEnabled: boolean }) {
  const router = useRouter()
  const { user, isAuthenticated, isLoading: authLoading } = useAuth()
  const [subscription, setSubscription] = useState<LandingSubscription>(EMPTY_SUBSCRIPTION)
  const [subscriptionLoading, setSubscriptionLoading] = useState(false)
  const [pendingPlan, setPendingPlan] = useState<PaidPlan | null>(null)
  const [preview, setPreview] = useState<PlanChangePreview | null>(null)
  const [acceptedCheckoutTerms, setAcceptedCheckoutTerms] = useState(false)
  const [loading, setLoading] = useState<PricingLoadingState>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!billingEnabled || !isAuthenticated || !user?.id) return

    let active = true
    setSubscriptionLoading(true)
    void fetch(`/api/subscription?userId=${encodeURIComponent(user.id)}`, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Failed to load subscription')
        return await response.json() as LandingSubscription
      })
      .then((data) => {
        if (active) setSubscription(data)
      })
      .catch((fetchError) => {
        console.error('[Pricing] Failed to fetch subscription:', fetchError)
      })
      .finally(() => {
        if (active) setSubscriptionLoading(false)
      })

    return () => {
      active = false
    }
  }, [billingEnabled, isAuthenticated, user?.id])

  function closeDialog() {
    if (loading === 'checkout' || loading === 'change') return
    setPendingPlan(null)
    setPreview(null)
    setAcceptedCheckoutTerms(false)
    setError(null)
  }

  async function requestPaidPlan(plan: PaidPlan) {
    if (!billingEnabled) {
      setError('Billing is disabled for this deployment.')
      return
    }
    if (!isAuthenticated || !user) {
      router.push(`/auth/sign-in?redirect=${encodeURIComponent('/pricing')}`)
      return
    }
    if (subscription.status === 'past_due') {
      setError('Update your payment method before changing plans.')
      return
    }
    if (subscription.cancelAtPeriodEnd) {
      setError('Resume your subscription in billing before changing plans.')
      return
    }

    setError(null)
    setNotice(null)
    setAcceptedCheckoutTerms(false)

    if (subscription.planKind === 'free') {
      setPendingPlan(plan)
      setPreview(null)
      return
    }

    setLoading('preview')
    try {
      const response = await fetch('/api/subscription/change-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId: plan.id }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(data.error || 'Failed to preview this plan change.')
        return
      }
      setPendingPlan(plan)
      setPreview(data as PlanChangePreview)
    } catch (previewError) {
      console.error('[Pricing] Plan preview error:', previewError)
      setError('Failed to preview this plan change. Please try again.')
    } finally {
      setLoading(null)
    }
  }

  async function startCheckout(plan: PaidPlan) {
    setLoading('checkout')
    setError(null)
    try {
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planId: plan.id,
          topUpAmountCents: TOP_UP_MIN_AMOUNT_CENTS,
          autoTopUpEnabled: false,
          ...currentLegalAcceptancePayload(),
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        if (response.status === 401) {
          router.push(`/auth/sign-in?redirect=${encodeURIComponent('/pricing')}`)
          return
        }
        setError(data.error || 'Failed to start checkout.')
        return
      }
      const checkoutUrl = safeHttpUrl(data.url)
      if (!checkoutUrl) {
        setError('No checkout URL returned. Please try again.')
        return
      }
      window.location.href = checkoutUrl
    } catch (checkoutError) {
      console.error('[Pricing] Checkout error:', checkoutError)
      setError('Failed to start checkout. Please try again.')
    } finally {
      setLoading(null)
    }
  }

  async function confirmPlanChange(plan: PaidPlan) {
    setLoading('change')
    setError(null)
    try {
      const response = await fetch('/api/subscription/change-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId: plan.id, confirmation: 'CHANGE_PLAN' }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(data.error || 'Failed to change your plan.')
        return
      }
      if (data.paymentActionRequired) {
        setError('Your payment needs attention before the plan can change.')
        return
      }

      const scheduled = Boolean(data.scheduled)
      setNotice(scheduled
        ? `Your ${plan.label} plan will begin on ${dateLabel(data.effectiveAt)}.`
        : `You are now on the ${plan.label} plan.`)
      if (!scheduled) {
        setSubscription((current) => ({
          ...current,
          planId: plan.id,
          planDisplayName: plan.label,
          isLegacyPlan: false,
          planAmountCents: plan.amountCents,
        }))
      }
      window.dispatchEvent(new CustomEvent('overlay:billing-updated'))
      setPendingPlan(null)
      setPreview(null)
    } catch (changeError) {
      console.error('[Pricing] Plan change error:', changeError)
      setError('Failed to change your plan. Please try again.')
    } finally {
      setLoading(null)
    }
  }

  async function handleManageBilling() {
    setLoading('portal')
    setError(null)
    try {
      const response = await fetch('/api/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation: 'OPEN_BILLING_PORTAL' }),
      })
      const data = await response.json().catch(() => ({}))
      const portalUrl = safeHttpUrl(data.url)
      if (!response.ok || !portalUrl) {
        setError(data.error || 'Failed to open billing.')
        return
      }
      window.location.href = portalUrl
    } catch (portalError) {
      console.error('[Pricing] Portal error:', portalError)
      setError('Failed to open billing. Please try again.')
    } finally {
      setLoading(null)
    }
  }

  function planAction(plan: PersonalPlanDefinition) {
    const current = isAuthenticated && subscription.planId === plan.id && !subscription.isLegacyPlan

    if (current) {
      return (
        <div className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-[color:color-mix(in_srgb,var(--success)_35%,var(--border))] bg-[color:color-mix(in_srgb,var(--success)_9%,var(--surface-elevated))] px-4 py-2.5 text-sm font-medium text-[var(--success)]">
          <Check className="h-4 w-4" />
          Current plan
        </div>
      )
    }

    if (plan.id === 'free') {
      if (subscription.planKind === 'paid') {
        return (
          <button
            type="button"
            onClick={() => void handleManageBilling()}
            disabled={loading !== null || subscriptionLoading}
            className="inline-flex w-full items-center justify-center rounded-lg border border-[var(--button-secondary-border)] bg-[var(--button-secondary-bg)] px-4 py-2.5 text-sm font-medium text-[var(--button-secondary-text)] transition-[background-color,transform] hover:bg-[var(--surface-muted)] active:scale-[0.98] disabled:opacity-50"
          >
            {loading === 'portal' ? 'Opening billing…' : 'Manage cancellation'}
          </button>
        )
      }
      return (
        <Link
          href={isAuthenticated ? '/app/chat' : '/auth/sign-in?redirect=%2Fapp%2Fchat'}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--button-secondary-border)] bg-[var(--button-secondary-bg)] px-4 py-2.5 text-sm font-medium text-[var(--button-secondary-text)] transition-[background-color,transform] hover:bg-[var(--surface-muted)] active:scale-[0.98]"
        >
          Start free
          <ArrowRight className="h-4 w-4" />
        </Link>
      )
    }

    return (
      <button
        type="button"
        onClick={() => void requestPaidPlan(plan as PaidPlan)}
        disabled={loading !== null || subscriptionLoading}
        className={`${plan.id === 'pro'
          ? 'bg-[var(--button-primary-bg)] text-[var(--button-primary-text)] hover:opacity-90'
          : 'border border-[var(--button-secondary-border)] bg-[var(--button-secondary-bg)] text-[var(--button-secondary-text)] hover:bg-[var(--surface-muted)]'} inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-[background-color,opacity,transform] active:scale-[0.98] disabled:opacity-50`}
      >
        {loading === 'preview' ? 'Preparing…' : subscription.planKind === 'paid' ? `Choose ${plan.label}` : `Get ${plan.label}`}
        <ArrowRight className="h-4 w-4" />
      </button>
    )
  }

  if (!billingEnabled) {
    return (
      <StaticMarketingShell>
        <main className={minimalSection()}>
          <div className="mx-auto max-w-2xl text-center">
            <p className={minimalLabel()}>Plans and pricing</p>
            <h1 className={`mt-6 ${minimalDisplay()}`} style={minimalSerif()}>Billing unavailable.</h1>
            <p className={`mx-auto mt-6 max-w-xl ${minimalBody()} `}>
              This deployment does not use Overlay-managed billing. Workspace access is controlled by the deployment administrator.
            </p>
          </div>
        </main>
        <MarketingFooter />
      </StaticMarketingShell>
    )
  }

  const isNewPurchase = subscription.planKind === 'free'
  const dialogTitle = pendingPlan
    ? isNewPurchase ? `Subscribe to ${pendingPlan.label}` : `Change to ${pendingPlan.label}`
    : 'Confirm plan'

  return (
    <StaticMarketingShell>
      <Suspense fallback={null}><UserIdExtractor /></Suspense>
      <main className={minimalSection()}>
        <div className="mx-auto flex max-w-6xl flex-col gap-12">
          <PricingHeader authLoading={authLoading} isAuthenticated={isAuthenticated} />
          <PricingNotices
            error={error}
            loading={loading}
            notice={notice}
            onManageBilling={() => { void handleManageBilling() }}
            pendingPlan={pendingPlan}
            subscription={subscription}
          />

          <Reveal>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {PERSONAL_PLAN_CATALOG.map((plan) => {
                const isPro = plan.id === 'pro'
                return (
                  <section
                    key={plan.id}
                    className={`${minimalPanel()} relative flex min-h-[470px] flex-col p-5 sm:p-6 ${isPro ? 'border-[color:color-mix(in_srgb,var(--foreground)_32%,var(--border))] shadow-[0_18px_50px_rgba(0,0,0,0.08)]' : ''}`}
                  >
                    {isPro ? (
                      <span className="absolute right-4 top-4 inline-flex items-center gap-1 rounded-full bg-[var(--surface-muted)] px-2 py-1 text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--foreground)]">
                        <Sparkles className="h-3 w-3" /> Most popular
                      </span>
                    ) : null}
                    <div className="pr-16">
                      <h2 className="text-lg font-semibold text-[var(--foreground)]">{plan.label}</h2>
                      <p className="mt-2 min-h-10 text-sm leading-5 text-[var(--muted)]">{PLAN_COPY[plan.id].description}</p>
                    </div>
                    <div className="mt-8">
                      <div className="flex items-end gap-1.5">
                        <span className="font-serif text-4xl tracking-tight text-[var(--foreground)]">${plan.amountCents / 100}</span>
                        {plan.amountCents > 0 ? <span className="pb-1 text-sm text-[var(--muted)]">/ month</span> : null}
                      </div>
                      <p className="mt-2 text-xs text-[var(--muted)]">
                        {plan.amountCents > 0 ? `${formatBytes(plan.storageBytes)} storage` : 'No credit card required'}
                      </p>
                    </div>
                    <ul className="mt-7 space-y-3">
                      {PLAN_COPY[plan.id].features.map((feature) => (
                        <li key={feature} className="flex items-start gap-2.5 text-sm leading-5 text-[var(--foreground)]">
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--success)]" aria-hidden />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="mt-auto pt-8">{planAction(plan)}</div>
                  </section>
                )
              })}
            </div>
          </Reveal>

          <Reveal>
            <section className={`${minimalPanel()} grid gap-6 p-6 md:grid-cols-[1fr_auto] md:items-center`}>
              <div>
                <h2 className="text-base font-medium text-[var(--foreground)]">Need more usage during a busy month?</h2>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--muted)]">
                  Add one-time balance or turn on automatic top-ups from Account. Auto top-up is always off until you explicitly enable it there.
                </p>
              </div>
              <Link
                href="/app/settings?section=account"
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--button-secondary-border)] bg-[var(--button-secondary-bg)] px-4 py-2.5 text-sm font-medium text-[var(--button-secondary-text)] transition-[background-color,transform] hover:bg-[var(--surface-muted)] active:scale-[0.98]"
              >
                Billing settings <ArrowRight className="h-4 w-4" />
              </Link>
            </section>
          </Reveal>
        </div>
      </main>

      <DialogFrame
        open={Boolean(pendingPlan)}
        onOpenChange={(open) => { if (!open) closeDialog() }}
        title={dialogTitle}
        description={pendingPlan ? `${formatDollarAmount(pendingPlan.amountCents)} per month · ${formatBytes(pendingPlan.storageBytes)} storage` : undefined}
        className="w-[min(480px,92vw)] p-6"
        footer={pendingPlan ? (
          <>
            <button
              type="button"
              onClick={closeDialog}
              disabled={loading === 'checkout' || loading === 'change'}
              className="rounded-lg px-4 py-2.5 text-sm font-medium text-[var(--muted)] transition-[color,transform] hover:text-[var(--foreground)] active:scale-[0.98] disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void (isNewPurchase ? startCheckout(pendingPlan) : confirmPlanChange(pendingPlan))}
              disabled={(isNewPurchase && !acceptedCheckoutTerms) || loading === 'checkout' || loading === 'change'}
              className="rounded-lg bg-[var(--button-primary-bg)] px-4 py-2.5 text-sm font-medium text-[var(--button-primary-text)] transition-[opacity,transform] hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {loading === 'checkout' ? 'Opening checkout…' : loading === 'change' ? 'Updating plan…' : preview?.direction === 'downgrade' ? 'Schedule downgrade' : isNewPurchase ? 'Continue to checkout' : 'Confirm change'}
            </button>
          </>
        ) : null}
      >
        {pendingPlan ? (
          <div className="mt-5 space-y-4">
            {preview ? (
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                <div className="flex items-center justify-between gap-4 text-sm">
                  <span className="text-[var(--muted)]">New monthly price</span>
                  <span className="font-medium text-[var(--foreground)]">{money(preview.targetAmountCents)}</span>
                </div>
                <div className="mt-3 flex items-center justify-between gap-4 text-sm">
                  <span className="text-[var(--muted)]">{preview.direction === 'downgrade' ? 'Changes on' : 'Estimated charge today'}</span>
                  <span className="text-right font-medium text-[var(--foreground)]">
                    {preview.direction === 'downgrade' ? dateLabel(preview.effectiveAt) : money(Math.max(0, preview.prorationAmountCents))}
                  </span>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-4 text-sm leading-relaxed text-[var(--muted)]">
                You’ll review payment details in Stripe before subscribing. Automatic top-ups stay off and can be enabled later in Account.
              </div>
            )}

            {preview?.losesLegacyPricing ? (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm leading-relaxed text-[var(--foreground)]">
                This change permanently ends your grandfathered pricing. You won’t be able to return to the legacy plan.
              </div>
            ) : null}

            {isNewPurchase ? (
              <label className="flex cursor-pointer items-start gap-3 text-xs leading-5 text-[var(--muted)]">
                <input
                  type="checkbox"
                  checked={acceptedCheckoutTerms}
                  onChange={(event) => setAcceptedCheckoutTerms(event.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-[var(--input-border)]"
                />
                <span>
                  I agree to the <Link className="text-[var(--foreground)] underline" href={LEGAL_DOCUMENTS.terms.href}>Terms of Service</Link>, acknowledge the <Link className="text-[var(--foreground)] underline" href={LEGAL_DOCUMENTS.privacy.href}>Privacy Policy</Link>, and agree to the <Link className="text-[var(--foreground)] underline" href="/refunds">recurring billing and refund terms</Link>.
                </span>
              </label>
            ) : null}

            {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
          </div>
        ) : null}
      </DialogFrame>
      <MarketingFooter />
    </StaticMarketingShell>
  )
}

export default function PricingClient({ billingEnabled }: { billingEnabled: boolean }) {
  return (
    <AuthBoundary>
      <LandingThemeProvider>
        <PricingContent billingEnabled={billingEnabled} />
      </LandingThemeProvider>
    </AuthBoundary>
  )
}
