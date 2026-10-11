import type { CreatureShape } from '@/components/orb/Creature'

/**
 * The agents that decorate the page. Each one sits near a screen edge and, as
 * you scroll, is pulled straight out through the nearest edge while the next
 * section's pair slides in from theirs.
 *
 * `x` / `y` are the agent's center in % of the stage, `s` its size in px on a
 * 1300px-wide screen, `r` its resting tilt in degrees.
 */
export type LandingAgent = {
  shape: CreatureShape
  color: string
  x: number
  y: number
  s: number
  r: number
  say: string
}

export type AgentGroupKey = 'hero' | 'ai' | 'cp' | 'cloud' | 'multi' | 'oss' | 'start'

export const AGENT_GROUP_ORDER: AgentGroupKey[] = ['hero', 'ai', 'cp', 'cloud', 'multi', 'oss', 'start']

export const AGENT_GROUPS: Record<AgentGroupKey, LandingAgent[]> = {
  hero: [
    { shape: 'blob', color: '#db2777', x: 3, y: 37, s: 119, r: -9, say: 'I triage support tickets every morning.' },
    { shape: 'hexagon', color: '#16a34a', x: 27, y: 3, s: 100, r: 12, say: 'I review pull requests on every push.' },
    { shape: 'droplet', color: '#2563eb', x: 97, y: 61, s: 114, r: 8, say: 'I run on schedules and triggers.' },
    { shape: 'cloud', color: '#7c3aed', x: 93, y: 96, s: 109, r: -6, say: 'I send your weekly update on Fridays.' },
  ],
  ai: [
    { shape: 'squircle', color: '#ea580c', x: 7, y: 86, s: 96, r: -8, say: 'I remember every decision your team makes.' },
    { shape: 'pill', color: '#f59e0b', x: 93, y: 22, s: 105, r: 7, say: 'Give me a computer and I will run the tests.' },
  ],
  cp: [
    { shape: 'circle', color: '#64748b', x: 7, y: 24, s: 91, r: 6, say: 'Bring your own agents, too.' },
    { shape: 'triangle', color: '#dc2626', x: 93, y: 80, s: 98, r: -7, say: 'Create an agent in seconds.' },
  ],
  cloud: [
    { shape: 'cloud', color: '#0ea5e9', x: 8, y: 86, s: 109, r: -5, say: 'I keep working while your laptop is closed.' },
    { shape: 'droplet', color: '#16a34a', x: 92, y: 26, s: 91, r: 9, say: 'Open me from your phone, anywhere.' },
  ],
  multi: [
    { shape: 'hexagon', color: '#db2777', x: 8, y: 26, s: 93, r: -10, say: 'Share me with your whole team.' },
    { shape: 'blob', color: '#f59e0b', x: 92, y: 78, s: 105, r: 6, say: 'Assign me a task in any thread.' },
  ],
  oss: [
    { shape: 'hexagon', color: '#7c3aed', x: 6, y: 90, s: 96, r: 8, say: 'Read the source before you trust it.' },
    { shape: 'squircle', color: '#2563eb', x: 93, y: 52, s: 93, r: -7, say: 'Self-host me on your own servers.' },
  ],
  start: [
    { shape: 'blob', color: '#16a34a', x: 4, y: 21, s: 109, r: -7, say: 'Ready for your first task.' },
    { shape: 'circle', color: '#db2777', x: 96, y: 76, s: 100, r: 8, say: 'Assign me work in plain language.' },
  ],
}
