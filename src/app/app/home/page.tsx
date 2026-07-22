import HomeMarketingPage from '@/features/marketing/pages/MarketingOverviewPage'
import { PublicMarketingPageFrame } from '@/features/showcase/PublicMarketingPageFrame'

export default function PublicHomePage() {
  return (
    <PublicMarketingPageFrame title="Home">
      <HomeMarketingPage />
    </PublicMarketingPageFrame>
  )
}
