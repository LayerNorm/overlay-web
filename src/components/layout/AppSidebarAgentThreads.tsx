'use client'

import type { ComponentProps } from 'react'
import { Archive, Trash2, Workflow } from 'lucide-react'
import type { WorkspaceAgentBundle, WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import { ThreadActivityIndicator } from './sidebar/ThreadActivityIndicator'
import { ThreadPullRequests } from './sidebar/ThreadPullRequests'
import { hasThreadActivity, THREAD_ACTIVITY_LABELS, type ThreadActivity } from '@/shared/agents/thread-activity'
import {
  SidebarMenuAction,
  SidebarMenuSkeleton,
  SidebarMenu,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from '@overlay/ui/primitives'

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
  onDeleteThread,
}: {
  agent: WorkspaceAgentDirectoryItem
  bundle: WorkspaceAgentBundle | 'loading' | 'error'
  activeConversationId: string | null
  activity?: ThreadActivity[]
  activityOnly?: boolean
  onOpenThread(agent: WorkspaceAgentDirectoryItem, conversationId: string): void
  onOpenAutomation(automationId: string): void
  onArchiveThread(agent: WorkspaceAgentDirectoryItem, conversationId: string, archived: boolean): void
  onDeleteThread(agent: WorkspaceAgentDirectoryItem, conversationId: string): void
}) {
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
  const automations = bundle.automations
  return (
    <SidebarMenu className="agent-thread-tree mb-2.5" aria-label={`${agent.name} threads`}>
      {threads.map((thread) => {
        const active = activeConversationId === thread.conversationId
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
              className={`agent-thread-button min-w-0 flex-1 gap-[7px] ${thread.pullRequests?.length ? 'pr-1' : 'pr-14'}`}
            >
              <span className="agent-thread-icon"><ThreadActivityIndicator status={status} /></span>
              <span className="flex-1 truncate">{thread.title}</span>
            </ThreadButton>
            {thread.pullRequests?.length ? <div className="mr-14 shrink-0">
              <ThreadPullRequests pullRequests={thread.pullRequests} />
            </div> : null}
            <SidebarMenuAction
              aria-label="Archive thread"
              title="Archive thread"
              // Shown by hovering or focusing this thread only, not the agent that contains it.
              className="right-7 top-1 md:opacity-0 group-hover/menu-sub-item:opacity-100 group-focus-within/menu-sub-item:opacity-100"
              onClick={(event) => {
                event.stopPropagation()
                onArchiveThread(agent, thread.conversationId, true)
              }}
            >
              <Archive aria-hidden />
            </SidebarMenuAction>
            <SidebarMenuAction
              aria-label="Delete thread"
              title="Delete thread"
              className="right-1 top-1 md:opacity-0 group-hover/menu-sub-item:opacity-100 group-focus-within/menu-sub-item:opacity-100"
              onClick={(event) => {
                event.stopPropagation()
                onDeleteThread(agent, thread.conversationId)
              }}
            >
              <Trash2 aria-hidden />
            </SidebarMenuAction>
          </SidebarMenuSubItem>
        )
      })}
      {(activityOnly ? [] : automations).map((automation) => {
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
    </SidebarMenu>
  )
}
