'use client'

import type { ChangeEvent, KeyboardEvent, ReactNode } from 'react'
import { ArrowLeft, FolderOpen, MessageCircle, Plus, Trash2 } from 'lucide-react'
import type { NotebookNote } from '@overlay/app-core'
import { AppScreenHeader } from '../shell'

export interface NotebookHeaderProps {
  activeNote: NotebookNote | null
  title: string
  projectName?: string
  isDirty?: boolean
  agentPanelOpen?: boolean
  exportMenu?: ReactNode
  assistantHeader?: ReactNode
  leading?: ReactNode
  hideBackButton?: boolean
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
  title,
  projectName,
  isDirty,
  agentPanelOpen,
  exportMenu,
  assistantHeader,
  leading,
  hideBackButton,
  onDeleteNote,
  onBackToFiles,
  onCreateNote,
  onTitleChange,
  onTitleBlur,
  onTitleKeyDown,
  onToggleAgentPanel,
}: NotebookHeaderProps) {
  if (!activeNote) {
    return (
      <AppScreenHeader
        title="Notes"
        className="px-6"
        actions={
          <button
            onClick={onCreateNote}
            className="flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-1.5 text-sm text-[var(--foreground)] transition-colors hover:bg-[var(--surface-subtle)]"
          >
            <Plus size={14} />
            New note
          </button>
        }
      />
    )
  }

  return (
    <AppScreenHeader className="px-0 py-0">
      <div className="flex flex-1 items-center justify-between gap-2 px-3">
        {leading}
        {!hideBackButton ? (
          <button
            type="button"
            onClick={onBackToFiles}
            title="Back to files"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
          >
            <ArrowLeft size={17} />
          </button>
        ) : null}
        <input
          type="text"
          value={title}
          onChange={onTitleChange}
          onBlur={onTitleBlur}
          onKeyDown={onTitleKeyDown}
          placeholder="Note title..."
          className="flex-1 bg-transparent font-medium text-xl text-[var(--foreground)] outline-none placeholder:text-[var(--muted)]"
          style={{ fontFamily: 'var(--font-serif)' }}
        />
        <div className="flex shrink-0 items-center gap-1.5">
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
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
              aria-label="Delete note"
              title="Delete note"
            >
              <Trash2 size={15} />
            </button>
          ) : null}
          <button
            type="button"
            onClick={onToggleAgentPanel}
            className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)] ${
              agentPanelOpen ? 'bg-[var(--surface-subtle)] text-[var(--foreground)]' : ''
            }`}
            aria-label={agentPanelOpen ? 'Close note assistant' : 'Open note assistant'}
            title="Note assistant"
          >
            <MessageCircle size={16} />
          </button>
        </div>
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
}

export function NotebookAgentHeader({
  pendingDiffCount,
  modelPicker,
  onAcceptAllDiffs,
  onRejectAllDiffs,
}: NotebookAgentHeaderProps) {
  return (
    <div className="flex min-h-16 shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] px-4">
      <span className="text-xs font-medium text-[var(--foreground)]">Assistant</span>
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
      </div>
    </div>
  )
}
