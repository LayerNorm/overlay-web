'use client'

import Link from 'next/link'
import { Github, MoonStar, SunMedium } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useLandingTheme } from '@/contexts/LandingThemeContext'
import { MARKETING_DOCS_URL, MARKETING_GITHUB_URL, getMarketingAppHref } from '@/shared/marketing/marketing'
import { LandingOrb } from './LandingOrb'

/** Top bar. Its logo stays invisible until the big hero logo has travelled onto it. */
export function LandingNav() {
  const { toggleLandingTheme, isLandingDark } = useLandingTheme()
  const { isAuthenticated } = useAuth()
  return (
    <header className="nav" data-lp="nav">
      <Link className="lockup" data-lp="nav-lockup" href="/home" aria-label="Overlay home">
        <LandingOrb />
        overlay
      </Link>
      <nav className="nav-links" aria-label="Primary">
        <Link href="/home">Product</Link>
        <a href={MARKETING_DOCS_URL} target="_blank" rel="noopener noreferrer">Docs</a>
        <Link href="/pricing">Pricing</Link>
        <Link href="/blog">Blog</Link>
      </nav>
      <div className="nav-right">
        <button className="theme" type="button" onClick={toggleLandingTheme} aria-label="Toggle light / dark mode">
          {isLandingDark ? <SunMedium className="i" /> : <MoonStar className="i" />}
        </button>
        <a className="gh" href={MARKETING_GITHUB_URL} target="_blank" rel="noopener noreferrer" aria-label="GitHub">
          <Github className="i" />
        </a>
        <Link className="pill" href={getMarketingAppHref(isAuthenticated)}>Get Started</Link>
      </div>
    </header>
  )
}
