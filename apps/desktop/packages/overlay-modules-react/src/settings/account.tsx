'use client'

import type { ReactNode } from 'react'
import { AlertCircle, ArrowRight, Check, RefreshCw } from 'lucide-react'
import type { AccountEntitlements, TopUpHistoryItem } from '@overlay/app-core'
import {
  accountPlanLabel,
  accountStatusDescription,
  formatAccountDateTime,
  formatCents,
  remainingUsagePercentage,
  usageProgressTone,
} from '@overlay/app-core/settings-account'

export interface AccountMessage {
  type: 'success' | 'error'
  text: string
}

export interface AccountPageFrameProps {
  header: ReactNode
  children: ReactNode
  footerBorderClass: string
  footerMutedClass: string
  footer?: ReactNode
  dark?: boolean
  termsHref?: string
  privacyHref?: string
}

export function AccountPageFrame({
  header,
  children,
  footerBorderClass,
  footerMutedClass,
  footer,
  dark,
  termsHref = '/terms',
  privacyHref = '/privacy',
}: AccountPageFrameProps) {
  return (
    <div className="flex min-h-screen w-full flex-col gradient-bg">
      <div className="liquid-glass" />
      {header}
      <main className="relative z-10 flex-1 px-4 pb-10 pt-28 md:px-8 md:pb-14 md:pt-32">
        <div className="max-w-4xl mx-auto">{children}</div>
      </main>
      {footer ?? <footer className={`relative z-10 mt-auto border-t py-8 px-8 ${footerBorderClass}`}>
        <div className={`mx-auto flex max-w-4xl items-center justify-between text-sm ${footerMutedClass}`}>
          <p>© 2026 overlay</p>
          <div className="flex gap-6">
            <a href={termsHref} className={dark ? 'transition-colors hover:text-zinc-100' : 'transition-colors hover:text-zinc-900'}>
              terms
            </a>
            <a href={privacyHref} className={dark ? 'transition-colors hover:text-zinc-100' : 'transition-colors hover:text-zinc-900'}>
              privacy
            </a>
          </div>
        </div>
      </footer>}
    </div>
  )
}

export interface AccountMessageBannerProps {
  message: AccountMessage
  onOpenDesktop: () => void
  onOpenWeb: () => void
  onDismiss: () => void
}

export function AccountMessageBanner({ message, onOpenDesktop, onOpenWeb, onDismiss }: AccountMessageBannerProps) {
  return (
    <div
      className={`mb-6 p-4 rounded-xl flex items-center gap-3 ${
        message.type === 'success'
          ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
          : 'bg-red-50 text-red-800 border border-red-200'
      }`}
    >
      {message.type === 'success' ? <Check className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
      <p className="text-sm">{message.text}</p>
      <div className="ml-auto flex flex-wrap items-center gap-3">
        {message.type === 'success' ? (
          <>
            <button
              type="button"
              onClick={onOpenDesktop}
              className="rounded-lg bg-emerald-600 px-3 py-1 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
            >
              Open in desktop app
            </button>
            <button
              type="button"
              onClick={onOpenWeb}
              className="rounded-lg border border-emerald-300 px-3 py-1 text-sm font-medium text-emerald-800 transition-colors hover:bg-emerald-100/70"
            >
              Open web app
            </button>
          </>
        ) : null}
        <button type="button" onClick={onDismiss} className="text-sm opacity-60 hover:opacity-100">
          Dismiss
        </button>
      </div>
    </div>
  )
}

export function AccountLoadingState({ mutedClass, dark }: { mutedClass: string; dark?: boolean }) {
  return (
    <div className="text-center py-16">
      <RefreshCw className={`mx-auto h-8 w-8 animate-spin ${dark ? 'text-zinc-500' : 'text-zinc-400'}`} />
      <p className={`mt-4 ${mutedClass}`}>Loading your account...</p>
    </div>
  )
}

export interface AccountSignInPromptProps {
  panelClass: string
  headingClass: string
  mutedClass: string
  action: ReactNode
}

export function AccountSignInPrompt({ panelClass, headingClass, mutedClass, action }: AccountSignInPromptProps) {
  return (
    <div className="text-center py-16">
      <div className={panelClass}>
        <h2 className={`text-xl font-serif mb-2 ${headingClass}`}>Sign in to view your account</h2>
        <p className={`mb-6 ${mutedClass}`}>
          Access your subscription details, usage statistics, and billing information.
        </p>
        {action}
      </div>
    </div>
  )
}

export interface AccountProfileCardProps {
  panelClass: string
  headingClass: string
  mutedClass: string
  dark?: boolean
  name?: string | null
  email?: string | null
  actions: ReactNode
}

export function AccountProfileCard({
  panelClass,
  headingClass,
  mutedClass,
  dark,
  name,
  email,
  actions,
}: AccountProfileCardProps) {
  const initial = name?.[0] || email?.[0]?.toUpperCase() || '?'
  return (
    <div className={panelClass}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <div
            className={`flex h-12 w-12 items-center justify-center rounded-full text-lg font-medium ${
              dark ? 'bg-zinc-700 text-zinc-100' : 'bg-zinc-200 text-zinc-900'
            }`}
          >
            {initial}
          </div>
          <div>
            <h2 className={`text-lg font-medium ${headingClass}`}>{name || email}</h2>
            <p className={`text-sm ${mutedClass}`}>{email}</p>
          </div>
        </div>
        {actions}
      </div>
    </div>
  )
}

export function AccountContinueCard({
  panelClass,
  mutedClass,
  bodyClass,
  actions,
}: {
  panelClass: string
  mutedClass: string
  bodyClass: string
  actions: ReactNode
}) {
  return (
    <div className={panelClass}>
      <p className={`mb-1 text-sm ${mutedClass}`}>Continue with Overlay</p>
      <p className={`mb-4 text-sm ${bodyClass}`}>
        Open the desktop app for the native overlay workflow, or continue in the web app from here.
      </p>
      <div className="flex flex-col gap-3 sm:flex-row">{actions}</div>
    </div>
  )
}

export interface AccountSubscriptionCardProps {
  panelClass: string
  headingClass: string
  mutedClass: string
  dark?: boolean
  entitlements: AccountEntitlements
  actions: ReactNode
}

export function AccountSubscriptionCard({
  panelClass,
  headingClass,
  mutedClass,
  dark,
  entitlements,
  actions,
}: AccountSubscriptionCardProps) {
  return (
    <div className={panelClass}>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h2 className={`text-lg font-medium mb-1 ${headingClass}`}>{accountPlanLabel(entitlements)}</h2>
          <p className={`text-sm ${mutedClass}`}>{accountStatusDescription(entitlements)}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={accountStatusBadgeClass(entitlements.status, Boolean(dark))}>{entitlements.status}</span>
        </div>
      </div>
      <div className="flex items-center gap-3 flex-wrap">{actions}</div>
    </div>
  )
}

function accountStatusBadgeClass(status: AccountEntitlements['status'], dark: boolean) {
  if (status === 'active') {
    return dark
      ? 'rounded-full px-3 py-1 text-xs font-medium bg-emerald-900/50 text-emerald-200 ring-1 ring-emerald-700/60'
      : 'rounded-full px-3 py-1 text-xs font-medium bg-emerald-100 text-emerald-800'
  }
  if (status === 'past_due') {
    return dark
      ? 'rounded-full px-3 py-1 text-xs font-medium bg-amber-900/40 text-amber-200 ring-1 ring-amber-700/50'
      : 'rounded-full px-3 py-1 text-xs font-medium bg-amber-100 text-amber-800'
  }
  return dark
    ? 'rounded-full px-3 py-1 text-xs font-medium bg-zinc-800 text-zinc-200'
    : 'rounded-full px-3 py-1 text-xs font-medium bg-zinc-100 text-zinc-800'
}

export interface AccountPaidUsageCardProps {
  panelClass: string
  headingClass: string
  mutedClass: string
  dark?: boolean
  entitlements: AccountEntitlements
  storageUsageLabel: string
}

export function AccountPaidUsageCard({
  panelClass,
  headingClass,
  mutedClass,
  dark,
  entitlements,
  storageUsageLabel,
}: AccountPaidUsageCardProps) {
  return (
    <div className={panelClass}>
      <h2 className={`text-lg font-medium mb-4 ${headingClass}`}>Usage This Period</h2>
      <UsageProgressBar
        used={entitlements.budgetUsedCents / 100}
        total={entitlements.budgetTotalCents / 100}
        label="Monthly budget"
        showAsPercentage={true}
        isLandingDark={dark}
      />
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <AccountMetricCard dark={dark} mutedClass={mutedClass} headingClass={headingClass} label="Used" value={formatCents(entitlements.budgetUsedCents)} />
        <AccountMetricCard dark={dark} mutedClass={mutedClass} headingClass={headingClass} label="Remaining" value={formatCents(entitlements.budgetRemainingCents)} />
        <AccountMetricCard dark={dark} mutedClass={mutedClass} headingClass={headingClass} label="Storage" value={storageUsageLabel} />
      </div>
    </div>
  )
}

function AccountMetricCard({
  dark,
  mutedClass,
  headingClass,
  label,
  value,
}: {
  dark?: boolean
  mutedClass: string
  headingClass: string
  label: string
  value: string
}) {
  return (
    <div className={`rounded-xl border px-4 py-3 ${dark ? 'border-zinc-700 bg-zinc-950/60' : 'border-zinc-200 bg-zinc-50'}`}>
      <p className={`text-xs uppercase tracking-[0.18em] ${mutedClass}`}>{label}</p>
      <p className={`mt-2 text-lg font-medium ${headingClass}`}>{value}</p>
    </div>
  )
}

export function TopUpHistoryList({
  items,
  headingClass,
  mutedClass,
  dark,
}: {
  items: readonly TopUpHistoryItem[]
  headingClass: string
  mutedClass: string
  dark?: boolean
}) {
  return (
    <div className="mt-6">
      <h3 className={`text-sm font-medium ${headingClass}`}>Recent top-ups</h3>
      <div className="mt-3 space-y-3">
        {items.length === 0 ? (
          <p className={`text-sm ${mutedClass}`}>No top-ups yet.</p>
        ) : (
          items.slice(0, 6).map((item) => (
            <div
              key={item._id}
              className={`flex flex-col gap-2 rounded-xl border px-4 py-3 text-sm md:flex-row md:items-center md:justify-between ${
                dark ? 'border-zinc-700 bg-zinc-950/60' : 'border-zinc-200 bg-zinc-50'
              }`}
            >
              <div>
                <p className={headingClass}>
                  {formatCents(item.amountCents)} · {item.source === 'auto' ? 'Auto top-up' : 'Manual top-up'}
                </p>
                <p className={mutedClass}>{formatAccountDateTime(item.createdAt)}</p>
              </div>
              <div className="text-right">
                <p className={`${item.status === 'succeeded' ? 'text-emerald-600' : item.status === 'failed' ? 'text-red-500' : mutedClass}`}>
                  {item.status}
                </p>
                {item.errorMessage ? <p className={`max-w-xs text-xs ${mutedClass}`}>{item.errorMessage}</p> : null}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export function AccountFreeUsageCard({
  panelClass,
  headingClass,
  mutedClass,
  dark,
  entitlements,
}: {
  panelClass: string
  headingClass: string
  mutedClass: string
  dark?: boolean
  entitlements: AccountEntitlements
}) {
  return (
    <div className={panelClass}>
      <h2 className={`text-lg font-medium mb-4 ${headingClass}`}>Weekly Usage</h2>
      <div className="space-y-4">
        <div className={`rounded-xl border px-4 py-3 ${dark ? 'border-zinc-700 bg-zinc-950/60' : 'border-zinc-200 bg-zinc-50'}`}>
          <p className={`text-sm font-medium ${headingClass}`}>Auto model requests</p>
          <p className={`mt-1 text-sm ${mutedClass}`}>Unlimited on the free tier when you use Auto.</p>
        </div>
        <UsageProgressBar
          used={entitlements.usage.transcriptionSeconds}
          total={entitlements.limits.transcriptionSecondsPerWeek}
          label="Transcription"
          showAsPercentage={true}
          isLandingDark={dark}
        />
      </div>
      <p className={`mt-4 text-xs ${mutedClass}`}>
        Auto is unlimited on free. Upgrade to a paid plan to use premium models, Daytona, browser tasks, and generation tools.
      </p>
    </div>
  )
}

export function UsageProgressBar({
  used,
  total,
  label,
  showAsPercentage = false,
  isLandingDark = false,
}: {
  used: number
  total: number
  label: string
  showAsPercentage?: boolean
  isLandingDark?: boolean
}) {
  const remaining = Math.max(0, total - used)
  const percentage = remainingUsagePercentage(used, total)
  const tone = usageProgressTone(percentage)
  const labelCls = isLandingDark ? 'text-zinc-400' : 'text-zinc-500'
  const valueCls = tone === 'empty'
    ? 'text-red-400'
    : tone === 'low'
      ? 'text-amber-400'
      : isLandingDark
        ? 'text-zinc-100'
        : 'text-zinc-900'
  const track = isLandingDark ? 'bg-zinc-700' : 'bg-zinc-200'
  const fill = tone === 'empty' ? 'bg-red-500' : tone === 'low' ? 'bg-amber-500' : isLandingDark ? 'bg-zinc-100' : 'bg-zinc-900'

  return (
    <div className="space-y-2">
      <div className="flex justify-between text-sm">
        <span className={labelCls}>{label}</span>
        <span className={valueCls}>
          {showAsPercentage ? `${Math.round(percentage)}% remaining` : `$${remaining.toFixed(2)} / $${total}`}
        </span>
      </div>
      <div className={`h-1.5 overflow-hidden rounded-full ${track}`}>
        <div className={`h-full rounded-full transition-all duration-300 ${fill}`} style={{ width: `${percentage}%` }} />
      </div>
    </div>
  )
}

export function EntitlementsErrorPanel({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) {
  return (
    <div className="p-4 rounded-xl flex items-start gap-3 bg-amber-50 text-amber-900 border border-amber-200">
      <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
      <div className="text-sm space-y-2">
        <p className="font-medium">Plan information unavailable</p>
        <p className="text-amber-800/90">{message}</p>
        <button type="button" onClick={onRetry} className="text-sm font-medium text-amber-950 underline hover:no-underline">
          Retry
        </button>
      </div>
    </div>
  )
}

export function AccountPrimaryLink({
  href,
  dark,
  children,
}: {
  href: string
  dark?: boolean
  children: ReactNode
}) {
  return (
    <a
      href={href}
      className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-opacity hover:opacity-90 ${
        dark ? 'bg-zinc-100 text-zinc-900' : 'bg-zinc-900 text-white'
      }`}
    >
      {children}
      <ArrowRight className="w-4 h-4" />
    </a>
  )
}
