import { isUsageExhaustedError } from '@overlay/chat-core'
import { toast } from '@overlay/ui/primitives'

export const WORKSPACE_BILLING_PATH = '/app/settings?section=workspace&workspace_tab=billing'
export const WORKSPACE_UPGRADE_BILLING_PATH = `${WORKSPACE_BILLING_PATH}&upgrade=1`

type BillingToastRouter = {
  push: (href: string) => void
}

export function usageExhaustionVariantForError(message: string): 'paid' | 'free' | null {
  const normalized = message.toLowerCase()
  if (
    normalized.includes('weekly_limit')
    || normalized.includes('weekly limit')
    || normalized.includes("this week's free chats")
  ) return 'free'
  if (isUsageExhaustedError(message) || normalized.includes('payment required')) return 'paid'
  return null
}

export function showUsageExhaustedToast(router: BillingToastRouter, variant: 'paid' | 'free'): void {
  const weekly = variant === 'free'
  toast(weekly ? 'Free chats used up this week' : 'Workspace credits used up', {
    id: 'usage-exhausted',
    action: {
      label: weekly ? 'Upgrade' : 'Billing',
      onClick: () => router.push(weekly ? WORKSPACE_UPGRADE_BILLING_PATH : WORKSPACE_BILLING_PATH),
    },
  })
}
