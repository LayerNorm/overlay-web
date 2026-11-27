import { AgentCreature } from '@/components/orb/Creature'

/**
 * The demo roster shown across the landing page. Agents are always their
 * creatures; the two Overlay agents (workspace and personal chief of staff)
 * render the Overlay mark, as in the app.
 */
export const LANDING_AGENTS = {
  overlay: { name: 'Overlay', isDefault: true },
  personalOverlay: { name: 'Overlay', isDefault: true },
  engineering: { name: 'Engineering', avatarShape: 'hexagon', avatarColor: '#16a34a' },
  growth: { name: 'Growth', avatarShape: 'cloud', avatarColor: '#7c3aed' },
  support: { name: 'Support', avatarShape: 'blob', avatarColor: '#db2777' },
  docs: { name: 'Docs', avatarShape: 'droplet', avatarColor: '#2563eb' },
  operations: { name: 'Operations', avatarShape: 'squircle', avatarColor: '#ea580c' },
  finance: { name: 'Finance', avatarShape: 'triangle', avatarColor: '#0d9488' },
  inbox: { name: 'Inbox', avatarShape: 'pill', avatarColor: '#ca8a04' },
  research: { name: 'Research', avatarShape: 'circle', avatarColor: '#64748b' },
} as const

export type LandingAgentId = keyof typeof LANDING_AGENTS

/** A landing agent's avatar. `working` makes the eyes look side to side; otherwise they blink. */
export function LandingAgent({ id, size, working = false }: { id: LandingAgentId; size: number; working?: boolean }) {
  const agent = LANDING_AGENTS[id]
  return <AgentCreature agent={agent} size={size} isDefault={'isDefault' in agent} animated working={working} />
}

/** The demo people. `photo` is optional; without one the avatar shows initials. */
export const LANDING_PEOPLE = {
  maya: { name: 'Maya Chen', initials: 'MC', role: 'CEO', photo: undefined as string | undefined },
  sam: { name: 'Sam Reyes', initials: 'SR', role: 'Head of Engineering', photo: undefined as string | undefined },
  lena: { name: 'Lena Park', initials: 'LP', role: 'Head of Growth', photo: undefined as string | undefined },
}

export type LandingPersonId = keyof typeof LANDING_PEOPLE

export function LandingPerson({ id, size }: { id: LandingPersonId; size: number }) {
  const person = LANDING_PEOPLE[id]
  return (
    <span className="person" role="img" aria-label={person.name} style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- small static marketing portrait */}
      {person.photo ? <img src={person.photo} alt="" /> : person.initials}
    </span>
  )
}
