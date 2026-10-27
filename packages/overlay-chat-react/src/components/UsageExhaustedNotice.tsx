'use client'

import { Button } from '@overlay/ui/primitives'

export const WORKSPACE_BILLING_HREF = '/app/settings?section=workspace&workspace_tab=billing'

export function UsageExhaustedNotice({
  href,
  variant = 'paid',
}: {
  href?: string
  variant?: 'paid' | 'free'
}) {
  const copy = variant === 'free'
    ? {
        title: "You've used this week's free chats",
        description: 'Upgrade for shared credits and every model.',
        action: 'Upgrade',
        href: `${WORKSPACE_BILLING_HREF}&upgrade=1`,
      }
    : {
        title: "You're out of credits",
        description: 'Top up in Billing to keep chatting.',
        action: 'Open billing',
        href: WORKSPACE_BILLING_HREF,
      }

  return (
    <div className="flex w-full items-center justify-between gap-4 rounded-xl border bg-(--surface-elevated) px-4 py-3.5">
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-(--foreground)">{copy.title}</p>
        <p className="mt-1 text-xs text-(--muted)">{copy.description}</p>
      </div>
      <Button asChild size="sm" variant="secondary">
        <a href={href ?? copy.href}>{copy.action}</a>
      </Button>
    </div>
  )
}
