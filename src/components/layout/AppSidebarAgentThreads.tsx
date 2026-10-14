'use client'

import { Loader2, MessageSquare, Plus, Archive, Trash2, Workflow } from 'lucide-react'
import type { WorkspaceAgentBundle, WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import {
  SidebarMenuAction,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from '@overlay/ui/primitives'

/**
 * An agent's threads, automations and "New thread", as the indented tree under its row (shadcn's `SidebarMenuSub`,
 * with the vertical guide line). Archived threads live in Settings → Archived, not here.
 */
export function AgentThreadRows({
  agent,
  bundle,
  activeConversationId,
  onOpenThread,
  onCreateThread,
  onArchiveThread,
  onDeleteThread,
  creatingThread,
}: {
  agent: WorkspaceAgentDirectoryItem
  bundle: WorkspaceAgentBundle | 'loading' | 'error'
  activeConversationId: string | null
  onOpenThread(agent: WorkspaceAgentDirectoryItem, conversationId: string): void
  onCreateThread(agent: WorkspaceAgentDirectoryItem): void
  onArchiveThread(agent: WorkspaceAgentDirectoryItem, conversationId: string, archived: boolean): void
  onDeleteThread(agent: WorkspaceAgentDirectoryItem, conversationId: string): void
  creatingThread: boolean
}) {
  if (bundle === 'loading') {
    return (
      <SidebarMenuSub aria-label={`Loading ${agent.name} threads`}>
        {[0, 1, 2].map((index) => (
          <SidebarMenuSubItem key={index}>
            <SidebarMenuSkeleton index={index} className="h-7 px-2" />
          </SidebarMenuSubItem>
        ))}
      </SidebarMenuSub>
    )
  }
  if (bundle === 'error') {
    return (
      <SidebarMenuSub>
        <SidebarMenuSubItem>
          <p className="px-2 py-1.5 text-xs text-(--muted-light)">Could not load threads</p>
        </SidebarMenuSubItem>
      </SidebarMenuSub>
    )
  }
  const threads = bundle.threads.filter((thread) => !thread.archivedAt)
  const automations = bundle.automations
  return (
    <SidebarMenuSub aria-label={`${agent.name} threads`}>
      {threads.map((thread) => {
        const active = activeConversationId === thread.conversationId
        return (
          <SidebarMenuSubItem key={thread.conversationId}>
            <SidebarMenuSubButton
              isActive={active}
              aria-current={active ? 'page' : undefined}
              onClick={() => onOpenThread(agent, thread.conversationId)}
              className="group-hover/menu-sub-item:pr-14 group-focus-within/menu-sub-item:pr-14"
            >
              <MessageSquare aria-hidden />
              <span className="flex-1 truncate">{thread.title}</span>
              {thread.isMain ? (
                <span className="text-[10px] text-(--muted-light) group-hover/menu-sub-item:hidden group-focus-within/menu-sub-item:hidden">Main</span>
              ) : null}
            </SidebarMenuSubButton>
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
            <SidebarMenuSubButton
              isActive={active}
              disabled={!target}
              onClick={() => { if (target) onOpenThread(agent, target) }}
              className={!target ? 'cursor-default opacity-70' : undefined}
            >
              <Workflow aria-hidden />
              <span className="flex-1 truncate">{automation.name}</span>
              {!automation.enabled ? <span className="text-[10px] text-(--muted-light)">Paused</span> : null}
            </SidebarMenuSubButton>
          </SidebarMenuSubItem>
        )
      })}
      {!agent.archivedAt ? (
        <SidebarMenuSubItem>
          <SidebarMenuSubButton
            disabled={creatingThread}
            onClick={() => onCreateThread(agent)}
            className="text-(--muted-light)"
          >
            {creatingThread ? <Loader2 className="animate-spin" aria-hidden /> : <Plus aria-hidden />}
            <span className="truncate">New thread</span>
          </SidebarMenuSubButton>
        </SidebarMenuSubItem>
      ) : null}
    </SidebarMenuSub>
  )
}
