'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'

const PHRASES = {
  oss: { text: 'open source', href: '#open-source', color: '#16a34a' },
  multi: { text: 'multiplayer', href: '#multiplayer', color: '#db2777' },
  cloud: { text: 'cloud', href: '#cloud', color: '#2563eb' },
  cp: { text: 'control plane', href: '#control-plane', color: '#7c3aed' },
  ai: { text: 'AI employees', href: '#ai-employees', color: '#ea580c' },
  agents: { text: 'agents', href: '#ai-employees', color: '#ea580c' },
  workspace: { text: 'workspace', href: '#control-plane', color: '#7c3aed' },
}

function Phrase({ k }: { k: keyof typeof PHRASES }) {
  const phrase = PHRASES[k]
  return <a className="k" href={phrase.href} style={{ '--k': phrase.color } as CSSProperties}>{phrase.text}</a>
}

export function LandingHeadline() {
  const headline = useRef<HTMLHeadingElement>(null)
  const [turn, setTurn] = useState(0)
  const active = turn % 2

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined
    function start() {
      clearInterval(timer)
      if (document.hidden) return
      timer = setInterval(() => {
        if (!headline.current?.contains(document.activeElement)) setTurn(value => value + 1)
      }, 5000)
    }
    start()
    document.addEventListener('visibilitychange', start)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', start)
    }
  }, [])

  return (
    <h1 ref={headline} className="h1 headline-reel" data-animated={turn > 0 || undefined}>
      <span className="headline-face" data-active={active === 0} aria-hidden={active !== 0} inert={active !== 0}>
        <span>
          The <Phrase k="oss" /> <Phrase k="multi" /> <Phrase k="cloud" />
          <span className="br-lg" /> <Phrase k="cp" /> for <Phrase k="ai" />
        </span>
      </span>
      <span className="headline-face" data-active={active === 1} aria-hidden={active !== 1} inert={active !== 1}>
        <span>Give your <Phrase k="agents" /> a <Phrase k="workspace" />.</span>
      </span>
    </h1>
  )
}
