'use client'

import type { ComponentProps } from 'react'
import { MessageSquare, Archive, Trash2, Workflow } from 'lucide-react'
import type { WorkspaceAgentBundle, WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
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

/** Threads share the agent's icon column without a guide line or extra indentation. */
export function AgentThreadRows({
  agent,
  bundle,
  activeConversationId,
  onOpenThread,
  onOpenAutomation,
  onArchiveThread,
  onDeleteThread,
}: {
  agent: WorkspaceAgentDirectoryItem
  bundle: WorkspaceAgentBundle | 'loading' | 'error'
  activeConversationId: string | null
  onOpenThread(agent: WorkspaceAgentDirectoryItem, conversationId: string): void
  onOpenAutomation(automationId: string): void
  onArchiveThread(agent: WorkspaceAgentDirectoryItem, conversationId: string, archived: boolean): void
  onDeleteThread(agent: WorkspaceAgentDirectoryItem, conversationId: string): void
}) {
  if (bundle === 'loading') {
    return (
      <SidebarMenu className="mb-2.5" aria-label={`Loading ${agent.name} threads`}>
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
      <SidebarMenu className="mb-2.5">
        <SidebarMenuSubItem>
          <p className="px-2 py-1.5 text-xs text-(--muted-light)">Could not load threads</p>
        </SidebarMenuSubItem>
      </SidebarMenu>
    )
  }
  const threads = bundle.threads.filter((thread) => !thread.archivedAt)
  const automations = bundle.automations
  return (
    <SidebarMenu className="mb-2.5" aria-label={`${agent.name} threads`}>
      {threads.map((thread) => {
        const active = activeConversationId === thread.conversationId
        return (
          <SidebarMenuSubItem key={thread.conversationId}>
            <ThreadButton
              isActive={active}
              aria-current={active ? 'page' : undefined}
              onClick={() => onOpenThread(agent, thread.conversationId)}
              className="pr-14"
            >
              <MessageSquare aria-hidden />
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
