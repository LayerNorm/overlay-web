import { useId, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import Link from 'next/link'
import { ArrowUpRight, Check, ChevronDown, ChevronRight, Folder, GitBranch, Info, Monitor, Pin, Plus, Search, UsersRound, X, type LucideIcon } from 'lucide-react'
import { Button, Input } from '@overlay/ui/primitives'
import { RightSidebar, RightSidebarToggle } from '@overlay/modules-react/shell'
import { ThreadActivityIndicator } from '@/components/layout/sidebar/ThreadActivityIndicator'
import type { ThreadActivityStatus } from '@/shared/agents/thread-activity'
import { currentHref, navigate, useHref } from '../../shims/router'
import {
  CHANNEL_ID, CHIEF_THREAD_ID, DM_ID, MODE, assignmentsForConversation, assignmentsForMessage, conversationInHref, switchMode,
  type Assignment, type Mode,
} from './model'

const ACTIVITY: Record<Assignment['status'], ThreadActivityStatus> = { running: 'working', completed: 'completed', failed: 'failed', waiting_for_input: 'needs_input' }
const LABEL: Record<Assignment['status'], string> = { running: 'Working', completed: 'Completed', failed: 'Failed', waiting_for_input: 'Needs input' }
const threadHref = (item: Assignment) => (item.agentId && item.threadId ? `/app/agents?agent=${item.agentId}&id=${item.threadId}&scope=workspace` : null)

function summary(items: Assignment[]) {
  const count = (status: Assignment['status']) => items.filter((item) => item.status === status).length
  const failed = count('failed')
  return `${count('completed')}/${items.length} completed${failed ? ` · ${failed} failed` : ''}`
}

function AssignmentRow({ item }: { item: Assignment }) {
  const href = threadHref(item)
  const body = (
    <>
      <span className="flex h-5 w-4 shrink-0 items-center justify-center">
        {item.status === 'completed' ? <Check size={13} aria-hidden className="text-(--muted)" /> : <ThreadActivityIndicator status={ACTIVITY[item.status]} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm" title={item.title}>{item.title}</span>
        <span className="block truncate text-xs text-(--muted)">{item.agentName} · {LABEL[item.status]}</span>
      </span>
      {href ? <ArrowUpRight size={14} aria-hidden className="mt-0.5 shrink-0 text-(--muted)" /> : null}
    </>
  )
  const rowClass = 'h-auto w-full items-start justify-start gap-3 rounded-lg px-3 py-2.5 text-left font-normal'
  return (
    <li>
      {href
        ? <Button asChild variant="ghost" className={rowClass}><Link href={href}>{body}</Link></Button>
        : <div className={`flex ${rowClass}`}>{body}</div>}
      {item.reason || item.actions ? (
        <div className="pb-2 pl-10 pr-3">
          {item.reason ? <p className="text-xs leading-5 text-(--muted)">{item.reason}</p> : null}
          <div className="mt-1 flex flex-wrap gap-1.5 empty:hidden">
            {item.actions?.map((action) => <Button key={action} variant="outline" size="xs" className="h-6 px-2 text-[11px] font-normal">{action}</Button>)}
          </div>
        </div>
      ) : null}
    </li>
  )
}

/** Proposed: the assignments a response made, inside that response and as wide as its text. */
export function ResponseAssignments({ messageId }: { messageId: string }) {
  const [expanded, setExpanded] = useState(true)
  const listId = useId()
  const items = MODE === 'proposed' ? assignmentsForMessage(messageId) : []
  if (items.length === 0) return null
  return (
    <section aria-label="Assignments made in this response" data-response-assignments className="mb-1 ml-1 mt-3 min-w-0 overflow-hidden rounded-xl border border-(--border) bg-(--surface-subtle)/30">
      <Button variant="ghost" className="h-auto w-full justify-start gap-2 rounded-none px-3 py-3 font-normal" aria-expanded={expanded} aria-controls={listId} onClick={() => setExpanded((value) => !value)}>
        <GitBranch size={15} aria-hidden className="shrink-0 text-(--muted)" />
        <span className="min-w-0 flex-1 text-left text-sm">Assignments</span>
        <span className="text-xs text-(--muted)">{summary(items)}</span>
        {expanded ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
      </Button>
      <ul id={listId} hidden={!expanded} className="border-t border-(--border) p-1">
        {items.map((item) => <AssignmentRow key={item.assignmentId} item={item} />)}
      </ul>
    </section>
  )
}

function jumpTo(messageId: string) {
  document.querySelector(`[data-room-message="${messageId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

/** Proposed: every assignment made in this conversation, newest first. */
function AssignmentList({ conversationId }: { conversationId: string | null }) {
  const items = conversationId ? assignmentsForConversation(conversationId).slice().reverse() : []
  if (items.length === 0) return <p className="px-1 py-6 text-center text-xs text-(--muted)">No assignments in this conversation yet.</p>
  // One group per response, so the list reads in the order the work was handed out.
  const responses = [...new Set(items.map((item) => item.messageId))]
  return (
    <div>
      <p className="px-3 pb-1 text-xs text-(--muted)">{summary(items)}</p>
      {responses.map((messageId) => {
        const group = items.filter((item) => item.messageId === messageId)
        return (
          <section key={messageId} className="mt-3">
            <div className="flex items-center justify-between pl-3">
              <span className="text-[11px] text-(--muted-light)">Assigned {group[0]!.when}</span>
              <Button variant="ghost" size="xs" onClick={() => jumpTo(messageId)} className="h-6 px-2 text-[11px] font-normal text-(--muted)">Show in conversation</Button>
            </div>
            <ul className="-mx-1">{group.map((item) => <AssignmentRow key={item.assignmentId} item={item} />)}</ul>
          </section>
        )
      })}
    </div>
  )
}

/** The Assignments view of an agent thread's sidebar. */
export function assignmentsTab(conversationId: string, selectedTab: string) {
  if (MODE !== 'proposed') return []
  return [{ id: 'assignments', label: 'Assignments', content: selectedTab === 'assignments' ? <AssignmentList conversationId={conversationId} /> : null }]
}

// Proposed: one tabbed right sidebar for agent threads, chats and channels. "+" opens a new tab that lists the views
// this conversation has; each view opens as its own tab.

type Scope = 'agent' | 'room'
type SidebarView = { id: string; label: string; content: ReactNode; flush?: boolean }
const VIEW_ICONS: Record<string, LucideIcon> = { details: Info, assignments: GitBranch, library: Folder, computer: Monitor, people: UsersRound, pinned: Pin }
const NEW_TAB = 'new'
const sidebars: Record<Scope, { open: string[]; active: string }> = {
  agent: { open: [], active: NEW_TAB },
  room: { open: ['assignments'], active: 'assignments' },
}
const sidebarListeners = new Set<() => void>()
let sidebarVersion = 0
function updateSidebar(scope: Scope, next: { open: string[]; active: string }) {
  sidebars[scope] = next
  sidebarVersion += 1
  sidebarListeners.forEach((listener) => listener())
}
function useSidebar(scope: Scope) {
  useSyncExternalStore((listener) => { sidebarListeners.add(listener); return () => { sidebarListeners.delete(listener) } }, () => sidebarVersion)
  return sidebars[scope]
}

/** Which view the agent sidebar shows; today that is the production tab. */
export function useAgentSidebarView(productionTab: string) {
  const { active } = useSidebar('agent')
  return MODE === 'proposed' ? active : productionTab
}

function ViewPicker({ views, counts, search, onPick }: { views: SidebarView[]; counts: Record<string, number | undefined>; search: boolean; onPick(id: string): void }) {
  const [query, setQuery] = useState('')
  const matches = views.filter((view) => view.label.toLowerCase().includes(query.trim().toLowerCase()))
  return (
    <div className="px-3 pb-6">
      <div className="relative" hidden={!search}>
        <Search size={13} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-(--muted)" />
        <Input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search views" aria-label="Search views" className="h-9 pl-8 text-[13px]" />
      </div>
      <ul className="mt-2">
        {matches.map((view) => {
          const Icon = VIEW_ICONS[view.id] ?? Info
          return (
            <li key={view.id}>
              <Button variant="ghost" onClick={() => onPick(view.id)} className="h-9 w-full justify-start gap-2.5 rounded-lg px-3 text-[13px] font-normal">
                <Icon size={14} strokeWidth={1.75} aria-hidden className="shrink-0 text-(--muted)" />
                <span className="min-w-0 flex-1 truncate text-left">{view.label}</span>
                {counts[view.id] !== undefined ? <span className="text-xs text-(--muted)">{counts[view.id]}</span> : null}
              </Button>
            </li>
          )
        })}
        {matches.length === 0 ? <li className="px-3 py-4 text-xs text-(--muted)">No views match.</li> : null}
      </ul>
    </div>
  )
}

export function TabbedRightSidebar({ scope, ariaLabel, hero, tabs, counts = {}, activeTab, onTabChange, onClose }: {
  scope: Scope
  ariaLabel: string
  hero?: { avatar: ReactNode; title: ReactNode; titleText: string; subtitle?: ReactNode }
  tabs: SidebarView[]
  counts?: Record<string, number | undefined>
  activeTab?: string
  onTabChange?(id: string): void
  onClose?(): void
}) {
  const state = useSidebar(scope)
  if (MODE !== 'proposed' && hero) return <RightSidebar ariaLabel={ariaLabel} hero={hero} tabs={tabs} activeTab={activeTab ?? 'details'} onTabChange={onTabChange ?? (() => {})} onClose={onClose} />
  const open = state.open.filter((id) => tabs.some((tab) => tab.id === id))
  const active = state.active === NEW_TAB || open.includes(state.active) ? state.active : open[0] ?? NEW_TAB
  const view = tabs.find((tab) => tab.id === active)
  const pick = (id: string) => updateSidebar(scope, { open: open.includes(id) ? open : [...open, id], active: id })
  const close = (id: string) => {
    const rest = open.filter((entry) => entry !== id)
    updateSidebar(scope, { open: rest, active: active === id ? rest[Math.max(0, open.indexOf(id) - 1)] ?? NEW_TAB : active })
  }
  const pill = (selected: boolean) => `group/tab h-7 shrink-0 gap-1.5 rounded-md px-2 text-xs font-normal ${selected ? 'bg-(--surface-subtle) text-(--foreground) hover:bg-(--surface-subtle)' : 'text-(--muted)'}`
  const allCounts = { assignments: conversationCount(), ...counts }
  // An agent's sidebar opens on its avatar and the list of views; opening a view replaces both with the tab.
  const home = Boolean(hero) && open.length === 0
  return (
    <aside data-slot="right-sidebar" aria-label={ariaLabel} className="relative flex h-full min-h-0 w-full flex-col overflow-hidden border-l border-(--border) bg-(--sidebar-surface)">
      {home && hero ? (
        <div className="flex shrink-0 flex-col items-center px-5 pb-4 pt-9 text-center">
          <div className="flex h-[72px] w-[72px] items-center justify-center">{hero.avatar}</div>
          <h2 aria-label={hero.titleText} className="mt-[14px] max-w-full text-lg font-medium leading-6 text-(--foreground)">{hero.title}</h2>
          {hero.subtitle ? <div className="mt-0.5 max-w-full text-[13px] leading-5 text-(--muted)">{hero.subtitle}</div> : null}
        </div>
      ) : null}
      {onClose ? (
        <Button variant="ghost" size="icon" type="button" aria-label="Close" onClick={onClose} className="absolute right-2 top-2 z-10 h-8 w-8 text-(--muted) hover:text-(--foreground)"><X size={16} /></Button>
      ) : null}
      <div role="tablist" aria-label="Open views" hidden={home} className="flex shrink-0 items-center gap-1 overflow-x-auto px-3 pb-3 pr-11 pt-2.5 [scrollbar-width:none]">
        {open.map((id) => {
          const tab = tabs.find((entry) => entry.id === id)!
          const Icon = VIEW_ICONS[id] ?? Info
          return (
            <span key={id} className="relative flex shrink-0 items-center">
              <Button variant="ghost" role="tab" aria-selected={active === id} onClick={() => pick(id)} className={`${pill(active === id)} ${active === id ? 'pr-6' : ''}`}>
                <Icon size={13} strokeWidth={1.75} aria-hidden />{tab.label}
              </Button>
              {active === id ? (
                <Button variant="ghost" size="icon" aria-label={`Close ${tab.label}`} onClick={() => close(id)} className="absolute right-1 h-4 w-4 rounded text-(--muted) hover:text-(--foreground)"><X size={11} /></Button>
              ) : null}
            </span>
          )
        })}
        {active === NEW_TAB ? <span className={`inline-flex items-center ${pill(true)}`}><Search size={13} strokeWidth={1.75} aria-hidden />New tab</span> : null}
        <Button variant="ghost" size="icon" aria-label="New tab" title="New tab" onClick={() => updateSidebar(scope, { open, active: NEW_TAB })} className="h-7 w-7 shrink-0 rounded-md text-(--muted) hover:text-(--foreground)"><Plus size={14} /></Button>
      </div>
      <div data-tabbed-view className={`flex min-h-0 flex-1 flex-col overflow-y-auto ${view && !view.flush ? 'px-5 pb-6' : ''}`}>
        {view ? view.content : <ViewPicker views={tabs} counts={allCounts} search={!home} onPick={pick} />}
      </div>
    </aside>
  )
}

function conversationCount() {
  const conversationId = conversationInHref(currentHref())
  return conversationId ? assignmentsForConversation(conversationId).length : 0
}

/** Chats and channels: the same sidebar, with the views a room has. People and Pinned are the production panels. */
export function RoomTabbedSidebar({ people, pinned, counts, onClose }: { people: ReactNode; pinned: ReactNode; counts: Record<string, number>; onClose(): void }) {
  const conversationId = conversationInHref(useHref())
  return (
    <TabbedRightSidebar scope="room" ariaLabel="Conversation sidebar" counts={counts} onClose={onClose} tabs={[
      { id: 'assignments', label: 'Assignments', content: <AssignmentList conversationId={conversationId} /> },
      { id: 'people', label: 'People', content: people, flush: true },
      { id: 'pinned', label: 'Pinned', content: pinned, flush: true },
    ]} />
  )
}

/** One button opens the sidebar; it replaces the separate People button. An agent thread already has this button. */
export function RoomSidebarToggle({ roomPanel, setRoomPanel, peopleCount }: { roomPanel: string | null; setRoomPanel(next: (current: string | null) => string | null): void; peopleCount: number }) {
  const agentThread = useHref().includes('/agents')
  if (MODE === 'proposed') {
    return agentThread ? null : <RightSidebarToggle open={roomPanel === 'sidebar'} onToggle={() => setRoomPanel((current) => (current === 'sidebar' ? null : 'sidebar'))} />
  }
  return (
    <Button variant="ghost" type="button" title="People in this room" aria-pressed={roomPanel === 'people'}
      onClick={() => setRoomPanel((current) => (current === 'people' ? null : 'people'))}
      className={`h-8 gap-1.5 rounded-md px-2 text-xs font-normal transition-colors hover:bg-(--surface-subtle) hover:text-(--foreground) ${roomPanel === 'people' ? 'bg-(--surface-subtle) text-(--foreground)' : 'text-(--muted)'}`}>
      <UsersRound size={14} />{peopleCount}
    </Button>
  )
}

// The bar around the app: which conversation, today or proposed, and what the proposal changes.

const SCENES: Array<[string, string]> = [
  ['Agent thread', `/app/agents?agent=agent_overlay&id=${CHIEF_THREAD_ID}&scope=workspace`],
  ['Channel', `/app/chat?view=channels&id=${CHANNEL_ID}&scope=workspace`],
  ['Chat', `/app/chat?view=dms&id=${DM_ID}&scope=workspace`],
]

const MESSAGES: Array<[string, string, string]> = [
  [
    'A delegated agent uses a model that is paid for differently from the Chief (for example the Chief runs on Overlay credits and the agent on your own key).',
    'The agent never starts: "The model does not match this harness spending mode."',
    'The agent starts and pays for its own model the way that model is paid for. No message.',
  ],
  [
    'A delegated agent cannot run at all (its key is not connected, its model was removed, or the workspace is out of credits).',
    'The whole Chief thread stops: "Overlay hit an internal error and stopped this task. … Diagnostic ID: hd_…"',
    'Only that assignment is marked "Failed", with the reason and what to do. The Chief is told, says so in its reply and carries on.',
  ],
  [
    'An agent is created or edited with a model Overlay does not offer.',
    'Saved, then fails later: "This task no longer has the authorization it needs."',
    'Refused when saving, naming a model that works. Already on this branch.',
  ],
  [
    'A running thread loses its model.',
    '"This task no longer has the authorization it needs."',
    '"The selected model can no longer run this task. Choose another model and send your message again." Already on this branch.',
  ],
]

function Notes({ onClose }: { onClose(): void }) {
  const item = (title: string, body: ReactNode) => <li className="text-[13px] leading-5"><span className="font-medium text-(--foreground)">{title}</span> <span className="text-(--muted)">{body}</span></li>
  return (
    <div role="dialog" aria-label="What this mockup proposes" className="fixed right-3 top-12 z-50 max-h-[calc(100vh-64px)] w-[min(560px,calc(100vw-24px))] overflow-y-auto rounded-xl border border-(--border) bg-(--surface-elevated) p-5 text-(--foreground) shadow-lg">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">What this mockup proposes</h2>
        <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose} className="h-7 w-7 text-(--muted)"><X size={14} /></Button>
      </div>
      <h3 className="mt-4 text-xs text-(--muted)">Assignments</h3>
      <ol className="mt-2 list-decimal space-y-2 pl-5">
        {item('They stay in the response that made them.', 'The box no longer follows the bottom of the conversation; newer messages appear below it.')}
        {item('The box is as wide as the response text.', 'Its left edge lines up with the text, not with the agent icon.')}
        {item('Every assignment is listed in the right sidebar.', 'Assignments is a view in the sidebar of agent threads, chats and channels. "Show in conversation" scrolls to the response.')}
      </ol>
      <h3 className="mt-5 text-xs text-(--muted)">Right sidebar</h3>
      <ol start={4} className="mt-2 list-decimal space-y-2 pl-5">
        {item('One button opens it everywhere.', 'Chats and channels get the same sidebar button as agent threads; the separate People button goes away.')}
        {item('Views open as tabs.', '"+" opens a new tab that lists what this conversation has: Details, Assignments, Library and Computer for an agent; Assignments, People and Pinned for a chat or channel.')}
        {item('An agent sidebar opens on its avatar.', 'With no tabs open it shows the avatar, name, role and the list of views. Opening a view replaces all of that with the tab; closing the last tab brings it back.')}
      </ol>
      <h3 className="mt-5 text-xs text-(--muted)">Fixes</h3>
      <ol start={7} className="mt-2 list-decimal space-y-2 pl-5">
        {item('A delegated agent pays for its own model.', 'It no longer inherits how the Chief pays, which is what stopped new agents before they started.')}
        {item('One failed assignment does not stop the Chief.', 'The assignment shows why it did not finish, the Chief reports it and keeps working, and any credits reserved for it are released.')}
      </ol>
      <h3 className="mt-5 text-xs text-(--muted)">Messages</h3>
      <div className="mt-2 space-y-3">
        {MESSAGES.map(([when, today, proposed]) => (
          <div key={when} className="rounded-lg border border-(--border) p-3 text-xs leading-5">
            <p className="text-(--foreground)">{when}</p>
            <p className="mt-1.5 text-(--muted)"><span className="text-(--foreground)">Today:</span> {today}</p>
            <p className="mt-1 text-(--muted)"><span className="text-(--foreground)">Proposed:</span> {proposed}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function Segments<T extends string>({ label, value, options, onChange }: { label: string; value: T | null; options: Array<[T, string]>; onChange(next: T): void }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg bg-(--surface-subtle) p-0.5">
      {options.map(([option, text]) => (
        <Button key={option} variant="ghost" size="xs" role="radio" aria-checked={value === option} onClick={() => onChange(option)}
          className={`h-6 rounded-md px-2 text-[11px] font-normal ${value === option ? 'bg-(--surface-elevated) text-(--foreground) shadow-xs hover:bg-(--surface-elevated)' : 'text-(--muted)'}`}>
          {text}
        </Button>
      ))}
    </div>
  )
}

function MockupBar() {
  const href = useHref()
  const [notes, setNotes] = useState(false)
  const scene = SCENES.find(([, target]) => href.includes(target.split('id=')[1]!.split('&')[0]!))?.[1] ?? null
  return (
    <>
      <div className="fixed inset-x-0 top-0 z-40 flex h-10 items-center gap-2 overflow-x-auto bg-background px-3 text-(--muted)">
        <span className="shrink-0 text-[11px] max-md:hidden">Chief assignments</span>
        <span className="flex-1" />
        <Segments label="Conversation" value={scene} options={SCENES.map(([text, target]) => [target, text])} onChange={(target) => navigate(target)} />
        <Segments<Mode> label="Version" value={MODE} options={[['today', 'Today'], ['proposed', 'Proposed']]} onChange={switchMode} />
        <Button variant="ghost" size="xs" aria-pressed={notes} onClick={() => setNotes((value) => !value)} className="h-6 shrink-0 gap-1.5 px-2 text-[11px] font-normal text-(--muted)">
          <Info size={12} strokeWidth={1.75} />What changes
        </Button>
      </div>
      {notes ? <Notes onClose={() => setNotes(false)} /> : null}
    </>
  )
}

export function mountMockupBar() {
  document.documentElement.dataset.mockupHost = 'bar'
  const style = document.createElement('style')
  style.textContent = 'html[data-mockup-host] [data-app-shell]{height:calc(100vh - 40px)!important;margin-top:40px}[data-tabbed-view]>section>:first-child:not(:last-child){display:none}'
  document.head.append(style)
  const node = document.createElement('div')
  document.body.append(node)
  createRoot(node).render(<MockupBar />)
}
