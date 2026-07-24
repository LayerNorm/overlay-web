'use client'

import type { MouseEvent } from 'react'
import { Loader2, Pencil, Trash2, Workflow } from 'lucide-react'
import type { AutomationSummary } from '@overlay/app-core'
import {
  automationHref,
  automationStatus,
  getAutomationConversationId,
  getAutomationDisplayName,
} from '@overlay/app-core/automations'

const inlineConfirmDeleteButtonClass =
  'inline-flex h-5 shrink-0 items-center rounded-full bg-red-500/15 px-2 text-[11px] font-medium leading-none text-red-500 transition-colors hover:bg-red-500/25'

export interface AutomationsInlineListProps {
  automations: readonly AutomationSummary[]
  activeId?: string | null
  activeAutomationId?: string | null
  editingAutomationId?: string | null
  editingAutomationName: string
  pendingDeleteAutomationId?: string | null
  deletingAutomationIds?: readonly string[]
  pendingNavId?: string | null
  onNavigateAutomation: (automation: AutomationSummary, href: string) => void
  onBeginRename: (automation: AutomationSummary, event: React.MouseEvent) => void
  onEditingNameChange: (name: string) => void
  onCommitRename: (automation: AutomationSummary) => void
  onCancelRename: () => void
  onRequestDelete: (automation: AutomationSummary, event: React.MouseEvent) => void
  onConfirmDelete: (automation: AutomationSummary, event: React.MouseEvent) => void
  onClearPendingDelete: () => void
}

export function AutomationsInlineList({
  automations,
  activeId,
  activeAutomationId,
  editingAutomationId,
  editingAutomationName,
  pendingDeleteAutomationId,
  deletingAutomationIds = [],
  pendingNavId,
  onNavigateAutomation,
  onBeginRename,
  onEditingNameChange,
  onCommitRename,
  onCancelRename,
  onRequestDelete,
  onConfirmDelete,
  onClearPendingDelete,
}: AutomationsInlineListProps) {
  if (automations.length === 0) {
    return <p className="px-2.5 py-2 text-xs text-[var(--muted-light)]">No automations yet</p>
  }

  return (
    <div className="space-y-0.5">
      {automations.map((automation) => {
        const status = automationStatus(automation)
        const iconColor = status.tone === 'error'
          ? 'text-red-500'
          : status.tone === 'enabled'
            ? 'text-green-500'
            : 'text-[var(--muted-light)]'
        const conversationId = getAutomationConversationId(automation)
        const automationLabel = getAutomationDisplayName(automation)
        const isActive = activeAutomationId === automation._id || activeId === automation._id || activeId === conversationId
        const isEditing = editingAutomationId === automation._id
        const isDeleting = deletingAutomationIds.includes(automation._id)
        const isConfirmingDelete = pendingDeleteAutomationId === automation._id
        const href = automationHref(automation)
        return (
          <div
            key={automation._id}
            title={automation.lastError || status.label}
            onMouseLeave={() => {
              if (isConfirmingDelete) onClearPendingDelete()
            }}
            className={`group/automation-row flex h-7 w-full items-center gap-1 rounded-md px-2 py-0 text-xs transition-colors ${
              isActive
                ? 'bg-[var(--surface-subtle)] text-[var(--foreground)]'
                : 'text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]'
            }`}
          >
            <button
              type="button"
              disabled={isDeleting || pendingNavId === automation._id}
              onClick={() => {
                if (isEditing) return
                onNavigateAutomation(automation, href)
              }}
              className="flex min-w-0 flex-1 items-center gap-2 rounded-sm px-0.5 text-left disabled:cursor-default disabled:opacity-50"
            >
              {pendingNavId === automation._id ? (
                <Loader2 size={13} strokeWidth={1.75} className="shrink-0 animate-spin text-[var(--muted)]" />
              ) : (
                <Workflow size={13} strokeWidth={1.75} className={`shrink-0 ${iconColor}`} />
              )}
              {isEditing ? (
                <input
                  autoFocus
                  value={editingAutomationName}
                  onChange={(event) => onEditingNameChange(event.target.value)}
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      onCommitRename(automation)
                    } else if (event.key === 'Escape') {
                      event.preventDefault()
                      onCancelRename()
                    }
                  }}
                  onBlur={() => onCommitRename(automation)}
                  className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--surface-elevated)] px-2 py-1 text-[11px] text-[var(--foreground)] outline-none"
                />
              ) : (
                <span className="flex-1 truncate text-left">{automationLabel}</span>
              )}
            </button>
            {!isEditing ? (
              <>
                {isConfirmingDelete ? (
                  <button
                    type="button"
                    onClick={(event) => onConfirmDelete(automation, event)}
                    disabled={isDeleting}
                    className={`${inlineConfirmDeleteButtonClass} disabled:opacity-30`}
                    aria-label="Confirm delete automation"
                  >
                    Confirm
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={(event) => onBeginRename(automation, event)}
                      disabled={isDeleting}
                      className="shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-[var(--border)] disabled:opacity-30 group-hover/automation-row:opacity-100 focus-visible:opacity-100"
                      aria-label="Rename automation"
                    >
                      <Pencil size={11} />
                    </button>
                    <button
                      type="button"
                      onClick={(event) => onRequestDelete(automation, event)}
                      disabled={isDeleting}
                      className="shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-[var(--border)] hover:text-red-500 disabled:opacity-30 group-hover/automation-row:opacity-100 focus-visible:opacity-100"
                      aria-label="Delete automation"
                    >
                      <Trash2 size={11} />
                    </button>
                  </>
                )}
              </>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
