import { useId, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import Link from 'next/link'
import { ArrowUpRight, Check, ChevronDown, ChevronRight, GitBranch, Info, X } from 'lucide-react'
import { Button } from '@overlay/ui/primitives'
import { AppScreenSidePanel } from '@overlay/modules-react/shell'
import { ThreadActivityIndicator } from '@/components/layout/sidebar/ThreadActivityIndicator'
import type { ThreadActivityStatus } from '@/shared/agents/thread-activity'
import { navigate, useHref } from '../../shims/router'
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

/** The Assignments tab of an agent thread's right panel. */
export function assignmentsTab(conversationId: string, selectedTab: string) {
  if (MODE !== 'proposed') return []
  return [{ id: 'assignments', label: 'Assignments', content: selectedTab === 'assignments' ? <AssignmentList conversationId={conversationId} /> : null }]
}

/** The same list for a chat or a channel, beside People and Pinned. */
export function AssignmentsRoomPanel({ onClose }: { onClose(): void }) {
  const conversationId = conversationInHref(useHref())
  return (
    <AppScreenSidePanel title="Assignments" description="Work the Chief handed out in this conversation" onClose={onClose}>
      <div className="p-3"><AssignmentList conversationId={conversationId} /></div>
    </AppScreenSidePanel>
  )
}

export function AssignmentsPanelButton({ roomPanel, setRoomPanel }: { roomPanel: string | null; setRoomPanel(next: (current: string | null) => string | null): void }) {
  const conversationId = conversationInHref(useHref())
  const count = conversationId && conversationId !== CHIEF_THREAD_ID ? assignmentsForConversation(conversationId).length : 0
  if (MODE !== 'proposed' || count === 0) return null
  return (
    <Button variant="ghost" type="button" title="Assignments in this conversation" aria-pressed={roomPanel === 'assignments'}
      onClick={() => setRoomPanel((current) => (current === 'assignments' ? null : 'assignments'))}
      className={`h-8 gap-1.5 rounded-md px-2 text-xs font-normal transition-colors hover:bg-(--surface-subtle) hover:text-(--foreground) ${roomPanel === 'assignments' ? 'bg-(--surface-subtle) text-(--foreground)' : 'text-(--muted)'}`}>
      <GitBranch size={14} />{count}
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
        {item('Every assignment is listed in the right panel.', 'An Assignments tab in an agent thread, and an Assignments panel in chats and channels. "Show in conversation" scrolls to the response.')}
      </ol>
      <h3 className="mt-5 text-xs text-(--muted)">Fixes</h3>
      <ol start={4} className="mt-2 list-decimal space-y-2 pl-5">
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
  style.textContent = 'html[data-mockup-host] [data-app-shell]{height:calc(100vh - 40px)!important;margin-top:40px}'
  document.head.append(style)
  const node = document.createElement('div')
  document.body.append(node)
  createRoot(node).render(<MockupBar />)
}
