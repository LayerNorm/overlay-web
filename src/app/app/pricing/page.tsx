import PricingClient from '@/app/pricing/PricingClient'
import { PublicMarketingPageFrame } from '@/features/showcase/PublicMarketingPageFrame'
import { getOverlayCapabilitiesSync } from '@/server/capabilities'

export default function PublicPricingPage() {
  const capabilities = getOverlayCapabilitiesSync()
  return (
    <PublicMarketingPageFrame title="Pricing">
      <PricingClient billingEnabled={capabilities.billing} />
    </PublicMarketingPageFrame>
  )
}
