'use client'

import type { ReactNode } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { LandingNav } from '@/features/marketing/landing/LandingNav'
import { getMarketingAppHref } from '@/shared/marketing/marketing'
import { MarketingFooter } from './MarketingFooter'

import '@/features/marketing/landing/landing.css'

/**
 * The marketing frame shared by the home page and every other public page:
 * the sticky landing nav, one hairline-framed column, and the footer inside
 * it. Pages render their sections as children (`.sec` blocks from
 * landing.css). These pages live outside the application sidebar shell.
 */
export function StaticMarketingShell({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth()
  return (
    <div className="sl">
      <LandingNav appHref={getMarketingAppHref(isAuthenticated)} />
      <div className="frame">
        {children}
        <MarketingFooter />
      </div>
    </div>
  )
}

/** The opening block of a marketing page: eyebrow label, title and lead. */
export function MarketingPageHead({
  label,
  title,
  lead,
  tall = false,
  children,
}: {
  label?: string
  /** Extra space below, for pages with nothing else on them. */
  tall?: boolean
  title: ReactNode
  lead?: ReactNode
  children?: ReactNode
}) {
  return (
    <section className={tall ? 'sec page-head tall' : 'sec page-head'}>
      {label ? <p className="eyebrow">{label}</p> : null}
      <h1 className="h1">{title}</h1>
      {lead ? <p className="lead">{lead}</p> : null}
      {children}
    </section>
  )
}
