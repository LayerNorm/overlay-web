'use client'

import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import { MarketingFooter } from '@/features/marketing/components/MarketingFooter'
import { StaticMarketingShell } from '@/features/marketing/components/StaticMarketingShell'
import { getMarketingAppHref } from '@/shared/marketing/marketing'
import { PricingBill } from './PricingBill'
import { PricingEnd, PricingFaq, PricingHero, PricingKinds, PricingTrust } from './PricingSections'
import s from './pricing.module.css'

/**
 * Pricing. A workspace is free or paid (never the account). Paid is a monthly
 * plan of $8 to $500 that becomes that month's credit. `full` adds the on-demand
 * controls and the itemized example bill, which ship with those features.
 */
export function PricingPage({ billingEnabled, full = false }: { billingEnabled: boolean; full?: boolean }) {
  const { isAuthenticated } = useAuth()
  const appHref = getMarketingAppHref(isAuthenticated)
  return (
    <StaticMarketingShell>
      <main className={s.root}>
        {billingEnabled ? (
          <>
            <PricingHero appHref={appHref} />
            <PricingKinds />
            <PricingBill full={full} />
            <PricingTrust full={full} />
            <PricingFaq />
            <PricingEnd appHref={appHref} />
          </>
        ) : (
          <div className={s.hero}>
            <h1>Billing unavailable.</h1>
            <p>This deployment does not use Overlay-managed billing. Workspace access is controlled by the deployment administrator.</p>
            <div className={s.go}><Link className={s.btn} href="/app/chat">Open app</Link></div>
          </div>
        )}
      </main>
      <MarketingFooter />
    </StaticMarketingShell>
  )
}
