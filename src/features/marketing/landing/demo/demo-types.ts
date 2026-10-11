import type { CreatureShape } from '@/components/orb/Creature'
import type { LogoName } from '../LandingLogo'

/** Types and tiny constructors for the hero demo's scripted content. */

export type Msg = {
  who: 'you' | 'agent'
  /** Display time ("9:03 AM"); empty for chats and automations. */
  t: string
  text: string
  /** "Worked for 48s, called 6 tools" row above an agent reply. */
  tool?: string
  /** A code block shown under the reply. */
  code?: { label: string; lines: string[] }
  /** Text shown after the code block. */
  after?: string
}

/** Your message. */
export const Y = (t: string, text: string): Msg => ({ who: 'you', t, text })
/** An agent's reply, optionally with a tool row / code block / trailing text. */
export const A = (t: string, text: string, extra?: Partial<Msg>): Msg => ({ who: 'agent', t, text, ...extra })

export type Persona = { name: string; shape: CreatureShape; color: string }
export type AgentSeed = Persona & { main: Msg[] }
export type Agent = Persona & { threads: { main: Msg[]; new: Msg[] } }

export type Scope = 'personal' | 'workspace'

export type ChatSeed = { title: string; msgs: Msg[] }
export type Chat = ChatSeed & { id: string }

export type AutoSeed = { n: string; title: string; scope: Scope; msgs: Msg[] }
export type Auto = AutoSeed & { id: string }

export type FileItem = { name: string; kind: 'md' | 'md2' | 'csv' | 'pdf' }

export type ExtKind = 'app' | 'skill' | 'mcp'
export type Ext = { n: string; t: ExtKind; l: LogoName; d: string; on: boolean }
export type ExtFilter = 'all' | 'connected' | ExtKind

export type View = 'agents' | 'chats' | 'files' | 'extensions' | 'automations'
