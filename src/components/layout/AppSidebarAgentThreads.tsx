'use client'

import { Loader2, MessageSquare, Plus, Archive, Trash2, Workflow } from 'lucide-react'
import type { WorkspaceAgentBundle, WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'

import { resourceRowClass } from './sidebar-nav'

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
      <div className="flex items-center gap-2 py-1.5 pl-2.5 text-xs text-(--muted-light)">
        <span className="inline-flex w-4 shrink-0 justify-center"><Loader2 size={12} className="animate-spin" /></span> Loading threads...
      </div>
    )
  }
  if (bundle === 'error') {
    return <p className="py-1.5 pl-[34px] text-xs text-(--muted-light)">Could not load threads</p>
  }
  // Archived threads are in Settings → Archived, not under the agent.
  const threads = bundle.threads.filter((thread) => !thread.archivedAt)
  const automations = bundle.automations
  return (
    <div className="space-y-0.5 pb-1">
      {threads.map((thread) => {
        const active = activeConversationId === thread.conversationId
        return (
          <div key={thread.conversationId} className="group/thread relative">
            <button
              type="button"
              onClick={() => onOpenThread(agent, thread.conversationId)}
              className={`${resourceRowClass} ${active ? 'bg-(--surface-subtle) text-(--foreground)' : ''}`}
            >
              <span className="inline-flex w-4 shrink-0 justify-center"><MessageSquare size={13} /></span>
              <span className="flex-1 truncate group-hover/thread:pr-14">{thread.title}</span>
              {thread.isMain ? (
                <span className="text-[10px] text-(--muted-light) group-hover/thread:hidden">Main</span>
              ) : null}
            </button>
            <span className="absolute inset-y-1 right-1 hidden items-center gap-0.5 rounded-md bg-(--surface-subtle) px-0.5 group-hover/thread:flex">
              <button
                type="button"
                aria-label="Archive thread"
                title="Archive thread"
                onClick={(event) => {
                  event.stopPropagation()
                  onArchiveThread(agent, thread.conversationId, true)
                }}
                className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-(--muted) transition-colors hover:bg-(--surface-elevated) hover:text-(--foreground)"
              >
                <Archive size={13} />
              </button>
              <button
                type="button"
                aria-label="Delete thread"
                title="Delete thread"
                onClick={(event) => {
                  event.stopPropagation()
                  onDeleteThread(agent, thread.conversationId)
                }}
                className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-(--muted) transition-colors hover:bg-(--surface-elevated) hover:text-(--foreground)"
              >
                <Trash2 size={13} />
              </button>
            </span>
          </div>
        )
      })}
      {automations.map((automation) => {
        const target = automation.conversationId
        const active = target != null && activeConversationId === target
        return (
          <button
            key={automation.automationId}
            type="button"
            disabled={!target}
            onClick={() => { if (target) onOpenThread(agent, target) }}
            className={`${resourceRowClass} ${active ? 'bg-(--surface-subtle) text-(--foreground)' : ''} ${!target ? 'cursor-default opacity-70' : ''}`}
          >
            <span className="inline-flex w-4 shrink-0 justify-center"><Workflow size={13} /></span>
            <span className="flex-1 truncate">{automation.name}</span>
            {!automation.enabled ? (
              <span className="text-[10px] text-(--muted-light)">Paused</span>
            ) : null}
          </button>
        )
      })}
      {!agent.archivedAt ? (
        <button
          type="button"
          disabled={creatingThread}
          onClick={() => onCreateThread(agent)}
          className={`${resourceRowClass} text-(--muted-light)`}
        >
          <span className="inline-flex w-4 shrink-0 justify-center">
            {creatingThread ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
          </span>
          <span className="truncate">New thread</span>
        </button>
      ) : null}
    </div>
  )
}
