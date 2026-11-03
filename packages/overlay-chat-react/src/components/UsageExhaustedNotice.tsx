'use client'

import { Button } from '@overlay/ui/primitives'

export const WORKSPACE_BILLING_HREF = '/app/settings?section=workspace&workspace_tab=billing'

export function UsageExhaustedNotice({ href }: { href?: string }) {
  return (
    <div className="flex w-full items-center justify-between gap-4 rounded-xl border bg-(--surface-elevated) px-4 py-3.5">
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-(--foreground)">Workspace billing is required to continue</p>
        <p className="mt-1 text-xs text-(--muted)">Subscribe or add usage credit in Billing to continue.</p>
      </div>
      <Button asChild size="sm" variant="secondary">
        <a href={href ?? WORKSPACE_BILLING_HREF}>Open billing</a>
      </Button>
    </div>
  )
}
