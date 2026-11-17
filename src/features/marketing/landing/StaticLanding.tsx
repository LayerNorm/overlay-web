'use client'

import Link from 'next/link'
import { Lusitana } from 'next/font/google'
import { ArrowRight } from 'lucide-react'
import { AppleMark } from './AppleMark'
import { GithubMark } from './GithubMark'
import { useAuth } from '@/contexts/AuthContext'
import { StaticMarketingShell } from '../components/StaticMarketingShell'
import { getMarketingAppHref, MARKETING_GITHUB_URL } from '@/shared/marketing/marketing'
import { DESKTOP_DOWNLOAD_START_PATH } from '@/shared/web/latest-release'
import { useVisitorPlatform } from '../lib/visitor-platform'
import { LandingFaq } from './LandingFaq'
import { LandingHeadline } from './LandingHeadline'
import { LandingLogo, type LogoName } from './LandingLogo'
import { LandingProductShot } from './LandingProductShot'
import { ControlSection, GetOverlaySection, OnePlaceSection, OverlayForMacSection, SuperpowersSection, TeamsSection } from './LandingSections'

const lusitana = Lusitana({ subsets: ['latin'], weight: '400', variable: '--font-lusitana', display: 'swap' })

const BYOA: Array<{ name: string; logo: LogoName }> = [
  { name: 'Claude Code', logo: 'claude' },
  { name: 'Codex', logo: 'openai' },
  { name: 'Cursor', logo: 'cursor' },
]

/**
 * The marketing home page: a static scroll in one framed column with hairline
 * sections. The hero headline rotates independently of the static page.
 */
export function StaticLanding() {
  const { isAuthenticated } = useAuth()
  const appHref = getMarketingAppHref(isAuthenticated)
  // Mac visitors are offered the desktop app beside "Get started"; everyone else keeps the GitHub button.
  const onMac = useVisitorPlatform() === 'mac'
  return (
    <StaticMarketingShell>
      <section className="hero">
        <a className={`backed ${lusitana.variable}`} href="https://verdictcap.com" target="_blank" rel="noopener noreferrer">Backed by <span>verdict.</span></a>
        <LandingHeadline />
        <p className="lead">Create, deploy and manage AI employees with memory, tools and their own computer. Accessible from anywhere.</p>
        <div className="actions">
          <Link className="btn primary" href={appHref}>Get started <ArrowRight className="i go" /></Link>
          {onMac ? (
            <a className="btn ghost" href={DESKTOP_DOWNLOAD_START_PATH}><AppleMark /> Download for Mac</a>
          ) : (
            <a className="btn ghost" href={MARKETING_GITHUB_URL} target="_blank" rel="noopener noreferrer"><GithubMark /> Star on GitHub</a>
          )}
        </div>
        <div className="byoa">
          <span>Bring your own agents</span>
          {BYOA.map((agent) => (
            <span className="chip" key={agent.name}>
              <LandingLogo name={agent.logo} className="logo" />
              {agent.name}
            </span>
          ))}
          <span className="more">+ more</span>
        </div>
        <LandingProductShot />
      </section>
      <SuperpowersSection />
      <OnePlaceSection appHref={appHref} />
      <OverlayForMacSection />
      <TeamsSection />
      <ControlSection />
      <GetOverlaySection appHref={appHref} />
      <LandingFaq />
    </StaticMarketingShell>
  )
}
