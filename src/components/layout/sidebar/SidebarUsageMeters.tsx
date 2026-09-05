'use client'

import Link from 'next/link'
import { AlertCircle, CreditCard } from 'lucide-react'
import { UsageMeterBar } from '@overlay/ui/primitives'
import { formatBytes } from '@/shared/storage/storage-limits'

export interface SidebarEntitlements {
  tier: 'free' | 'pro' | 'max'
  planKind?: 'free' | 'paid'
  planId?: 'free' | 'starter' | 'pro' | 'max' | null
  planDisplayName?: string
  isLegacyPlan?: boolean
  status?: 'active' | 'trialing' | 'past_due' | 'canceled'
  cancelAtPeriodEnd?: boolean
  creditsUsed: number
  creditsTotal: number
  budgetUsedCents?: number
  budgetTotalCents?: number
  budgetRemainingCents?: number
  allowanceTotalCents?: number
  allowanceUsedCents?: number
  allowancePercentUsed?: number
  topUpBalanceCents?: number
  dailyUsage: { ask: number; write: number; agent: number }
  overlayStorageBytesUsed: number
  overlayStorageBytesLimit: number
}

export function SidebarPlanStatus({
  entitlements,
  expanded,
  onClick,
}: {
  entitlements: SidebarEntitlements | null
  expanded: boolean
  onClick?: () => void
}) {
  const planName = entitlements?.planDisplayName
    ?? (entitlements?.planKind === 'paid' ? 'Paid' : 'Free')
  const needsAttention = entitlements?.status === 'past_due'
  const isCanceling = Boolean(entitlements?.cancelAtPeriodEnd)
  const detail = needsAttention
    ? 'Payment needs attention'
    : isCanceling
      ? 'Cancellation scheduled'
    : entitlements?.isLegacyPlan
      ? 'Grandfathered pricing'
      : entitlements?.planKind === 'paid'
        ? 'Manage plan'
        : 'View plans'

  return (
    <Link
      href="/app/settings?section=account"
      onClick={onClick}
      className={`group flex min-h-10 w-full items-center rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] text-[var(--muted)] transition-[background-color,color,transform] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)] active:scale-[0.98] ${expanded ? 'gap-2.5 px-3 py-2' : 'justify-center'}`}
      aria-label={`${planName} plan`}
      title={`${planName} plan · ${detail}`}
    >
      <span className="relative shrink-0">
        <CreditCard size={15} />
        {needsAttention ? <span className="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-amber-500" /> : null}
      </span>
      {expanded ? (
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium text-[var(--foreground)]">{planName} plan</span>
          <span className={`block truncate text-[10px] ${needsAttention ? 'text-amber-500' : 'text-[var(--muted-light)]'}`}>{detail}</span>
        </span>
      ) : null}
    </Link>
  )
}

export function UsageBar({ entitlements }: { entitlements: SidebarEntitlements | null }) {
  if (!entitlements) {
    return <p className="text-[11px] text-[var(--muted-light)]">Loading...</p>
  }

  const { tier } = entitlements
  const planKind = entitlements.planKind ?? (tier === 'free' ? 'free' : 'paid')
  const allowanceUsedCents = entitlements.allowanceUsedCents ?? entitlements.budgetUsedCents ?? entitlements.creditsUsed ?? 0
  const allowanceTotalCents =
    entitlements.allowanceTotalCents ?? entitlements.budgetTotalCents ??
    (typeof entitlements.creditsTotal === 'number' ? Math.max(0, entitlements.creditsTotal * 100) : 0)

  if (planKind === 'free') {
    return <p className="text-[11px] text-[var(--muted-light)]">Auto model messages are unlimited. Premium models and budgeted tools are unavailable on this plan.</p>
  }

  if (allowanceTotalCents <= 0) return <p className="text-[11px] text-[#aaa]">No allowance limit set</p>
  const usedPctRaw = entitlements.allowancePercentUsed ?? Math.min(100, (allowanceUsedCents / allowanceTotalCents) * 100)
  const remainingPctRaw = Math.max(0, 100 - usedPctRaw)
  const exhausted = remainingPctRaw <= 0
  const warning = usedPctRaw >= 80
  const tone = exhausted ? 'exhausted' : warning ? 'warning' : 'default'

  return (
    <UsageMeterBar
      percent={usedPctRaw}
      tone={tone}
      primaryLabel={
        <>{usedPctRaw.toFixed(1)}% allowance used</>
      }
      trailingIcon={exhausted ? <AlertCircle size={11} /> : undefined}
    />
  )
}

export function StorageBar({ entitlements }: { entitlements: SidebarEntitlements | null }) {
  if (!entitlements) {
    return <p className="text-[11px] text-[var(--muted-light)]">Loading...</p>
  }

  const usedBytes = Math.max(0, entitlements.overlayStorageBytesUsed)
  const limitBytes = Math.max(0, entitlements.overlayStorageBytesLimit)
  const remainingBytes = Math.max(0, limitBytes - usedBytes)
  const usedPct = limitBytes > 0 ? Math.min(100, (usedBytes / limitBytes) * 100) : 0
  const warning = usedPct >= 80
  const exhausted = limitBytes > 0 && remainingBytes <= 0
  const tone = exhausted ? 'exhausted' : warning ? 'warning' : 'default'

  return (
    <UsageMeterBar
      percent={usedPct}
      tone={tone}
      primaryLabel={`${formatBytes(remainingBytes)} available`}
      secondaryLabel={`${formatBytes(usedBytes)} / ${formatBytes(limitBytes)}`}
    />
  )
}
