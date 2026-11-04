import { toast } from '@overlay/ui/primitives'

export const WORKSPACE_BILLING_PATH = '/app/settings?section=workspace&workspace_tab=billing'

type BillingToastRouter = {
  push: (href: string) => void
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
