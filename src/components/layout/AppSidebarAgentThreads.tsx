'use client'

import { useState, type ComponentProps } from 'react'
import { Archive, CloudOff, Workflow } from 'lucide-react'
import { isPrivateThreadId } from '@/shared/agents/private-threads'
import type { WorkspaceAgentBundle, WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import { ThreadActivityIndicator } from './sidebar/ThreadActivityIndicator'
import { ThreadPullRequests } from './sidebar/ThreadPullRequests'
import { hasThreadActivity, THREAD_ACTIVITY_LABELS, type ThreadActivity } from '@/shared/agents/thread-activity'
import { useTranscriptPrefetchIntent } from '@/components/providers/transcript-cache-client'
import {
  SidebarMenuAction,
  SidebarMenuSkeleton,
  SidebarMenu,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from '@overlay/ui/primitives'

/** An agent shows this many threads at first; "Load more" shows this many more each time. */
export const AGENT_THREAD_PAGE = 5

function ThreadButton({ children, className, ...props }: ComponentProps<typeof SidebarMenuSubButton>) {
  return <SidebarMenuSubButton className={`font-normal data-[active=true]:font-normal [&>svg]:mx-1 ${className ?? ''}`} {...props}>{children}</SidebarMenuSubButton>
}

export function AgentThreadRows({
  agent,
  bundle,
  activeConversationId,
  activity,
  activityOnly = false,
  onOpenThread,
  onOpenAutomation,
  onArchiveThread,
}: {
  agent: WorkspaceAgentDirectoryItem
  bundle: WorkspaceAgentBundle | 'loading' | 'error'
  activeConversationId: string | null
  activity?: ThreadActivity[]
  activityOnly?: boolean
  onOpenThread(agent: WorkspaceAgentDirectoryItem, conversationId: string): void
  onOpenAutomation(automationId: string): void
  onArchiveThread(agent: WorkspaceAgentDirectoryItem, conversationId: string, archived: boolean): void
}) {
  const prefetch = useTranscriptPrefetchIntent()
  const [limit, setLimit] = useState(AGENT_THREAD_PAGE)
  if (bundle === 'loading') {
    return (
      <SidebarMenu className="agent-thread-tree mb-2.5" aria-label={`Loading ${agent.name} threads`}>
        {[0, 1, 2].map((index) => (
          <SidebarMenuSubItem key={index}>
            <SidebarMenuSkeleton index={index} className="h-7 px-2" />
          </SidebarMenuSubItem>
        ))}
      </SidebarMenu>
    )
  }
  if (bundle === 'error') {
    return (
      <SidebarMenu className="agent-thread-tree mb-2.5">
        <SidebarMenuSubItem>
          <p className="px-2 py-1.5 text-xs text-(--muted-light)">Could not load threads</p>
        </SidebarMenuSubItem>
      </SidebarMenu>
    )
  }
  const statuses = new Map(activity?.map(item => [item.conversationId, item.status]))
  const threads = bundle.threads.filter((thread) => !thread.archivedAt && (!activityOnly || (statuses.has(thread.conversationId) && hasThreadActivity(statuses.get(thread.conversationId)!))))
  // An automation is listed as its thread. Only an automation whose thread
  // is not among the agent's threads yet (bound on its next run) keeps its own row.
  const threadIds = new Set(bundle.threads.map((thread) => thread.conversationId))
  const unbound = bundle.automations.filter((automation) => !automation.conversationId || !threadIds.has(automation.conversationId))
  const automations = activityOnly ? [] : unbound
  // At most `limit` rows, threads first. The open thread stays listed even when it is further down.
  const shownThreads = threads.filter((thread, index) => index < limit || thread.conversationId === activeConversationId)
  const shownAutomations = automations.slice(0, Math.max(0, limit - threads.length))
  const hasMore = threads.length + automations.length > limit
  return (
    <SidebarMenu className="agent-thread-tree mb-2.5" aria-label={`${agent.name} threads`}>
      {shownThreads.map((thread) => {
        const active = activeConversationId === thread.conversationId
        // A private thread lives only on this computer: no prefetch, and it is deleted from its own menu, not archived.
        const isPrivate = isPrivateThreadId(thread.conversationId)
        // Idle and reviewed threads are plain rows: no icon, and no status in their label.
        const raw = statuses.get(thread.conversationId)
        const status = raw === 'idle' || raw === 'completed' ? undefined : raw
        return (
          <SidebarMenuSubItem key={thread.conversationId} className="flex items-center">
            <ThreadButton
              isActive={active}
              aria-current={active ? 'page' : undefined}
              aria-label={status ? `${thread.title}, ${THREAD_ACTIVITY_LABELS[status]}` : thread.title}
              title={status ? `${thread.title} · ${THREAD_ACTIVITY_LABELS[status]}` : thread.title}
              onClick={() => onOpenThread(agent, thread.conversationId)}
              onPointerEnter={() => { if (!active && !isPrivate) prefetch.intend({ kind: 'room', conversationId: thread.conversationId }) }}
              onPointerLeave={prefetch.cancel}
              onFocus={() => { if (!active && !isPrivate) prefetch.intend({ kind: 'room', conversationId: thread.conversationId }) }}
              onBlur={prefetch.cancel}
              className={`agent-thread-button min-w-0 flex-1 gap-[7px] ${thread.pullRequests?.length ? 'pr-1' : 'pr-8'}`}
            >
              <span className="agent-thread-icon"><ThreadActivityIndicator status={status} /></span>
              <span className="flex-1 truncate">{thread.title}</span>
              {isPrivate ? <CloudOff size={12} strokeWidth={1.75} aria-label="Not synced" className="shrink-0 text-(--muted-light)" /> : null}
            </ThreadButton>
            {thread.pullRequests?.length ? <div className="mr-8 shrink-0">
              <ThreadPullRequests pullRequests={thread.pullRequests} />
            </div> : null}
            {isPrivate ? null : <SidebarMenuAction
              aria-label="Archive thread"
              title="Archive thread"
              // Shown by hovering or focusing this thread only, not the agent that contains it.
              className="right-1 top-1 md:opacity-0 group-hover/menu-sub-item:opacity-100 group-focus-within/menu-sub-item:opacity-100"
              onClick={(event) => {
                event.stopPropagation()
                onArchiveThread(agent, thread.conversationId, true)
              }}
            >
              <Archive aria-hidden />
            </SidebarMenuAction>}
          </SidebarMenuSubItem>
        )
      })}
      {shownAutomations.map((automation) => {
        const target = automation.conversationId
        const active = target != null && activeConversationId === target
        return (
          <SidebarMenuSubItem key={automation.automationId}>
            <ThreadButton
              isActive={active}
              onClick={() => {
                if (target) onOpenThread(agent, target)
                else onOpenAutomation(automation.automationId)
              }}
            >
              <span className="agent-thread-icon"><Workflow size={14} aria-hidden /></span>
              <span className="flex-1 truncate">{automation.name}</span>
              {!automation.enabled ? <span className="text-[10px] text-(--muted-light)">Paused</span> : null}
            </ThreadButton>
          </SidebarMenuSubItem>
        )
      })}
      {hasMore ? (
        <SidebarMenuSubItem>
          {/* Laid out like a thread row, with an empty icon slot, so the label lines up with the thread titles. */}
          <ThreadButton onClick={() => setLimit((current) => current + AGENT_THREAD_PAGE)}
            className="agent-thread-button gap-[7px] text-xs text-(--muted-light) hover:text-(--foreground)">
            <span className="agent-thread-icon" aria-hidden />
            <span className="flex-1 truncate">Load more</span>
          </ThreadButton>
        </SidebarMenuSubItem>
      ) : null}
    </SidebarMenu>
  )
}
