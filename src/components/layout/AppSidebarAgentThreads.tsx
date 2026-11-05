'use client'

import type { ComponentProps } from 'react'
import { Archive, Trash2, Workflow } from 'lucide-react'
import type { WorkspaceAgentBundle, WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import { ThreadActivityIndicator } from './sidebar/ThreadActivityIndicator'
import { THREAD_ACTIVITY_LABELS, type ThreadActivity } from '@/shared/agents/thread-activity'
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
  onOpenThread,
  onOpenAutomation,
  onArchiveThread,
  onDeleteThread,
}: {
  agent: WorkspaceAgentDirectoryItem
  bundle: WorkspaceAgentBundle | 'loading' | 'error'
  activeConversationId: string | null
  activity?: ThreadActivity[]
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
  const threads = bundle.threads.filter((thread) => !thread.archivedAt)
  const statuses = new Map(activity?.map(item => [item.conversationId, item.status]))
  const automations = bundle.automations
  return (
    <SidebarMenu className="agent-thread-tree mb-2.5" aria-label={`${agent.name} threads`}>
      {threads.map((thread) => {
        const active = activeConversationId === thread.conversationId
        const status = statuses.get(thread.conversationId)
        return (
          <SidebarMenuSubItem key={thread.conversationId}>
            <ThreadButton
              isActive={active}
              aria-current={active ? 'page' : undefined}
              aria-label={status ? `${thread.title}, ${THREAD_ACTIVITY_LABELS[status]}` : thread.title}
              title={status ? `${thread.title} · ${THREAD_ACTIVITY_LABELS[status]}` : thread.title}
              onClick={() => onOpenThread(agent, thread.conversationId)}
              className="agent-thread-button gap-[7px] pr-14"
            >
              <ThreadActivityIndicator status={status} />
              <span className="flex-1 truncate">{thread.title}</span>
            </ThreadButton>
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
      {automations.map((automation) => {
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
              <Workflow aria-hidden />
              <span className="flex-1 truncate">{automation.name}</span>
              {!automation.enabled ? <span className="text-[10px] text-(--muted-light)">Paused</span> : null}
            </ThreadButton>
          </SidebarMenuSubItem>
        )
      })}
    </SidebarMenu>
  )
}
