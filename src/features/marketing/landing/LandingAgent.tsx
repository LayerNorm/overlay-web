import { AgentCreature } from '@/components/orb/Creature'

/** The demo roster shown across the landing page. Agents are always their creatures. */
export const LANDING_AGENTS = {
  engineering: { name: 'Engineering', avatarShape: 'hexagon', avatarColor: '#16a34a' },
  support: { name: 'Customer support', avatarShape: 'blob', avatarColor: '#db2777' },
  fundraising: { name: 'Fundraising', avatarShape: 'cloud', avatarColor: '#7c3aed' },
  docs: { name: 'Docs agent', avatarShape: 'droplet', avatarColor: '#2563eb' },
  operations: { name: 'Operations', avatarShape: 'squircle', avatarColor: '#ea580c' },
  codex: { name: 'Codex agent', avatarShape: 'circle', avatarColor: '#64748b' },
} as const

export type LandingAgentId = keyof typeof LANDING_AGENTS

export function LandingAgent({ id, size }: { id: LandingAgentId; size: number }) {
  return <AgentCreature agent={LANDING_AGENTS[id]} size={size} />
}
