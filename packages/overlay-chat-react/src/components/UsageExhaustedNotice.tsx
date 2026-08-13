'use client'

import { WalletCards } from 'lucide-react'

export const ACCOUNT_TOP_UP_HREF = '/app/settings?section=account'

export function UsageExhaustedNotice({
  accountHref = ACCOUNT_TOP_UP_HREF,
}: {
  accountHref?: string
}) {
  return (
    <div className="w-full max-w-[min(100%,28rem)] rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-4 py-3">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--surface-subtle)] text-[var(--muted)]">
          <WalletCards size={14} strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-[var(--foreground)]">You have used your allowance</p>
          <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
            Chat is paused until you add credits. Top up from Account to keep going.
          </p>
          <a
            href={accountHref}
            className="mt-3 inline-flex h-8 items-center justify-center rounded-lg bg-[var(--foreground)] px-3 text-xs font-medium text-[var(--background)] transition-transform duration-160 ease-out hover:opacity-90 active:scale-[0.97]"
          >
            Add credits
          </a>
        </div>
      </div>
    </div>
  )
}
