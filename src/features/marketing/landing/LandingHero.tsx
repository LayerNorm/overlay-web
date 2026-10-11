import { memo } from 'react'
import Link from 'next/link'
import { HeroDemo } from './demo/HeroDemo'
import { LandingOrb } from './LandingOrb'

/**
 * Section 1: the logo, the one-line pitch and a working miniature of the app.
 * The five underlined phrases are invisible here; the rail items sit on top of
 * them at scroll 0 and fly into the rail as you scroll.
 */
export const LandingHero = memo(function LandingHero() {
  return (
    <section className="hero" data-lp="hero">
      <Link className="lockup" data-lp="hero-lockup" href="/home" aria-label="Overlay home">
        <LandingOrb />
        overlay
      </Link>
      <h1 className="sub" data-lp="sub">
        <span className="w">The</span>
        <span className="anchor">
          <span className="ins"><span className="k" data-k="oss">open source</span></span>
          <svg className="caret" viewBox="0 0 20 12" aria-hidden="true"><path d="M2 11 10 2l8 9" /></svg>
        </span>{' '}
        <span className="k" data-k="multi">multiplayer</span>{' '}
        <span className="k" data-k="cloud">cloud</span>{' '}
        <span className="k" data-k="cp">control plane</span>{' '}
        <span className="w">for</span>{' '}
        <span className="k" data-k="ai">AI employees</span>
      </h1>
      <HeroDemo />
    </section>
  )
})
