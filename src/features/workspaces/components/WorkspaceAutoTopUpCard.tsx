'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button, Select } from '@overlay/ui/primitives'
import type { WorkspaceBillingSummaryResponse } from '@overlay/workspace-contracts'

type AutoTopUp = NonNullable<WorkspaceBillingSummaryResponse['autoTopUp']>

const TOP_UP_AMOUNTS = [800, 2_000, 5_000, 10_000, 20_000, 50_000] as const
const LIMITS = [800, 2_000, 4_000, 5_000, 10_000, 20_000, 50_000, 100_000] as const

const dollars = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}`

/**
 * What happens when the workspace's credit runs out: paid resources stop (hard stop, the default), or an automatic
 * top-up is charged to the workspace's card, up to a monthly limit. Owners and admins change it; members see it.
 */
export function WorkspaceAutoTopUpCard({
  autoTopUp,
  canManage,
  periodEnd,
  busy,
  onSave,
}: {
  autoTopUp: AutoTopUp
  canManage: boolean
  periodEnd?: number
  busy: boolean
  onSave: (input: { enabled: boolean; amountCents: number; monthlyLimitCents: number }) => void
}) {
  const [enabled, setEnabled] = useState(autoTopUp.enabled)
  const [amountCents, setAmountCents] = useState(autoTopUp.amountCents >= 800 ? autoTopUp.amountCents : 800)
  const [limitCents, setLimitCents] = useState(autoTopUp.monthlyLimitCents ?? 4_000)
  const limits = LIMITS.filter((limit) => limit >= amountCents)
  const effectiveLimit = limitCents >= amountCents ? limitCents : (limits[0] ?? amountCents)
  const dirty = enabled !== autoTopUp.enabled
    || (enabled && (amountCents !== autoTopUp.amountCents || effectiveLimit !== autoTopUp.monthlyLimitCents))
  const renews = periodEnd ? new Date(periodEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : null

  return (
    <div className="rounded-xl border border-[var(--border)] p-4">
      <p className="text-sm font-medium text-[var(--foreground)]">When credit runs out</p>
      <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
        {autoTopUp.enabled
          ? `Adding ${dollars(autoTopUp.amountCents)} automatically, up to ${dollars(autoTopUp.monthlyLimitCents ?? 0)} a month. ${dollars(autoTopUp.spentThisPeriodCents)} added this month.`
          : 'Paid resources stop at $0 until next month or until someone adds credit. Nothing is charged automatically.'}
      </p>
      {autoTopUp.limitReached ? (
        <p role="status" className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-2 text-xs leading-5 text-[var(--foreground)]">
          This month’s top-up limit is reached. Paid resources stop at $0{renews ? ` until ${renews}` : ''}, unless someone adds credit or raises the limit.
        </p>
      ) : null}

      {canManage ? (
        <div className="mt-4 space-y-2" role="radiogroup" aria-label="When credit runs out">
          <Option checked={!enabled} onSelect={() => setEnabled(false)} title="Hard stop" text="Paid resources stop at $0. Free ones keep working." />
          <Option checked={enabled} onSelect={() => setEnabled(true)} title="Keep going" text="Charge the workspace’s card for more credit, up to a monthly limit." />
          {enabled ? (
            <div className="flex flex-wrap items-center gap-2 pl-7 text-xs text-[var(--muted)]">
              Add
              <Select aria-label="Automatic top-up amount" value={String(amountCents)} onChange={(event) => setAmountCents(Number(event.target.value))}>
                {TOP_UP_AMOUNTS.map((amount) => <option key={amount} value={amount}>{dollars(amount)}</option>)}
              </Select>
              each time, up to
              <Select aria-label="Monthly top-up limit" value={String(effectiveLimit)} onChange={(event) => setLimitCents(Number(event.target.value))}>
                {limits.map((limit) => <option key={limit} value={limit}>{dollars(limit)}</option>)}
              </Select>
              a month
            </div>
          ) : null}
          <div className="flex items-center justify-between gap-3 pt-2">
            <p className="text-[11px] leading-4 text-[var(--muted-light)]">
              {enabled ? 'Saving lets Overlay charge the card on file for each top-up, never past your monthly limit.' : ''}
            </p>
            <Button
              size="sm"
              disabled={!dirty || busy}
              onClick={() => onSave({ enabled, amountCents, monthlyLimitCents: effectiveLimit })}
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : null}Save
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function Option({ checked, onSelect, title, text }: { checked: boolean; onSelect: () => void; title: string; text: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onSelect}
      className={`flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${checked ? 'border-[var(--foreground)]' : 'border-[var(--border)] hover:border-[var(--muted-light)]'}`}
    >
      <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${checked ? 'border-[var(--foreground)]' : 'border-[var(--border)]'}`}>
        {checked ? <span className="h-2 w-2 rounded-full bg-[var(--foreground)]" /> : null}
      </span>
      <span>
        <span className="block text-sm text-[var(--foreground)]">{title}</span>
        <span className="block text-xs leading-5 text-[var(--muted)]">{text}</span>
      </span>
    </button>
  )
}
