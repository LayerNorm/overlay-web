import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import Link from 'next/link'
import { ArrowUpRight, Check, CircleAlert, CircleHelp, GitBranch, LoaderCircle, type LucideIcon } from 'lucide-react'
import { Button } from '@overlay/ui/primitives'
import {
  Trace, TraceCollapsible, TraceCollapsibleContent, TraceCollapsibleTrigger, TraceIcon, TraceLine, TraceTitle,
} from '@overlay/ui/ai'
import { AgentAssignments } from '@/features/chat/components/AgentAssignments'
import { navigate, useHref } from '../../shims/router'
import { CHANNEL_ID, CHIEF_THREAD_ID, DM_ID, assignmentsForMessage, type Assignment } from '../chief-assignments/model'

/** "box" shows today's assignment box for comparison; the default is the proposed dropdown. */
type Version = 'dropdown' | 'box'
const VERSION: Version = new URLSearchParams(globalThis.location?.search ?? '').get('version') === 'box' ? 'box' : 'dropdown'

const STATUS: Record<Assignment['status'], { label: string; icon: LucideIcon; spin?: boolean }> = {
  running: { label: 'Working', icon: LoaderCircle, spin: true },
  completed: { label: 'Completed', icon: Check },
  failed: { label: 'Failed', icon: CircleAlert },
  waiting_for_input: { label: 'Needs input', icon: CircleHelp },
}
const threadHref = (item: Assignment) => (item.agentId && item.threadId ? `/app/agents?agent=${item.agentId}&id=${item.threadId}&scope=workspace` : '#')

/** "Assigned 3 tasks · 2 completed · 1 working", counting only the states present. */
function summary(items: Assignment[]) {
  const counts = (['completed', 'running', 'waiting_for_input', 'failed'] as const)
    .map((status) => [items.filter((item) => item.status === status).length, STATUS[status].label.toLowerCase()] as const)
    .filter(([count]) => count > 0)
    .map(([count, label]) => `${count} ${label}`)
  return [`Assigned ${items.length} task${items.length === 1 ? '' : 's'}`, ...counts].join(' · ')
}

function AssignmentLine({ item }: { item: Assignment }) {
  const { label, icon: Icon, spin } = STATUS[item.status]
  return (
    <div className="min-w-0">
      <Link href={threadHref(item)} className="group/assignment block w-fit max-w-full rounded-lg py-0.5">
        <TraceLine status={item.status === 'failed' ? 'error' : undefined}>
          <TraceIcon><Icon className={spin ? 'animate-spin motion-reduce:animate-none' : undefined} strokeWidth={1.75} /></TraceIcon>
          <TraceTitle>{item.agentName}: {item.title}</TraceTitle>
          <span className="shrink-0 text-(--muted-light)">{label}</span>
          <TraceIcon className="opacity-0 transition-opacity group-hover/assignment:opacity-100 group-focus-visible/assignment:opacity-100">
            <ArrowUpRight />
          </TraceIcon>
        </TraceLine>
      </Link>
      {item.reason ? <p className="pb-1 pl-[calc(1rem+0.4em)] text-[12px] leading-5 text-(--muted)">{item.reason}</p> : null}
    </div>
  )
}

/** Proposed: the assignments a response made, as one collapsed row like the tool-call rows. */
export function AssignmentDropdown({ messageId }: { messageId: string }) {
  const [open, setOpen] = useState(false)
  const items = assignmentsForMessage(messageId)
  if (items.length === 0) return null
  if (VERSION === 'box') {
    return <AgentAssignments parent={null} className="mb-1 ml-1 mt-3" assignments={items.map((item) => ({
      assignmentId: item.assignmentId, title: item.title, agentName: item.agentName, status: item.status,
      failureReason: item.reason, href: threadHref(item),
    }))} />
  }
  const working = items.some((item) => item.status === 'running')
  return (
    <Trace className="mt-2 px-1 py-0.5" data-response-assignments>
      <TraceCollapsible open={open} onOpenChange={setOpen}>
        <TraceCollapsibleTrigger className="py-1 text-[13px] leading-5">
          <TraceLine status={working ? 'running' : undefined}>
            <TraceIcon><GitBranch strokeWidth={1.75} /></TraceIcon>
            <TraceTitle>{summary(items)}</TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent className="ml-0 pl-0">
          <Trace className="gap-0.5 pt-0.5">{items.map((item) => <AssignmentLine key={item.assignmentId} item={item} />)}</Trace>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  )
}

const SCENES: Array<[string, string]> = [
  ['Agent thread', `/app/agents?agent=agent_overlay&id=${CHIEF_THREAD_ID}&scope=workspace`],
  ['Channel', `/app/chat?view=channels&id=${CHANNEL_ID}&scope=workspace`],
  ['Chat', `/app/chat?view=dms&id=${DM_ID}&scope=workspace`],
]

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

function switchVersion(version: Version) {
  const query = new URLSearchParams(globalThis.location.search)
  if (version === 'box') query.set('version', 'box')
  else query.delete('version')
  const search = query.toString()
  globalThis.location.href = `${globalThis.location.pathname}${search ? `?${search}` : ''}${globalThis.location.hash}`
}

function MockupBar() {
  const href = useHref()
  const scene = SCENES.find(([, target]) => href.includes(target.split('id=')[1]!.split('&')[0]!))?.[1] ?? null
  return (
    <div className="fixed inset-x-0 top-0 z-40 flex h-10 items-center gap-2 overflow-x-auto bg-background px-3 text-(--muted)">
      <span className="shrink-0 text-[11px] max-md:hidden">Assignment dropdown</span>
      <span className="flex-1" />
      <Segments label="Conversation" value={scene} options={SCENES.map(([text, target]) => [target, text])} onChange={(target) => navigate(target)} />
      <Segments<Version> label="Version" value={VERSION} options={[['box', 'Today'], ['dropdown', 'Proposed']]} onChange={switchVersion} />
    </div>
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
  if (!globalThis.location.hash) navigate(SCENES[0]![1])
}
