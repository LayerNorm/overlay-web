'use client'

import { useEffect, useRef, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { MarketingFooter } from '../components/MarketingFooter'
import { getMarketingAppHref } from '@/shared/marketing/marketing'
import { GraphicPanel } from './GraphicPanel'
import { LandingAgents } from './LandingAgents'
import { LandingCta } from './LandingCta'
import { LandingHero } from './LandingHero'
import { LandingNav } from './LandingNav'
import { LandingRail } from './LandingRail'
import { LandingSide } from './LandingSide'
import { LandingTitle } from './LandingTitle'
import { LandingEngine } from './engine/LandingEngine'
import { createGfxBus } from './graphics/gfx-bus'
import { SCENES, sceneOfItem, SIDE } from './landing-scenes'

import './styles/landing-base.css'
import './styles/landing-agents.css'
import './styles/landing-demo.css'
import './styles/landing-graphics.css'

/**
 * The marketing home page: one scroll story. A tall track holds a single sticky
 * stage; scroll position decides which scene is on screen. `LandingEngine`
 * moves everything that follows the scroll continuously, and this component
 * renders the content that changes from scene to scene.
 */
export function ScrollLanding() {
  const rootRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<LandingEngine | null>(null)
  const [bus] = useState(createGfxBus)
  const [scene, setScene] = useState(0)
  const [animated, setAnimated] = useState(false)
  const { isAuthenticated } = useAuth()

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const engine = new LandingEngine(root, bus, {
      onScene: (i) => {
        setScene(i)
        setAnimated((was) => was || i !== 0)
      },
    })
    engineRef.current = engine
    engine.start()
    return () => {
      engine.destroy()
      engineRef.current = null
    }
  }, [bus])

  const current = SCENES[scene]
  const hasSide = Boolean(SIDE[current.sec])

  return (
    <>
      <div className="lp" ref={rootRef}>
        <div className="lp-track" data-lp="track">
          <div className="lp-stage" data-sec={current.sec}>
            <LandingNav />
            <LandingHero />
            <LandingAgents />
            <LandingRail />
            <main className="view" data-lp="view">
              <LandingTitle pre={current.pre} piece={current.piece} animate={animated} />
              <div className={hasSide ? 'body' : 'body no-side'}>
                <GraphicPanel scene={scene} bus={bus} />
                <LandingSide
                  sec={current.sec}
                  active={current.item}
                  onPick={(item) => engineRef.current?.go(sceneOfItem(current.sec, item))}
                />
              </div>
              <LandingCta appHref={getMarketingAppHref(isAuthenticated)} />
            </main>
          </div>
        </div>
      </div>
      {/* outside .lp: the landing reset would strip the footer's own utility styles */}
      <MarketingFooter />
    </>
  )
}
