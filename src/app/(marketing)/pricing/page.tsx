import type { Metadata } from 'next'
import PricingClient from '@/app/pricing/PricingClient'
import { PricingPage as WorkspacePricingPage } from '@/features/marketing/pricing/PricingPage'
import {
  parseWorkspaceBillingRolloutStage,
  workspaceBillingRolloutConfigFromEnv,
  workspaceBillingRolloutEnabled,
} from '@/shared/billing/workspace-billing-rollout'
import { getOverlayCapabilitiesSync } from '@/server/capabilities'

export const metadata: Metadata = {
  title: 'Pricing — Overlay',
  description:
    'Every workspace is free or paid. Paid starts at $8, becomes credit, and is billed as you go, one line per resource.',
  alternates: {
    canonical: '/pricing',
  },
  robots: {
    index: true,
    follow: true,
  },
}

/**
 * The workspace pricing page, once workspace billing is on for everyone (deployments that never turn it on keep the
 * account-plan page). `/pricing/preview` also shows the on-demand and itemized-bill sections that are not built yet.
 */
export default function PricingPage() {
  const capabilities = getOverlayCapabilitiesSync()
  const rollout = workspaceBillingRolloutConfigFromEnv(process.env)
  const workspaceBilling =
    workspaceBillingRolloutEnabled(rollout) && parseWorkspaceBillingRolloutStage(rollout.stage) === 'general'
  if (!workspaceBilling) return <PricingClient billingEnabled={capabilities.billing} />
  return <WorkspacePricingPage billingEnabled={capabilities.billing} />
}
