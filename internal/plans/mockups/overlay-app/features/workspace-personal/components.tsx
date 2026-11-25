import { useState, useSyncExternalStore, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { Check, Info, Mail, User, UsersRound, X, type LucideIcon } from 'lucide-react'
import {
  Button, Checkbox, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Label,
} from '@overlay/ui/primitives'
import { DelayedTooltip } from '@overlay/ui/overlays'
import { AgentCreature } from '@/components/orb/Creature'
import { AGENTS } from '../../fixtures/agents'
import { navigate, useHref } from '../../shims/router'
import { MODE, PROPOSED, markMoved, moved, reloadWith, type Mode } from './model'

/* ---------- P2: one mode switch, in the primary rail ---------- */

type PanelScope = 'personal' | 'workspace'
const MODES: Array<[PanelScope, LucideIcon, string]> = [
  ['workspace', UsersRound, 'Workspace'],
  ['personal', User, 'Personal'],
]

/** Proposed: Workspace or Personal for every section at once, at the top of the primary rail. Workspace is the default. */
export function RailModeSwitch({ scope, onChange }: { scope: PanelScope; onChange(next: PanelScope): void }) {
  const href = useHref()
  if (!PROPOSED) return null
  // An agent belongs to one mode, so switching from an agent thread opens the other mode's chief.
  const change = (next: PanelScope) => (href.includes('/agents') ? navigate(sectionHref('agents', next)) : onChange(next))
  return (
    <div role="radiogroup" aria-label="Mode" className="mb-3 mt-2 flex w-10 flex-col gap-0.5 rounded-xl border border-(--border) p-0.5">
      {MODES.map(([id, Icon, label]) => {
        const active = scope === id
        return (
          <DelayedTooltip key={id} label={label} side="right">
            <Button variant="ghost" size="icon" role="radio" aria-checked={active} aria-label={label} onClick={() => change(id)}
              className={`size-[34px] rounded-[9px] ${active ? 'bg-(--surface-subtle) text-(--foreground) hover:bg-(--surface-subtle)' : 'text-(--muted-light) hover:text-(--foreground)'}`}>
              <Icon size={16} strokeWidth={1.75} aria-hidden />
            </Button>
          </DelayedTooltip>
        )
      })}
    </div>
  )
}

/* ---------- P4/P5: one-way, confirmed moves ---------- */

type DialogState =
  | { kind: 'move'; resource: string; item: Record<string, unknown> & { _id: string } }
  | { kind: 'connect'; then?: DialogState }
  | null

let dialog: DialogState = null
const listeners = new Set<() => void>()
const setDialog = (next: DialogState) => { dialog = next; listeners.forEach((listener) => listener()) }
const useDialog = () => useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener) }, () => dialog)

/** Workspace accounts connected during this visit (P5). */
const workspaceAccounts = new Set<string>()

/** Proposed: an item only ever moves Personal → Workspace. */
export function proposedMoveTo(to: string | null): string | null {
  if (!PROPOSED) return to
  return to === 'workspace' ? to : null
}
export function requestMove(resource: string, item: Record<string, unknown> & { _id: string }) {
  setDialog({ kind: 'move', resource, item })
}

type Requirement = { key: string; icon: ReactNode; title: string; detail: string; resolved: boolean; action?: ReactNode }

function RequirementRow({ item }: { item: Requirement }) {
  return (
    <li className="flex items-start gap-3 rounded-lg border border-(--border) px-3 py-2.5">
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center">{item.icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-(--foreground)">{item.title}</span>
        <span className="block text-xs leading-5 text-(--muted)">{item.detail}</span>
        {item.action ? <span className="mt-2 block">{item.action}</span> : null}
      </span>
      {item.resolved ? <Check size={14} aria-label="Ready" className="mt-1 shrink-0 text-(--muted)" /> : null}
    </li>
  )
}

const itemName = (item: Record<string, unknown>) => String(item.name ?? item.title ?? 'this item')

function MoveDialog({ resource, item }: { resource: string; item: Record<string, unknown> & { _id: string } }) {
  const agent = typeof item.agentId === 'string' ? AGENTS.find((entry) => entry.id === item.agentId) : undefined
  const agentIsPersonal = agent ? agent.visibility === 'creator' && !moved.has(agent.id) : false
  const [moveAgent, setMoveAgent] = useState(true)
  const needsGmail = resource === 'automations' && /inbox/i.test(itemName(item))
  const gmailReady = workspaceAccounts.has('gmail')

  const requirements: Requirement[] = []
  if (agent && agentIsPersonal) {
    requirements.push({
      key: 'agent',
      icon: <AgentCreature agent={agent as never} size={18} />,
      title: `${agent.name} is a Personal agent`,
      detail: 'A workspace automation needs an agent everyone can see.',
      resolved: moveAgent,
      action: (
        <Label className="flex items-center gap-2 text-xs font-normal text-(--foreground)">
          <Checkbox checked={moveAgent} onCheckedChange={(value) => setMoveAgent(value === true)} />
          Move {agent.name} to the workspace too
        </Label>
      ),
    })
  }
  if (needsGmail) {
    requirements.push({
      key: 'gmail',
      icon: <Mail size={15} strokeWidth={1.75} aria-hidden className="text-(--muted)" />,
      title: gmailReady ? 'Uses Northwind’s Gmail' : 'Uses your personal Gmail',
      detail: gmailReady
        ? 'Runs read and send from the workspace account, not yours.'
        : 'Workspace automations use workspace accounts. Your Gmail stays yours.',
      resolved: gmailReady,
      action: gmailReady ? undefined : (
        <Button type="button" variant="outline" size="xs" className="h-7 px-2.5 text-xs font-normal" onClick={() => setDialog({ kind: 'connect', then: { kind: 'move', resource, item } })}>
          Connect a Gmail for Northwind
        </Button>
      ),
    })
  }
  const ready = requirements.every((entry) => entry.resolved)
  const what = resource === 'automations'
    ? `“${itemName(item)}” will run for Northwind, with workspace accounts and budget.`
    : `Everyone in Northwind will be able to open “${itemName(item)}”, and their chats can find it.`

  return (
    <DialogContent>
      <DialogHeader className="flex-col items-start gap-1 pr-6">
        <DialogTitle>Move to workspace?</DialogTitle>
        <DialogDescription>{what} You can’t move it back to Personal.</DialogDescription>
      </DialogHeader>
      {requirements.length ? <ul className="space-y-2">{requirements.map((entry) => <RequirementRow key={entry.key} item={entry} />)}</ul> : null}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={() => setDialog(null)}>Cancel</Button>
        <Button type="button" variant="secondary" disabled={!ready} onClick={() => {
          markMoved(item._id, ...(agent && agentIsPersonal && moveAgent ? [agent.id] : []))
          setDialog(null)
        }}>Move to workspace</Button>
      </DialogFooter>
    </DialogContent>
  )
}

function ConnectDialog({ then }: { then?: DialogState }) {
  return (
    <DialogContent>
      <DialogHeader className="flex-col items-start gap-1 pr-6">
        <DialogTitle>Connect a Gmail for Northwind</DialogTitle>
        <DialogDescription>Sign in with an account the workspace owns, such as ops@northwind.example. Workspace automations and shared rooms use it. Your personal Gmail is not shared.</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={() => setDialog(then ?? null)}>Back</Button>
        <Button type="button" variant="secondary" onClick={() => { workspaceAccounts.add('gmail'); setDialog(then ?? null) }}>Continue with Google</Button>
      </DialogFooter>
    </DialogContent>
  )
}

function DialogHost() {
  const state = useDialog()
  return (
    <Dialog open={state !== null} onOpenChange={(open) => { if (!open) setDialog(null) }}>
      {state?.kind === 'move' ? <MoveDialog key={state.item._id} resource={state.resource} item={state.item} /> : null}
      {state?.kind === 'connect' ? <ConnectDialog then={state.then} /> : null}
    </Dialog>
  )
}

/* ---------- The bar and "What changes" ---------- */

const SECTIONS: Array<[string, string]> = [
  ['Agents', 'agents'],
  ['Chats', 'chat'],
  ['Files', 'files'],
  ['Automations', 'automations'],
]

function sectionHref(section: string, mode: PanelScope) {
  if (section === 'agents') {
    return mode === 'workspace'
      ? '/w/northwind/workspace/agents?agent=agent_overlay&id=k17convpricing000000000000000000'
      : '/w/northwind/personal/agents?agent=agent_chief&id=k17convchiefweek0000000000000000'
  }
  return `/w/northwind/${mode}/${section}`
}

function Segments<T extends string>({ label, value, options, onChange }: { label: string; value: T | null; options: Array<[T, string]>; onChange(next: T): void }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex shrink-0 rounded-lg bg-(--surface-subtle) p-0.5">
      {options.map(([option, text]) => (
        <Button key={option} variant="ghost" size="xs" role="radio" aria-checked={value === option} onClick={() => onChange(option)}
          className={`h-6 rounded-md px-2 text-[11px] font-normal ${value === option ? 'bg-(--surface-elevated) text-(--foreground) shadow-xs hover:bg-(--surface-elevated)' : 'text-(--muted)'}`}>
          {text}
        </Button>
      ))}
    </div>
  )
}

const CHANGES: Array<[string, string, string]> = [
  ['P2', 'One mode switch', 'Workspace or Personal is chosen once, at the top of the primary rail, and every section follows it. Workspace is the default and the choice is remembered. Sections lose their own Personal | Workspace toggle. What you create belongs to the mode you are in. Channels and DMs appear only in Workspace.'],
  ['P3', 'The Personal Chief', '“Overlay” is the workspace’s Chief of Staff. Your own chief is “Mercedes’s Chief” and lives only in Personal: it isn’t listed in Workspace, can’t be mentioned in channels and never answers in Slack or Discord. Personal agents are your creator-only agents (Scout here); Atlas is visible to the workspace, so it lists there.'],
  ['P4', 'Moves go one way', 'In Personal, an item offers “Move to workspace”; nothing moves back. The move is confirmed. Moving an automation checks its agent and can move a Personal agent along.'],
  ['P5', 'Accounts move honestly', 'A personal account is never shared by moving something. A workspace automation that needs Gmail asks for a Gmail the workspace owns.'],
  ['P6', 'Workspace runs use workspace reach', 'Workspace automations and replies in shared rooms use workspace accounts and keys, never the asker’s or creator’s.'],
  ['P7', 'Workspace knowledge is searchable', 'Workspace files can be found from any member’s chats and from every Personal Chief.'],
]

function Notes({ onClose }: { onClose(): void }) {
  return (
    <div className="fixed right-3 top-12 z-40 max-h-[calc(100vh-4rem)] w-[min(400px,calc(100vw-1.5rem))] overflow-y-auto rounded-xl border border-(--border) bg-(--surface-elevated) p-4 text-sm shadow-lg">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-(--foreground)">What changes</h2>
        <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose} className="h-7 w-7 text-(--muted)"><X size={14} /></Button>
      </div>
      <p className="mt-1 text-xs leading-5 text-(--muted)">Personal lives inside each workspace and is only yours. It is created the first time you switch to it, and it spends the workspace’s budget.</p>
      <ol className="mt-3 space-y-3">
        {CHANGES.map(([phase, title, body]) => (
          <li key={phase} className="text-xs leading-5">
            <p className="text-(--foreground)"><span className="text-(--muted)">{phase}</span> · {title}</p>
            <p className="mt-0.5 text-(--muted)">{body}</p>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-xs leading-5 text-(--muted)">Try it: switch modes at the top of the rail. In Personal → Automations, hover “Competitor pricing watch” (its agent is Personal) or “Morning inbox triage” (it uses your Gmail) and move it to the workspace.</p>
    </div>
  )
}

function MockupBar() {
  const href = useHref()
  const [notes, setNotesState] = useState(() => {
    try { return sessionStorage.getItem('wp-notes') !== 'closed' } catch { return true }
  })
  const setNotes = (next: boolean) => {
    setNotesState(next)
    try { sessionStorage.setItem('wp-notes', next ? 'open' : 'closed') } catch { /* not remembered */ }
  }
  const mode: PanelScope = href.includes('/personal/') ? 'personal' : 'workspace'
  const section = SECTIONS.find(([, id]) => href.includes(`/${id}`))?.[1] ?? null
  return (
    <>
      <div className="fixed inset-x-0 top-0 z-40 flex h-10 items-center gap-2 overflow-x-auto bg-background px-3 text-(--muted)">
        <span className="shrink-0 text-[11px] max-md:hidden">Workspace and Personal</span>
        <span className="flex-1" />
        <Segments label="Section" value={section} options={SECTIONS.map(([text, id]) => [id, text])} onChange={(id) => navigate(sectionHref(id, mode))} />
        <Segments<Mode> label="Version" value={MODE} options={[['today', 'Today'], ['proposed', 'Proposed']]} onChange={(next) => reloadWith('mode', next)} />
        <Button variant="ghost" size="xs" aria-pressed={notes} onClick={() => setNotes(!notes)} className="h-6 shrink-0 gap-1.5 px-2 text-[11px] font-normal text-(--muted)">
          <Info size={12} strokeWidth={1.75} />What changes
        </Button>
      </div>
      {notes ? <Notes onClose={() => setNotes(false)} /> : null}
      <DialogHost />
    </>
  )
}

export function mountMockupBar() {
  document.documentElement.dataset.mockupHost = 'bar'
  const style = document.createElement('style')
  style.textContent = 'html[data-mockup-host] [data-app-shell]{height:calc(100vh - 40px)!important;margin-top:40px}'
  document.head.append(style)
  if (!globalThis.location.hash) globalThis.location.hash = sectionHref('agents', 'workspace')
  const node = document.createElement('div')
  document.body.append(node)
  createRoot(node).render(<MockupBar />)
}
