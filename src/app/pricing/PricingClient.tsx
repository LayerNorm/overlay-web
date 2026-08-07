'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowRight, Check, MessageSquare, SlidersHorizontal } from 'lucide-react'
import { MarketingFooter } from '@/features/marketing/components/MarketingFooter'
import { StaticMarketingShell } from '@/features/marketing/components/StaticMarketingShell'
import { AuthBoundary, useAuth } from '@/contexts/AuthContext'
import { LandingThemeProvider } from '@/contexts/LandingThemeContext'
import {
  PAID_PLAN_MAX_AMOUNT_CENTS,
  PAID_PLAN_MIN_AMOUNT_CENTS,
  PAID_PLAN_STEP_AMOUNT_CENTS,
  TOP_UP_MIN_AMOUNT_CENTS,
  centsToDollarAmount,
  formatDollarAmount,
  getStorageLimitBytes,
} from '@/shared/billing/billing-pricing'
import { PricingControlPreview } from '@/features/marketing/components/MarketingShowcase'
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

const TIER_STARTER_CENTS = 800
const TIER_PRO_CENTS = 2_400
const TIER_MAX_CENTS = 9_600

type TierId = 'free' | 'starter' | 'pro' | 'max' | 'custom'

function tierIdForPaidAmount(cents: number): TierId {
  if (cents === TIER_STARTER_CENTS) return 'starter'
  if (cents === TIER_PRO_CENTS) return 'pro'
  if (cents === TIER_MAX_CENTS) return 'max'
  return 'custom'
}

const PAID_FEATURE_BULLETS = [
  'Premium chat models',
  'Daytona sandboxes',
  'Browser tasks',
  'Image and video generation',
  'Advanced agents and premium workflows',
]

const PAID_FEATURE_BULLETS_COMPACT = PAID_FEATURE_BULLETS.slice(0, 4)

const PAID_OPTIONS: Array<{ tier: TierId; label: string; amountCents: number; note: string }> = [
  { tier: 'starter', label: 'Cheapest', amountCents: TIER_STARTER_CENTS, note: 'For light monthly use' },
  { tier: 'pro', label: 'Most popular', amountCents: TIER_PRO_CENTS, note: 'For regular work' },
  { tier: 'max', label: 'Best value', amountCents: TIER_MAX_CENTS, note: '12 GB storage' },
]

function UserIdExtractor() {
  const searchParams = useSearchParams()

  useEffect(() => {
    const userId = searchParams?.get('userId')
    if (userId) {
      sessionStorage.setItem('userId', userId)
    }
  }, [searchParams])

  return null
}

function PricingContent({ billingEnabled }: { billingEnabled: boolean }) {
  const router = useRouter()
  const { user, isAuthenticated, isLoading: authLoading } = useAuth()
  const [selectedTier, setSelectedTier] = useState<TierId>('starter')
  const [selectedPlanAmountCents, setSelectedPlanAmountCents] = useState(TIER_STARTER_CENTS)
  const [autoTopUpEnabled, setAutoTopUpEnabled] = useState(false)
  const [currentPlanKind, setCurrentPlanKind] = useState<'free' | 'paid'>('free')
  const [currentPlanAmountCents, setCurrentPlanAmountCents] = useState(0)
  const [loading, setLoading] = useState<'checkout' | 'portal' | 'topup-settings' | null>(null)
  const [subscriptionLoading, setSubscriptionLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!billingEnabled) return
    if (!isAuthenticated || !user?.id) return

    let active = true
    setSubscriptionLoading(true)

    void Promise.all([
      fetch(`/api/subscription?userId=${encodeURIComponent(user.id)}`).then(async (response) => {
        if (!response.ok) return null
        return await response.json()
      }),
      fetch('/api/subscription/settings').then(async (response) => {
        if (!response.ok) return null
        return await response.json()
      }),
    ])
      .then(([subscriptionData, settingsData]) => {
        if (!active) return
        if (subscriptionData) {
          const planKind = subscriptionData.planKind === 'paid' ? 'paid' : 'free'
          const planAmountCents = Math.max(0, Math.round(Number(subscriptionData.planAmountCents ?? 0)))
          setCurrentPlanKind(planKind)
          setCurrentPlanAmountCents(planAmountCents)
          if (planKind === 'paid' && planAmountCents >= PAID_PLAN_MIN_AMOUNT_CENTS) {
            setSelectedPlanAmountCents(planAmountCents)
            setSelectedTier(tierIdForPaidAmount(planAmountCents))
          }
        }
        if (settingsData) {
          setAutoTopUpEnabled(Boolean(settingsData.autoTopUpEnabled))
        }
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

  const selectedPlanDollars = centsToDollarAmount(selectedPlanAmountCents)
  const selectedStorageBytes = useMemo(
    () => getStorageLimitBytes({ planKind: 'paid', planAmountCents: selectedPlanAmountCents }),
    [selectedPlanAmountCents],
  )

  const theme = {
    title: 'font-serif text-4xl tracking-tight text-[var(--foreground)]',
    heading: 'text-[var(--foreground)]',
    body: 'text-[var(--muted)]',
    muted: 'text-[var(--muted)]',
    panel: minimalPanel(),
    heroGlow: '',
    primaryButton:
      'bg-[var(--button-primary-bg)] text-[var(--button-primary-text)] hover:opacity-90',
    secondaryButton:
      'border border-[var(--button-secondary-border)] bg-[var(--button-secondary-bg)] text-[var(--button-secondary-text)] hover:bg-[var(--surface-muted)]',
    badge: 'bg-[var(--button-primary-bg)] text-[var(--button-primary-text)]',
    iconChip:
      'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] text-[var(--foreground)]',
    tierCard:
      'flex h-full flex-col rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-6',
    subtleCard: 'rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4',
    sliderTrack:
      'mt-3 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[var(--surface-subtle)] accent-[var(--foreground)]',
    currentPlanPill:
      'inline-flex w-full items-center justify-center rounded-xl border border-[color:color-mix(in_srgb,var(--success)_45%,transparent)] bg-[color:color-mix(in_srgb,var(--success)_14%,transparent)] px-4 py-3 text-sm text-[var(--success)]',
  }

  function tierCardClass(tier: TierId) {
    const selected = selectedTier === tier
    return `${theme.tierCard} transition-all duration-200 ${selected ? 'ring-2 ring-[color:color-mix(in_srgb,var(--foreground)_15%,transparent)]' : ''}`
  }

  function selectTier(tier: TierId, amountCents?: number) {
    setSelectedTier(tier)
    if (tier === 'free') return
    if (tier === 'custom' && typeof amountCents === 'number') {
      setSelectedPlanAmountCents(amountCents)
      return
    }
    if (tier === 'starter') setSelectedPlanAmountCents(TIER_STARTER_CENTS)
    else if (tier === 'pro') setSelectedPlanAmountCents(TIER_PRO_CENTS)
    else if (tier === 'max') setSelectedPlanAmountCents(TIER_MAX_CENTS)
    else if (tier === 'custom') setSelectedPlanAmountCents((prev) => prev)
  }

  const selectedPaidOption = PAID_OPTIONS.find((option) => option.tier === selectedTier) ?? PAID_OPTIONS[0]

  function renderPaidTierToggle() {
    return (
      <div className="grid grid-cols-3 gap-1 rounded-full border border-[var(--border)] bg-[var(--surface-muted)] p-1">
      {PAID_OPTIONS.map((option) => {
        const active = selectedTier === option.tier
        return (
          <button
            key={option.tier}
            type="button"
            onClick={() => selectTier(option.tier)}
            className={`rounded-full px-2 py-2 text-xs transition-colors ${
              active
                ? 'bg-[var(--button-primary-bg)] text-[var(--button-primary-text)]'
                : theme.muted
            }`}
          >
            {option.label}
          </button>
        )
      })}
      </div>
    )
  }

  async function startCheckout(planAmountCents: number, tier?: TierId) {
    if (!billingEnabled) {
      setError('Billing is disabled for this deployment.')
      return
    }
    if (tier) {
      if (tier === 'custom') selectTier('custom', planAmountCents)
      else selectTier(tier)
    }

    if (!isAuthenticated || !user) {
      router.push(`/auth/sign-in?redirect=${encodeURIComponent('/pricing')}`)
      return
    }

    setLoading('checkout')
    setError(null)

    try {
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planAmountCents,
          topUpAmountCents: TOP_UP_MIN_AMOUNT_CENTS,
          autoTopUpEnabled,
        }),
      })

      const data = await response.json()
      if (!response.ok) {
        if (response.status === 401) {
          router.push(`/auth/sign-in?redirect=${encodeURIComponent('/pricing')}`)
          return
        }
        setError(data.error || 'Failed to start checkout.')
        return
      }

      if (data.url) {
        window.location.href = data.url
        return
      }

      setError('No checkout URL returned. Please try again.')
    } catch (checkoutError) {
      console.error('[Pricing] Checkout error:', checkoutError)
      setError('Failed to start checkout. Please try again.')
    } finally {
      setLoading(null)
    }
  }

  async function handleManageBilling() {
    if (!billingEnabled) {
      setError('Billing is disabled for this deployment.')
      return
    }
    setLoading('portal')
    setError(null)

    try {
      const response = await fetch('/api/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation: 'OPEN_BILLING_PORTAL' }),
      })
      const data = await response.json()
      if (!response.ok || !data.url) {
        setError(data.error || 'Failed to open billing portal.')
        return
      }
      window.location.href = data.url
    } catch (portalError) {
      console.error('[Pricing] Portal error:', portalError)
      setError('Failed to open billing portal.')
    } finally {
      setLoading(null)
    }
  }

  async function handleSaveTopUpPreference() {
    if (!billingEnabled) {
      setError('Billing is disabled for this deployment.')
      return
    }
    setLoading('topup-settings')
    setError(null)

    try {
      const response = await fetch('/api/subscription/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topUpAmountCents: TOP_UP_MIN_AMOUNT_CENTS,
          autoTopUpEnabled,
          confirmation: 'UPDATE_BILLING_SETTINGS',
          grantOffSessionConsent: autoTopUpEnabled,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(data.error || 'Failed to save top-up preference.')
      }
    } catch (saveError) {
      console.error('[Pricing] Top-up settings error:', saveError)
      setError('Failed to save top-up preference.')
    } finally {
      setLoading(null)
    }
  }

  function paidCtaForAmount(cardAmountCents: number, cardTier: TierId) {
    const subscribedTier =
      currentPlanKind === 'paid' ? tierIdForPaidAmount(currentPlanAmountCents) : null
    const isCurrent =
      currentPlanKind === 'paid' &&
      subscribedTier === cardTier &&
      currentPlanAmountCents === cardAmountCents
    const isAnotherPaid = currentPlanKind === 'paid' && !isCurrent

    if (currentPlanKind === 'paid' && isCurrent) {
      return (
        <div className={theme.currentPlanPill}>
          {subscriptionLoading ? 'Loading plan…' : 'Current plan'}
        </div>
      )
    }

    if (currentPlanKind === 'paid' && isAnotherPaid) {
      return (
        <button
          type="button"
          onClick={() => void handleManageBilling()}
          disabled={loading === 'portal' || subscriptionLoading}
          className={`inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-medium transition-colors disabled:opacity-50 ${theme.secondaryButton}`}
        >
          {loading === 'portal' ? 'Opening billing portal…' : 'Change plan in billing portal'}
        </button>
      )
    }

    return (
      <button
        type="button"
        onClick={() => void startCheckout(cardAmountCents, cardTier)}
        disabled={loading === 'checkout' || subscriptionLoading}
        className={`inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-medium transition-colors disabled:opacity-50 ${theme.primaryButton}`}
      >
        {loading === 'checkout' ? 'Starting checkout…' : `Subscribe ${formatDollarAmount(cardAmountCents)}/mo`}
        <ArrowRight className="h-4 w-4" />
      </button>
    )
  }

  if (!billingEnabled) {
    return (
      <StaticMarketingShell>
        <main className={minimalSection()}>
          <div className="mx-auto max-w-2xl text-center">
            <Reveal>
              <p className={minimalLabel()}>Plans and pricing</p>
              <h1 className={`mt-6 ${minimalDisplay()}`} style={minimalSerif()}>
                Billing unavailable.
              </h1>
              <p className={`mx-auto mt-6 max-w-xl ${minimalBody()}`}>
                This deployment does not use Overlay-managed billing. Workspace
                access is controlled by the deployment administrator.
              </p>
              <Link
                href="/app/chat"
                className={`mt-8 inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-medium transition-colors ${theme.primaryButton}`}
              >
                Open app
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Reveal>
          </div>
        </main>
        <MarketingFooter />
      </StaticMarketingShell>
    )
  }

  return (
    <StaticMarketingShell>
      <Suspense fallback={null}>
        <UserIdExtractor />
      </Suspense>

      <main className={minimalSection()}>
        <div className="mx-auto flex max-w-5xl flex-col gap-16">
          {/* Hero */}
          <Reveal>
            <div className="grid gap-10 lg:grid-cols-[0.72fr_1.28fr] lg:items-center">
              <div>
                <p className={minimalLabel()}>Plans and pricing</p>
                <h1 className={`mt-6 ${minimalDisplay()}`} style={minimalSerif()}>
                  Pay for the platform and the AI you use.
                </h1>
                <p className={`mt-6 max-w-2xl ${minimalBody()}`}>
                  Start free. Upgrade when you want premium models, agents,
                  browser tasks, and more monthly budget.
                </p>
                {!authLoading && !isAuthenticated ? (
                  <div className="mt-6 inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-4 py-2 text-sm text-[var(--foreground)]">
                    Sign in to subscribe.
                    <Link href="/auth/sign-in?redirect=/pricing" className="font-medium underline underline-offset-4">
                      Sign in
                    </Link>
                  </div>
                ) : null}
                {error ? (
                  <div className="mt-6 inline-flex rounded-lg border border-[color:color-mix(in_srgb,var(--danger)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--danger)_12%,transparent)] px-4 py-2 text-sm text-[var(--danger)]">
                    {error}
                  </div>
                ) : null}
              </div>
              <PricingControlPreview amount={formatDollarAmount(selectedPlanAmountCents)} />
            </div>
          </Reveal>

          {/* Tier toggle */}
          <div className="hidden gap-3 lg:grid lg:grid-cols-3">
            <div className="hidden lg:block" />
            {renderPaidTierToggle()}
            <div className="hidden lg:block" />
          </div>

          {/* Tier cards */}
          <Reveal>
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
              {/* Free */}
              <section className={theme.tierCard}>
                <div className="flex min-h-[56px] items-center gap-3">
                  <div className={theme.iconChip}>
                    <MessageSquare className="h-4 w-4" strokeWidth={1.75} aria-hidden />
                  </div>
                  <div>
                    <h2 className={`text-lg font-semibold ${theme.heading}`}>Free</h2>
                    <p className={`text-xs ${theme.muted}`}>Auto model and core workspace</p>
                  </div>
                </div>
                <div className="mt-6 min-h-[82px]">
                  <div className={theme.title} style={minimalSerif()}>$0</div>
                  <p className={`mt-1 text-sm ${theme.body}`}>No card required</p>
                </div>
                <ul className="mt-4 flex flex-col gap-2.5">
                  {[
                    'Unlimited Auto model messages',
                    'Notes, chats, knowledge, projects',
                    'Basic AI tools and core flows',
                    '10 MB file storage',
                  ].map((feature) => (
                    <li key={feature} className="flex items-start gap-2">
                      <Check className={`mt-0.5 h-4 w-4 shrink-0 text-[var(--success)]`} />
                      <span className="text-sm leading-snug text-[var(--foreground)]">{feature}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-auto pt-6">
                  {currentPlanKind === 'free' ? (
                    <div className={theme.currentPlanPill}>{subscriptionLoading ? 'Loading…' : 'Current plan'}</div>
                  ) : (
                    <Link
                      href={isAuthenticated ? '/app/chat' : '/auth/sign-in?redirect=%2Fapp%2Fchat'}
                      className={`inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-medium transition-colors ${theme.secondaryButton}`}
                    >
                      Start free
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  )}
                </div>
              </section>

              <div className="lg:hidden">{renderPaidTierToggle()}</div>

              {/* Paid */}
              <section className={tierCardClass(selectedPaidOption.tier)} onClick={() => selectTier(selectedPaidOption.tier)}>
                <div className="flex min-h-[56px] items-center justify-between gap-3">
                  <div>
                    <h2 className={`text-lg font-semibold ${theme.heading}`}>Paid</h2>
                    <p className={`text-xs ${theme.muted}`}>{selectedPaidOption.note}</p>
                  </div>
                </div>
                <div className="mt-6 min-h-[82px]">
                  <div className="flex flex-wrap items-end gap-1.5">
                    <span className={theme.title} style={minimalSerif()}>${selectedPaidOption.amountCents / 100}</span>
                    <span className={`pb-1 text-sm ${theme.muted}`}>/ month</span>
                  </div>
                  <p className={`mt-2 text-xs leading-relaxed ${theme.muted}`}>
                    {formatBytes(getStorageLimitBytes({ planKind: 'paid', planAmountCents: selectedPaidOption.amountCents }))} storage
                  </p>
                </div>
                <ul className="mt-4 flex flex-col gap-2">
                  <li className={`text-xs font-medium ${theme.muted}`}>Everything in Free, plus:</li>
                  {PAID_FEATURE_BULLETS_COMPACT.map((feature) => (
                    <li key={feature} className="flex items-start gap-2">
                      <Check className={`mt-0.5 h-4 w-4 shrink-0 text-[var(--success)]`} />
                      <span className="text-sm leading-snug text-[var(--foreground)]">{feature}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-auto pt-6">{paidCtaForAmount(selectedPaidOption.amountCents, selectedPaidOption.tier)}</div>
              </section>

              {/* Choose your own */}
              <section className={`${tierCardClass('custom')} relative overflow-hidden`} onClick={() => selectTier('custom')}>
                <div className={`pointer-events-none absolute inset-0 ${theme.heroGlow}`} />
                <div className="relative flex min-h-[56px] items-center gap-3">
                  <div className={theme.iconChip}>
                    <SlidersHorizontal className="h-4 w-4" strokeWidth={1.75} aria-hidden />
                  </div>
                  <div>
                    <h2 className={`text-lg font-semibold ${theme.heading}`}>Choose my own</h2>
                    <p className={`text-xs ${theme.muted}`}>Pick any monthly budget ($8–$200)</p>
                  </div>
                </div>
                <div className="relative mt-6 min-h-[82px]">
                  <div className="flex flex-wrap items-end gap-1.5">
                    <span className={theme.title} style={minimalSerif()}>{formatDollarAmount(selectedPlanAmountCents)}</span>
                    <span className={`pb-1 text-sm ${theme.muted}`}>/ month</span>
                  </div>
                  <p className={`mt-2 text-xs ${theme.muted}`}>
                    {formatBytes(selectedStorageBytes)} storage · {Math.round(selectedPlanAmountCents / 100)} × $1 units
                  </p>
                </div>

                <ul className="relative mt-4 flex flex-col gap-2">
                  <li className={`text-xs font-medium ${theme.muted}`}>Everything in Free, plus:</li>
                  {PAID_FEATURE_BULLETS.map((feature) => (
                    <li key={feature} className="flex items-start gap-2">
                      <Check className={`mt-0.5 h-4 w-4 shrink-0 text-[var(--success)]`} />
                      <span className="text-sm leading-snug text-[var(--foreground)]">{feature}</span>
                    </li>
                  ))}
                </ul>

                <div className={`relative mt-5 ${theme.subtleCard}`}>
                  <div className="flex items-center justify-between text-xs">
                    <span className={theme.muted}>Monthly budget</span>
                    <span className={`font-medium ${theme.heading}`}>{formatDollarAmount(selectedPlanAmountCents)}</span>
                  </div>
                  <input
                    type="range"
                    min={PAID_PLAN_MIN_AMOUNT_CENTS / 100}
                    max={PAID_PLAN_MAX_AMOUNT_CENTS / 100}
                    step={PAID_PLAN_STEP_AMOUNT_CENTS / 100}
                    value={selectedPlanDollars}
                    onChange={(event) => {
                      const next = Math.round(Number(event.target.value) * 100)
                      selectTier('custom', next)
                    }}
                    aria-label="Choose monthly budget"
                    onPointerDown={() => {
                      if (selectedTier !== 'custom') selectTier('custom', selectedPlanAmountCents)
                    }}
                    className={theme.sliderTrack}
                  />
                  <div className={`mt-1 flex justify-between text-[11px] ${theme.muted}`}>
                    <span>$8</span>
                    <span>$200</span>
                  </div>
                </div>

                <div className="relative mt-auto pt-6">{paidCtaForAmount(selectedPlanAmountCents, 'custom')}</div>
              </section>
            </div>
          </Reveal>

          {/* Top-ups + how billing works — consolidated */}
          <Reveal>
            <div className="grid gap-5 md:grid-cols-2">
              <section className={theme.panel + ' p-6'}>
                <h2 className={`text-sm font-medium ${theme.heading}`}>Top-ups</h2>
                <p className={`mt-2 text-sm leading-relaxed ${theme.body}`}>
                  One-time and automatic top-ups use <span className="font-medium">$8</span> per recharge unless you change this in{' '}
                  <Link href="/app/settings?section=account" className={`font-medium underline underline-offset-4 ${theme.heading}`}>
                    Account
                  </Link>
                  . Automatic top-ups are off until you opt in.
                </p>
                <label
                  className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4"
                >
                  <input
                    type="checkbox"
                    checked={autoTopUpEnabled}
                    onChange={(event) => setAutoTopUpEnabled(event.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-[var(--input-border)] text-[var(--accent)] focus:ring-[var(--accent)]"
                  />
                  <div>
                    <p className={`text-sm font-medium ${theme.heading}`}>Enable automatic top-ups</p>
                    <p className={`mt-1 text-xs leading-relaxed ${theme.muted}`}>
                      When enabled, we add $8 when your cumulative budget reaches zero.
                    </p>
                  </div>
                </label>
                {currentPlanKind === 'paid' ? (
                  <button
                    type="button"
                    onClick={() => void handleSaveTopUpPreference()}
                    disabled={loading === 'topup-settings' || subscriptionLoading}
                    className={`mt-4 inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-medium transition-colors disabled:opacity-50 ${theme.secondaryButton}`}
                  >
                    {loading === 'topup-settings' ? 'Saving…' : 'Save top-up preference'}
                  </button>
                ) : null}
              </section>

              <section className={theme.panel + ' p-6'}>
                <h2 className={`text-sm font-medium ${theme.heading}`}>How billing works</h2>
                <div className="mt-4 space-y-4">
                  {[
                    { label: 'Monthly budget', hint: 'Your subscription sets how much usage budget you get each cycle.' },
                    { label: 'Usage draws it down', hint: 'Premium features consume budget with a small markup.' },
                    { label: 'Top up if needed', hint: 'Add $8 (or more from Account) when you need extra headroom.' },
                  ].map(({ label, hint }) => (
                    <div key={label}>
                      <p className={`text-sm font-medium ${theme.heading}`}>{label}</p>
                      <p className={`mt-0.5 text-xs leading-relaxed ${theme.muted}`}>{hint}</p>
                    </div>
                  ))}
                </div>
                <p className={`mt-4 text-sm ${theme.body}`}>
                  Manage payment method and invoices in{' '}
                  <Link href="/app/settings?section=account" className={`font-medium underline underline-offset-4 ${theme.heading}`}>
                    Account
                  </Link>
                  .
                </p>
              </section>
            </div>
          </Reveal>
        </div>
      </main>
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
