'use client'

import type { ChangeEvent, KeyboardEvent, ReactNode } from 'react'
import { ArrowLeft, FolderOpen, MessageCircle, Plus, Trash2, X } from 'lucide-react'
import type { NotebookNote } from '@overlay/app-core'
import { AppScreenHeader } from '../shell'

export interface NotebookHeaderProps {
  activeNote: NotebookNote | null
  loading?: boolean
  compact?: boolean
  title: string
  projectName?: string
  isDirty?: boolean
  agentPanelOpen?: boolean
  exportMenu?: ReactNode
  assistantHeader?: ReactNode
  leading?: ReactNode
  hideBackButton?: boolean
  hideActions?: boolean
  onDeleteNote?: () => void
  onBackToFiles: () => void
  onCreateNote: () => void
  onTitleChange: (event: ChangeEvent<HTMLInputElement>) => void
  onTitleBlur: () => void
  onTitleKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void
  onToggleAgentPanel: () => void
}

export function NotebookHeader({
  activeNote,
  loading,
  compact,
  title,
  projectName,
  isDirty,
  agentPanelOpen,
  exportMenu,
  assistantHeader,
  leading,
  hideBackButton,
  hideActions,
  onDeleteNote,
  onBackToFiles,
  onCreateNote,
  onTitleChange,
  onTitleBlur,
  onTitleKeyDown,
  onToggleAgentPanel,
}: NotebookHeaderProps) {
  const headerClassName = compact ? 'h-11 min-h-11 gap-0 px-0 py-0' : 'px-6'
  const headerStyle = compact ? { height: 44, minHeight: 44, padding: 0 } : undefined

  if (!activeNote && loading) {
    return (
      <AppScreenHeader className={headerClassName} style={headerStyle} aria-busy="true">
        <span className="sr-only">Loading note</span>
      </AppScreenHeader>
    )
  }

  if (!activeNote) {
    return (
      <AppScreenHeader
        title="Notes"
        className={headerClassName}
        style={headerStyle}
        actions={!hideActions ? (
          <button
            onClick={onCreateNote}
            className="flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-1.5 text-sm text-[var(--foreground)] transition-colors hover:bg-[var(--surface-subtle)]"
          >
            <Plus size={14} />
            New note
          </button>
        ) : undefined}
      />
    )
  }

  return (
    <AppScreenHeader className={compact ? headerClassName : 'px-0 py-0'} style={headerStyle}>
      <div className={`flex flex-1 items-center justify-between gap-2 px-3 ${compact ? 'h-11' : ''}`}>
        {leading}
        {!hideBackButton ? (
          <button
            type="button"
            onClick={onBackToFiles}
            title="Back to files"
            className={`inline-flex shrink-0 items-center justify-center text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)] ${compact ? 'h-7 w-7 rounded-md' : 'h-9 w-9 rounded-lg'}`}
          >
            <ArrowLeft size={compact ? 13 : 17} />
          </button>
        ) : null}
        <input
          type="text"
          value={title}
          onChange={onTitleChange}
          onBlur={onTitleBlur}
          onKeyDown={onTitleKeyDown}
          placeholder="Note title..."
          className={`flex-1 bg-transparent font-medium text-[var(--foreground)] outline-none placeholder:text-[var(--muted)] ${compact ? 'text-[19px]' : 'text-xl'}`}
          style={{ fontFamily: 'var(--font-serif)' }}
        />
        {!hideActions ? <div className="flex shrink-0 items-center gap-1.5">
          {projectName && (
            <span className="flex items-center gap-1 whitespace-nowrap rounded-full border border-[var(--border)] bg-[var(--surface-subtle)] px-2 py-0.5 text-[10px] text-[var(--muted)]">
              <FolderOpen size={9} />
              {projectName}
            </span>
          )}
          {isDirty && <span className="text-[11px] text-[var(--muted-light)]">Unsaved</span>}
          {exportMenu}
          {onDeleteNote ? (
            <button
              type="button"
              onClick={onDeleteNote}
              className={`inline-flex shrink-0 items-center justify-center text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)] ${compact ? 'h-7 w-7 rounded-md' : 'h-9 w-9 rounded-lg'}`}
              aria-label="Delete note"
              title="Delete note"
            >
              <Trash2 size={compact ? 13 : 15} />
            </button>
          ) : null}
          <button
            type="button"
            onClick={onToggleAgentPanel}
            className={`inline-flex shrink-0 items-center justify-center text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)] ${compact ? 'h-7 w-7 rounded-md' : 'h-9 w-9 rounded-lg'} ${
              agentPanelOpen ? 'bg-[var(--surface-subtle)] text-[var(--foreground)]' : ''
            }`}
            aria-label={agentPanelOpen ? 'Close note assistant' : 'Open note assistant'}
            title="Note assistant"
          >
            <MessageCircle size={compact ? 13 : 16} />
          </button>
        </div> : null}
      </div>
      {agentPanelOpen ? assistantHeader : null}
    </AppScreenHeader>
  )
}

export interface NotebookAgentHeaderProps {
  pendingDiffCount: number
  modelPicker: ReactNode
  onAcceptAllDiffs: () => void
  onRejectAllDiffs: () => void
  onClose: () => void
}

export function NotebookAgentHeader({
  pendingDiffCount,
  modelPicker,
  onAcceptAllDiffs,
  onRejectAllDiffs,
  onClose,
}: NotebookAgentHeaderProps) {
  return (
    <div className="flex h-11 min-h-11 shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] px-3">
      <span className="text-[13px] font-medium text-[var(--foreground)]">Assistant</span>
      <div className="flex items-center gap-2">
        {pendingDiffCount > 0 && (
          <>
            <button
              type="button"
              onClick={onAcceptAllDiffs}
              className="rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-2 py-1 text-[11px] text-[var(--foreground)] hover:bg-[var(--surface-subtle)]"
            >
              Accept all
            </button>
            <button
              type="button"
              onClick={onRejectAllDiffs}
              className="rounded-md border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
            >
              Reject all
            </button>
          </>
        )}
        {modelPicker}
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
          aria-label="Close note assistant"
          title="Close note assistant"
        >
          <X size={14} strokeWidth={1.8} />
        </button>
      </div>
    </div>
  )
}
