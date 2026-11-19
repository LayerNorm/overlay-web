import type { CSSProperties } from 'react'

const PHRASES = {
  sdc: { text: 'self-driving companies', href: '#control-plane', color: '#7c3aed' },
  oss: { text: 'open source', href: '#open-source', color: '#16a34a' },
  multi: { text: 'multiplayer', href: '#multiplayer', color: '#db2777' },
  cloud: { text: 'cloud', href: '#cloud', color: '#2563eb' },
  cp: { text: 'control plane', href: '#control-plane', color: '#7c3aed' },
  ai: { text: 'AI employees', href: '#ai-employees', color: '#ea580c' },
  agents: { text: 'agents', href: '#ai-employees', color: '#ea580c' },
  workspace: { text: 'workspace', href: '#control-plane', color: '#7c3aed' },
}

export type LandingPhrase = keyof typeof PHRASES

/** An underlined, colored keyword that jumps to the section explaining it. */
export function Phrase({ k }: { k: LandingPhrase }) {
  const phrase = PHRASES[k]
  return <a className="k" href={phrase.href} style={{ '--k': phrase.color } as CSSProperties}>{phrase.text}</a>
}

export function LandingHeadline() {
  return (
    <h1 className="h1">
      Enabling <Phrase k="sdc" /><span className="br-md" /> with <Phrase k="ai" />
    </h1>
  )
}
