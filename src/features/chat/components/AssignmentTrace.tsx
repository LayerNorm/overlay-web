'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowUpRight, Check, Circle, CircleAlert, CircleHelp, CircleSlash, GitBranch, LoaderCircle, type LucideIcon } from 'lucide-react'
import {
  Trace, TraceCollapsible, TraceCollapsibleContent, TraceCollapsibleTrigger, TraceIcon, TraceLine, TraceTitle,
} from '@overlay/ui/ai'
import type { ThreadActivityStatus } from '@/shared/agents/thread-activity'
import { assignmentActivityStatus, type AssignmentNavigationItem } from './AgentAssignments'

type AssignmentState = Exclude<ThreadActivityStatus, 'ready'>

const STATES: Record<AssignmentState, { label: string; icon: LucideIcon }> = {
  working: { label: 'Working', icon: LoaderCircle },
  needs_input: { label: 'Needs you', icon: CircleHelp },
  completed: { label: 'Completed', icon: Check },
  failed: { label: 'Failed', icon: CircleAlert },
  cancelled: { label: 'Cancelled', icon: CircleSlash },
  idle: { label: 'Waiting', icon: Circle },
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
  const { label, icon: Icon } = STATES[state]
  const reason = item.disposition === 'excluded' ? `Excluded: ${item.dispositionReason}`
    : state === 'failed' || state === 'cancelled' ? item.failureReason : undefined
  return (
    <div className="min-w-0">
      <Link href={item.href} className="group/assignment block w-fit max-w-full rounded-lg py-0.5 outline-none focus-visible:ring-3 focus-visible:ring-(--foreground)/15">
        <TraceLine status={state === 'failed' ? 'error' : undefined}>
          <TraceIcon><Icon className={state === 'working' ? 'animate-spin motion-reduce:animate-none' : undefined} strokeWidth={1.75} /></TraceIcon>
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
    <Trace className="mt-2 px-1 py-0.5" data-response-assignments>
      <TraceCollapsible open={open} onOpenChange={setOpen}>
        <TraceCollapsibleTrigger className="py-1 text-[13px] leading-5">
          <TraceLine status={working ? 'running' : undefined}>
            <TraceIcon><GitBranch strokeWidth={1.75} /></TraceIcon>
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
