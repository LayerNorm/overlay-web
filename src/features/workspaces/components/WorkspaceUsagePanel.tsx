'use client'

import { unstyledButton } from '@overlay/ui/control-reset'
import { Button } from '@overlay/ui/primitives'

import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { WorkspaceBillingUsage } from '@overlay/workspace-contracts'

const DAY_MS = 24 * 60 * 60 * 1000

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`

/**
 * Itemized usage for the current billing period, one line per resource (the Vercel-style usage view). Models expand
 * into one line per model.
 */
export function WorkspaceUsagePanel({ usage }: { usage: WorkspaceBillingUsage }) {
  const [open, setOpen] = useState<string | null>(null)
  const [now] = useState(() => Date.now())
  const daysLeft = usage.periodEnd ? Math.max(0, Math.ceil((usage.periodEnd - now) / DAY_MS)) : null

  return (
    <div className="rounded-xl border border-(--border)">
      <div className="flex items-baseline justify-between gap-3 px-4 pt-4">
        <p className="text-sm font-medium text-(--foreground)">Usage this period</p>
        {daysLeft !== null ? (
          <span className="text-xs text-(--muted)">{daysLeft === 1 ? '1 day' : `${daysLeft} days`} remaining in cycle</span>
        ) : null}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-3 px-4 pb-4 text-xs">
        <div>
          <dt className="text-(--muted-light)">Total usage</dt>
          <dd className="mt-1 text-sm tabular-nums text-(--foreground)">{usd(usage.totalCents)}</dd>
        </div>
        <div className="text-right">
          <dt className="text-(--muted-light)">On-demand charges</dt>
          <dd className="mt-1 text-sm tabular-nums text-(--foreground)">{usd(usage.onDemandCents)}</dd>
        </div>
      </dl>

      {usage.lines.length === 0 ? (
        <p className="border-t border-(--border) px-4 py-4 text-xs text-(--muted)">No paid usage yet this period.</p>
      ) : (
        <ul className="border-t border-(--border) py-1">
          {usage.lines.map((line, index) => {
            const expandable = Boolean(line.details?.length)
            const expanded = open === line.key
            return (
              <li key={line.key}>
                <Button variant="ghost"
                  type="button"
                  disabled={!expandable}
                  aria-expanded={expandable ? expanded : undefined}
                  onClick={() => setOpen(expanded ? null : line.key)}
                  className={unstyledButton(`flex w-full items-center gap-2 px-4 py-2 text-left text-sm ${index % 2 === 0 ? 'bg-(--surface-subtle)' : ''} ${expandable ? 'cursor-pointer' : 'cursor-default'}`)}
                >
                  <span className="flex w-3 shrink-0 justify-center text-(--muted-light)">
                    {expandable ? <ChevronRight size={12} className={`transition-transform ${expanded ? 'rotate-90' : ''}`} /> : null}
                  </span>
                  <span className="text-(--foreground)">{line.label}</span>
                  <span className="text-xs text-(--muted)">{line.quantity}</span>
                  <span className="ml-auto tabular-nums text-(--foreground)">{usd(line.cents)}</span>
                </Button>
                {expanded ? (
                  <ul className="pb-1">
                    {line.details?.map((detail) => (
                      <li key={detail.label} className="flex items-center gap-2 py-1.5 pl-9 pr-4 text-xs">
                        <span className="text-(--foreground)">{detail.label}</span>
                        <span className="text-(--muted)">{detail.quantity}</span>
                        <span className="ml-auto tabular-nums text-(--muted)">{usd(detail.cents)}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
      {usage.truncated ? (
        <p className="border-t border-(--border) px-4 py-2 text-[11px] text-(--muted-light)">Showing the first 20,000 charges this period.</p>
      ) : null}
    </div>
  )
}
