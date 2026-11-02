import { isUsageExhaustedError } from '@overlay/chat-core'
import { toast } from '@overlay/ui/primitives'

export const WORKSPACE_BILLING_PATH = '/app/settings?section=workspace&workspace_tab=billing'

type BillingToastRouter = {
  push: (href: string) => void
}

export function isWorkspaceBillingError(message: string): boolean {
  const normalized = message.toLowerCase()
  return isUsageExhaustedError(message) || normalized.includes('payment required')
    || normalized.includes('subscribe to this workspace')
}

export function showUsageExhaustedToast(router: BillingToastRouter): void {
  toast('Workspace billing is required to continue', {
    id: 'usage-exhausted',
    action: {
      label: 'Billing',
      onClick: () => router.push(WORKSPACE_BILLING_PATH),
    },
  })
}
