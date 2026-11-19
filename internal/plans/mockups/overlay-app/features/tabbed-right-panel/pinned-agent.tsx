'use client'

import { Loader2, Plus } from 'lucide-react'
import type { WorkspaceAgentBundle, WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'
import { Button, SidebarMenuItem } from '@overlay/ui/primitives'
import { AgentCreature } from '@/components/orb/Creature'
import { AgentThreadRows } from '@/components/layout/AppSidebarAgentThreads'
import { useAgentThreadActivity } from '@/components/layout/sidebar/AgentThreadActivityProvider'

/** The pinned chief of staff sits above every other agent as its own tile: avatar and name, nothing else. */
export function PinnedAgentTile({
  agent,
  active,
  expanded,
  bundle,
  activeConversationId,
  creating,
  onOpen,
  onCreateThread,
  onOpenThread,
  onOpenAutomation,
  onArchiveThread,
}: {
  agent: WorkspaceAgentDirectoryItem
  active: boolean
  expanded: boolean
  bundle: WorkspaceAgentBundle | 'loading' | 'error'
  activeConversationId: string | null
  creating: boolean
  onOpen(): void
  onCreateThread(): void
  onOpenThread(agent: WorkspaceAgentDirectoryItem, conversationId: string): void
  onOpenAutomation(automationId: string): void
  onArchiveThread(agent: WorkspaceAgentDirectoryItem, conversationId: string, archived: boolean): void
}) {
  const activity = useAgentThreadActivity(agent.id)
  return (
    <SidebarMenuItem data-agent-row={agent.id}>
      <div className="flex justify-center pb-2 pt-1">
        <div className="group/tile relative">
          <Button variant="ghost" type="button" onClick={onOpen} aria-current={active ? 'page' : undefined}
            className={`flex h-auto w-[116px] flex-col items-center gap-2 rounded-xl px-3 pb-2.5 pt-3.5 text-[13px] font-normal text-(--foreground) hover:bg-(--surface-subtle) ${
              active ? 'bg-(--surface-subtle)' : 'bg-(--surface-subtle)/55'
            }`}>
            <AgentCreature agent={agent} isDefault={agent.isDefault} size={40} />
            <span className="max-w-full truncate">{agent.name}</span>
          </Button>
          <Button variant="ghost" size="icon-xs" type="button" aria-label={`New thread with ${agent.name}`} title="New thread"
            disabled={creating} onClick={onCreateThread}
            className="absolute right-1 top-1 text-(--muted) opacity-0 group-hover/tile:opacity-100 focus-visible:opacity-100">
            {creating ? <Loader2 className="animate-spin" aria-hidden /> : <Plus aria-hidden />}
          </Button>
        </div>
      </div>
      {active && expanded ? (
        <AgentThreadRows
          agent={agent}
          bundle={bundle}
          activity={activity}
          activeConversationId={activeConversationId}
          onOpenThread={onOpenThread}
          onOpenAutomation={onOpenAutomation}
          onArchiveThread={onArchiveThread}
        />
      ) : null}
    </SidebarMenuItem>
  )
}
