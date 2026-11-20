'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import { AgentCreature } from '@/components/orb/Creature'
import {
  Trace, TraceCollapsible, TraceCollapsibleContent, TraceCollapsibleTrigger, TraceIcon, TraceLine, TraceTitle,
} from '@overlay/ui/ai'
import type { ThreadActivityStatus } from '@/shared/agents/thread-activity'
import { assignmentActivityStatus, type AssignmentNavigationItem } from './AgentAssignments'

type AssignmentState = Exclude<ThreadActivityStatus, 'ready'>

const STATES: Record<AssignmentState, { label: string }> = {
  working: { label: 'Working' },
  needs_input: { label: 'Needs you' },
  completed: { label: 'Completed' },
  failed: { label: 'Failed' },
  cancelled: { label: 'Cancelled' },
  idle: { label: 'Waiting' },
}

/** How many assigned agents the collapsed row shows before "+N". */
const MAX_AVATARS = 3

function AssignedAgent({ item, size = 16, working = false }: { item: AssignmentNavigationItem; size?: number; working?: boolean }) {
  return (
    <AgentCreature
      agent={{ name: item.agentName, avatarColor: item.agent?.avatarColor, avatarShape: item.agent?.avatarShape }}
      isDefault={item.agent?.isDefault ?? false}
      size={size}
      working={working}
    />
  )
}

/** The agents a response handed work to, once each, overlapping like a group DM's avatars. */
function AssignedAgents({ items }: { items: readonly AssignmentNavigationItem[] }) {
  const agents = [...new Map(items.map((item) => [item.agentName, item])).values()]
  const extra = agents.length - MAX_AVATARS
  return (
    <span className="flex shrink-0 items-center" aria-hidden>
      {agents.slice(0, MAX_AVATARS).map((item, index) => (
        <span key={item.agentName} className={`flex rounded-full bg-(--background) ring-2 ring-(--background) ${index > 0 ? '-ml-1.5' : ''}`}>
          <AssignedAgent item={item} />
        </span>
      ))}
      {extra > 0 ? <span className="ml-1 text-[11px] text-(--muted-light)">+{extra}</span> : null}
    </span>
  )
}

const stateOf = (item: AssignmentNavigationItem): AssignmentState => {
  const status = assignmentActivityStatus(item.status)
  return status === 'ready' ? 'completed' : status
}

/** "Assigned 3 tasks · 2 completed · 1 working", counting only the states present. */
export function assignmentTraceSummary(items: readonly AssignmentNavigationItem[]) {
  const states = items.map(stateOf)
  const counts = (['completed', 'working', 'needs_input', 'failed', 'cancelled', 'idle'] as const)
    .map((state) => [states.filter((value) => value === state).length, STATES[state].label.toLowerCase()] as const)
    .filter(([count]) => count > 0)
    .map(([count, label]) => `${count} ${label}`)
  return [`Assigned ${items.length} task${items.length === 1 ? '' : 's'}`, ...counts].join(' · ')
}

/** One assignment: its state, agent and task, linking to its thread; a failure shows its reason underneath. */
export function AssignmentTraceLine({ item }: { item: AssignmentNavigationItem }) {
  const state = stateOf(item)
  const { label } = STATES[state]
  const reason = item.disposition === 'excluded' ? `Excluded: ${item.dispositionReason}`
    : state === 'failed' || state === 'cancelled' ? item.failureReason : undefined
  return (
    <div className="min-w-0">
      <Link href={item.href} className="group/assignment block w-fit max-w-full rounded-lg py-0.5 outline-none focus-visible:ring-3 focus-visible:ring-(--foreground)/15">
        <TraceLine status={state === 'failed' ? 'error' : undefined}>
          <span className="flex shrink-0"><AssignedAgent item={item} working={state === 'working'} /></span>
          <TraceTitle title={item.title}>{item.agentName}: {item.title}</TraceTitle>
          <span className="shrink-0 text-(--muted-light)">{label}</span>
          <TraceIcon className="opacity-0 transition-opacity group-hover/assignment:opacity-100 group-focus-visible/assignment:opacity-100">
            <ArrowUpRight />
          </TraceIcon>
        </TraceLine>
      </Link>
      {reason ? <p className="pb-1 pl-[calc(1rem+0.4em)] text-[12px] leading-5 text-(--muted)">{reason}</p> : null}
    </div>
  )
}

/** The assignments one response made, as a collapsed row like the tool-call and "Worked for" rows. */
export function AssignmentTrace({ items }: { items: readonly AssignmentNavigationItem[] }) {
  const [open, setOpen] = useState(false)
  if (items.length === 0) return null
  const working = items.some((item) => stateOf(item) === 'working')
  return (
    <Trace className="mb-2 px-1 py-0.5" data-response-assignments>
      <TraceCollapsible open={open} onOpenChange={setOpen}>
        <TraceCollapsibleTrigger className="py-1 text-[13px] leading-5">
          <TraceLine status={working ? 'running' : undefined}>
            <AssignedAgents items={items} />
            <TraceTitle>{assignmentTraceSummary(items)}</TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent className="ml-0 pl-0">
          <Trace className="gap-0.5 pt-0.5">{items.map((item) => <AssignmentTraceLine key={item.assignmentId} item={item} />)}</Trace>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  )
}
