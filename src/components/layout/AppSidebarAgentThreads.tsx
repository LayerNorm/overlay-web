'use client'

import { Loader2, MessageSquare, Plus, Archive, ArchiveRestore, Trash2, Workflow } from 'lucide-react'
import type { WorkspaceAgentBundle, WorkspaceAgentDirectoryItem } from '@overlay/workspace-contracts'

export const resourceRowClass =
  'flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-left text-xs text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]'

export type AgentsPanelView = 'personal' | 'workspace' | 'archived'

export function agentThreadHref(baseHref: string, agentId: string, conversationId: string) {
  const params = new URLSearchParams({ agent: agentId, view: 'dms', id: conversationId })
  return `${baseHref}?${params.toString()}`
}

export function AgentThreadRows({
  agent,
  bundle,
  view,
  activeConversationId,
  onOpenThread,
  onCreateThread,
  onArchiveThread,
  onDeleteThread,
  creatingThread,
}: {
  agent: WorkspaceAgentDirectoryItem
  bundle: WorkspaceAgentBundle | 'loading' | 'error'
  view: AgentsPanelView
  activeConversationId: string | null
  onOpenThread(agent: WorkspaceAgentDirectoryItem, conversationId: string): void
  onCreateThread(agent: WorkspaceAgentDirectoryItem): void
  onArchiveThread(agent: WorkspaceAgentDirectoryItem, conversationId: string, archived: boolean): void
  onDeleteThread(agent: WorkspaceAgentDirectoryItem, conversationId: string): void
  creatingThread: boolean
}) {
  if (bundle === 'loading') {
    return (
      <div className="flex items-center gap-2 py-1.5 pl-9 text-xs text-[var(--muted-light)]">
        <Loader2 size={12} className="animate-spin" /> Loading threads...
      </div>
    )
  }
  if (bundle === 'error') {
    return <p className="py-1.5 pl-9 text-xs text-[var(--muted-light)]">Could not load threads</p>
  }
  // Live tabs show live threads; the Archived tab shows only archived ones.
  const threads = bundle.threads.filter((thread) => (
    view === 'archived' ? Boolean(thread.archivedAt) : !thread.archivedAt
  ))
  const automations = view === 'archived' && !agent.archivedAt ? [] : bundle.automations
  return (
    <div className="space-y-0.5 pb-1">
      {threads.map((thread) => {
        const active = activeConversationId === thread.conversationId
        return (
          <div key={thread.conversationId} className="group/thread relative">
            <button
              type="button"
              onClick={() => onOpenThread(agent, thread.conversationId)}
              className={`${resourceRowClass} pl-9 ${active ? 'bg-[var(--surface-subtle)] text-[var(--foreground)]' : ''}`}
            >
              <MessageSquare size={13} className="shrink-0" />
              <span className="flex-1 truncate">{thread.title}</span>
              {thread.isMain ? (
                <span className="text-[10px] text-[var(--muted-light)] group-hover/thread:hidden">Main</span>
              ) : null}
            </button>
            <span className="absolute inset-y-0 right-1.5 hidden items-center gap-0.5 group-hover/thread:flex">
              <button
                type="button"
                aria-label={thread.archivedAt ? 'Unarchive thread' : 'Archive thread'}
                title={thread.archivedAt ? 'Unarchive thread' : 'Archive thread'}
                onClick={(event) => {
                  event.stopPropagation()
                  onArchiveThread(agent, thread.conversationId, !thread.archivedAt)
                }}
                className="inline-flex h-5 w-5 items-center justify-center rounded text-[var(--muted-light)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
              >
                {thread.archivedAt ? <ArchiveRestore size={11} /> : <Archive size={11} />}
              </button>
              <button
                type="button"
                aria-label="Delete thread"
                title="Delete thread"
                onClick={(event) => {
                  event.stopPropagation()
                  onDeleteThread(agent, thread.conversationId)
                }}
                className="inline-flex h-5 w-5 items-center justify-center rounded text-[var(--muted-light)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
              >
                <Trash2 size={11} />
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
            className={`${resourceRowClass} pl-9 ${active ? 'bg-[var(--surface-subtle)] text-[var(--foreground)]' : ''} ${!target ? 'cursor-default opacity-70' : ''}`}
          >
            <Workflow size={13} className="shrink-0" />
            <span className="flex-1 truncate">{automation.name}</span>
            {!automation.enabled ? (
              <span className="text-[10px] text-[var(--muted-light)]">Paused</span>
            ) : null}
          </button>
        )
      })}
      {!agent.archivedAt ? (
        <button
          type="button"
          disabled={creatingThread}
          onClick={() => onCreateThread(agent)}
          className={`${resourceRowClass} pl-9 text-[var(--muted-light)]`}
        >
          {creatingThread
            ? <Loader2 size={13} className="shrink-0 animate-spin" />
            : <Plus size={13} className="shrink-0" />}
          <span className="truncate">New thread</span>
        </button>
      ) : null}
    </div>
  )
}
