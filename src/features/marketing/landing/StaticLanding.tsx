'use client'

import Link from 'next/link'
import { Lusitana } from 'next/font/google'
import { ArrowRight } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { StaticMarketingShell } from '../components/StaticMarketingShell'
import { getMarketingAppHref } from '@/shared/marketing/marketing'
import { LandingAgent, type LandingAgentId } from './LandingAgent'
import { LandingAppPreview } from './LandingAppPreview'
import { LandingFaq } from './LandingFaq'
import { LandingHeadline } from './LandingHeadline'
import {
  AddToSlack, ChiefSection, CloudSection, ControlSection, FinalCtaSection, MultiplayerSection, OrgChartSection,
  ScopesSection, SelfDrivingSection, SlackSection, SuperpowersSection,
} from './LandingSections'

import './landing-home.css'

const lusitana = Lusitana({ subsets: ['latin'], weight: '400', variable: '--font-lusitana', display: 'swap' })

/** The team row under the hero actions: Overlay in the middle, its agents on both sides. */
const TEAM: Array<[LandingAgentId, number, string]> = [
  ['growth', 40, 'Growth'], ['engineering', 44, 'Engineering'], ['support', 48, 'Support'],
  ['operations', 48, 'Operations'], ['finance', 44, 'Finance'], ['docs', 40, 'Docs'],
]

/**
 * The marketing home page: Overlay as the AI Chief of Staff, its team of
 * agents, and where it runs. A static scroll in one framed column with
 * hairline sections; the two app previews are clickable.
 */
export function StaticLanding() {
  const { isAuthenticated } = useAuth()
  const appHref = getMarketingAppHref(isAuthenticated)
  const mate = ([id, size, name]: [LandingAgentId, number, string]) => (
    <div className="mate" key={id}><LandingAgent id={id} size={size} /><span>{name}</span></div>
  )
  return (
    <StaticMarketingShell>
      <section className="hero">
        <a className={`backed ${lusitana.variable}`} href="https://verdictcap.com" target="_blank" rel="noopener noreferrer">Backed by <span>verdict.</span></a>
        <LandingHeadline />
        <p className="lead">Create, manage and deploy swarms of AI coworkers to solve your hardest problems.</p>
        <div className="actions">
          <Link className="btn primary" href={appHref}>Get started <ArrowRight className="i go" /></Link>
          <AddToSlack />
        </div>
        <div className="team" aria-label="Overlay and its team of agents">
          {TEAM.slice(0, 3).map(mate)}
          <div className="mate lead-mate"><LandingAgent id="overlay" size={72} /><span>Overlay<br /><span className="sub">Chief of Staff</span></span></div>
          {TEAM.slice(3).map(mate)}
        </div>
        <LandingAppPreview className="hero-app" label="Clickable preview of the Overlay app" />
      </section>
      <SuperpowersSection />
      <ChiefSection />
      <OrgChartSection />
      <MultiplayerSection />
      <ScopesSection />
      <SelfDrivingSection />
      <CloudSection />
      <SlackSection />
      <ControlSection />
      <FinalCtaSection appHref={appHref} />
      <LandingFaq />
    </StaticMarketingShell>
  )
}
