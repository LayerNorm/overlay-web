'use client'
import { Button, Input, SidebarMenu, SidebarMenuSubButton, SidebarMenuSubItem } from '@overlay/ui/primitives'
import { unstyledButton, unstyledInput } from '@overlay/ui/control-reset'
import type { MouseEvent, ReactNode } from 'react'
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
  /** Extra hover controls for a row (the web app adds Move and Archive, which depend on who is viewing). */
  renderRowActions?: (automation: AutomationSummary) => ReactNode
  renderLeadingIcon?: (automation: AutomationSummary) => ReactNode
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
  renderRowActions,
  renderLeadingIcon,
}: AutomationsInlineListProps) {
  if (automations.length === 0) {
    return <p className="px-2.5 py-2 text-xs text-(--muted-light)">No automations yet</p>
  }
  const deletingAutomationIdSet = new Set(deletingAutomationIds)

  return (
    <SidebarMenu>
      {automations.map((automation) => {
        const status = automationStatus(automation)
        const conversationId = getAutomationConversationId(automation)
        const automationLabel = getAutomationDisplayName(automation)
        const isActive = activeAutomationId === automation._id || activeId === automation._id || activeId === conversationId
        const isEditing = editingAutomationId === automation._id
        const isDeleting = deletingAutomationIdSet.has(automation._id)
        const isConfirmingDelete = pendingDeleteAutomationId === automation._id
        const href = automationHref(automation)
        return (
          <SidebarMenuSubItem
            key={automation._id}
            title={automation.lastError || status.label}
            onMouseLeave={() => {
              if (isConfirmingDelete) onClearPendingDelete()
            }}
            className="group/automation-row"
          >
            {isEditing ? (
              <div className="flex h-8 min-w-0 items-center gap-2.5 rounded-md bg-(--surface-subtle) px-2 text-sm text-(--foreground)">
                {pendingNavId === automation._id ? (
                  <Loader2 size={16} className="shrink-0 animate-spin" />
                ) : (
                  renderLeadingIcon?.(automation) ?? <Workflow size={16} className="shrink-0" />
                )}
                <Input
                  aria-label="Automation name"
                  ref={(el) => { el?.focus() }}
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
                  className={unstyledInput("min-w-0 flex-1 rounded-md border border-(--border) bg-(--surface-elevated) px-2 py-1 text-sm text-(--foreground) outline-hidden")}
                />
              </div>
            ) : (
              <SidebarMenuSubButton
                isActive={isActive}
                aria-current={isActive ? 'page' : undefined}
                disabled={isDeleting || pendingNavId === automation._id}
                onClick={() => onNavigateAutomation(automation, href)}
                className={renderRowActions ? 'pr-24' : 'pr-14'}
              >
                {pendingNavId === automation._id ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  renderLeadingIcon?.(automation) ?? <Workflow aria-hidden />
                )}
                <span className="flex-1 truncate text-left">{automationLabel}</span>
              </SidebarMenuSubButton>
            )}
            {!isEditing ? (
              <div className="absolute right-1 top-1.5 flex h-5 items-center gap-1 text-(--muted-light)">
                {isConfirmingDelete ? (
                  <Button variant="ghost"
                    type="button"
                    onClick={(event) => onConfirmDelete(automation, event)}
                    disabled={isDeleting}
                    className={unstyledButton(`${inlineConfirmDeleteButtonClass} disabled:opacity-30`)}
                    aria-label="Confirm delete automation"
                  >
                    Confirm
                  </Button>
                ) : (
                  <>
                    {renderRowActions ? (
                      <span className="flex shrink-0 items-center opacity-0 transition-opacity group-hover/automation-row:opacity-100 group-focus-within/automation-row:opacity-100">
                        {renderRowActions(automation)}
                      </span>
                    ) : null}
                    <Button variant="ghost"
                      type="button"
                      onClick={(event) => onBeginRename(automation, event)}
                      disabled={isDeleting}
                      className={unstyledButton("flex size-5 shrink-0 items-center justify-center rounded-md opacity-0 transition-opacity hover:bg-(--surface-elevated) hover:text-(--foreground) disabled:opacity-30 group-hover/automation-row:opacity-100 group-focus-within/automation-row:opacity-100")}
                      aria-label="Rename automation"
                    >
                      <Pencil size={14} />
                    </Button>
                    <Button variant="ghost"
                      type="button"
                      onClick={(event) => onRequestDelete(automation, event)}
                      disabled={isDeleting}
                      className={unstyledButton("flex size-5 shrink-0 items-center justify-center rounded-md opacity-0 transition-opacity hover:bg-(--surface-elevated) hover:text-red-500 disabled:opacity-30 group-hover/automation-row:opacity-100 group-focus-within/automation-row:opacity-100")}
                      aria-label="Delete automation"
                    >
                      <Trash2 size={14} />
                    </Button>
                  </>
                )}
              </div>
            ) : null}
          </SidebarMenuSubItem>
        )
      })}
    </SidebarMenu>
  )
}
