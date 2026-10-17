'use client'

import { unstyledButton } from '@overlay/ui/control-reset'
import { Button } from '@overlay/ui/primitives'

import { ArrowUp } from 'lucide-react'

export function BudgetTopUpComposerPrompt({
  amountCents,
  remainingCents,
  checkoutLoading,
  onStartTopUp,
  accountHref = '/account',
}: {
  amountCents: number
  remainingCents: number
  checkoutLoading: boolean
  onStartTopUp: () => void
  accountHref?: string
}) {
  return (
    <div className="mb-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-sm text-(--foreground)">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ArrowUp size={14} className="shrink-0 text-amber-500" strokeWidth={1.9} />
            <p className="font-medium">Paid budget is empty</p>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-(--muted)">
            ${Math.max(0, remainingCents / 100).toFixed(2)} remaining. Free models still work; top up to use paid models and paid tools.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="ghost"
            type="button"
            onClick={onStartTopUp}
            disabled={checkoutLoading}
            className={unstyledButton(`inline-flex h-8 items-center justify-center rounded-lg bg-(--foreground) px-3 text-xs font-medium text-(--background) transition-opacity hover:opacity-90 disabled:opacity-60`)}
          >
            {checkoutLoading ? 'Opening...' : `Add $${(amountCents / 100).toFixed(0)}`}
          </Button>
          <a
            href={accountHref}
            className="inline-flex h-8 items-center justify-center rounded-lg border border-(--border) bg-(--surface-subtle) px-3 text-xs font-medium text-(--foreground) transition-colors hover:bg-(--surface-muted)"
          >
            Account
          </a>
        </div>
      </div>
    </div>
  )
}
