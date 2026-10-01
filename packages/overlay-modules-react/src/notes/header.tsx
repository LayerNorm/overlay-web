'use client'

import type { ChangeEvent, KeyboardEvent, ReactNode } from 'react'
import { ArrowLeft, FolderOpen, Maximize2, MessageCircle, PanelRightOpen, Plus, Trash2, X } from 'lucide-react'
import type { NotebookNote } from '@overlay/app-core'
import { AppScreenHeader, AppScreenSidePanelHeader } from '../shell'

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
  // AppScreenHeader's base padding is `px-3 sm:px-6` and cn() concatenates rather
  // than merges, so a bare `px-0` loses to `sm:px-6` on anything desktop-width.
  // The responsive variant has to be cancelled too, or the row keeps 24px of dead
  // space before the back button on top of its own px-3.
  const headerClassName = compact ? 'h-11 min-h-11 gap-0 px-0 py-0 sm:px-0' : 'px-6'
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
    <AppScreenHeader className={compact ? headerClassName : 'px-0 py-0 sm:px-0'} style={headerStyle}>
      <div className={`flex flex-1 items-center justify-between gap-2 px-3 ${compact ? 'h-11' : ''}`}>
        {leading}
        {!hideBackButton ? (
          <NotebookHeaderIconButton title="Back to files" compact={compact} onClick={onBackToFiles}>
            <ArrowLeft size={compact ? 13 : 17} />
          </NotebookHeaderIconButton>
        ) : null}
        <input
          type="text"
          aria-label="Note title"
          value={title}
          onChange={onTitleChange}
          onBlur={onTitleBlur}
          onKeyDown={onTitleKeyDown}
          placeholder="Note title..."
          className={`flex-1 bg-transparent font-medium text-[var(--foreground)] outline-none placeholder:text-[var(--muted)] ${compact ? 'text-[19px]' : 'text-xl'}`}
          style={{ fontFamily: 'var(--font-serif)' }}
        />
        {!hideActions ? (
          <NotebookHeaderActions
            compact={compact}
            projectName={projectName}
            isDirty={isDirty}
            agentPanelOpen={agentPanelOpen}
            exportMenu={exportMenu}
            onDeleteNote={onDeleteNote}
            onToggleAgentPanel={onToggleAgentPanel}
          />
        ) : null}
      </div>
      {agentPanelOpen ? assistantHeader : null}
    </AppScreenHeader>
  )
}

interface NotebookHeaderIconButtonProps {
  compact?: boolean
  active?: boolean
  label?: string
  title: string
  onClick: () => void
  children: ReactNode
}

function NotebookHeaderIconButton({ compact, active, label, title, onClick, children }: NotebookHeaderIconButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={label}
      className={`inline-flex shrink-0 items-center justify-center text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)] ${compact ? 'h-7 w-7 rounded-md' : 'h-9 w-9 rounded-lg'} ${
        active ? 'bg-[var(--surface-subtle)] text-[var(--foreground)]' : ''
      }`}
    >
      {children}
    </button>
  )
}

interface NotebookHeaderActionsProps {
  compact?: boolean
  projectName?: string
  isDirty?: boolean
  agentPanelOpen?: boolean
  exportMenu?: ReactNode
  onDeleteNote?: () => void
  onToggleAgentPanel: () => void
}

function NotebookHeaderActions({
  compact,
  projectName,
  isDirty,
  agentPanelOpen,
  exportMenu,
  onDeleteNote,
  onToggleAgentPanel,
}: NotebookHeaderActionsProps) {
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {projectName && (
        <span className="flex items-center gap-1 whitespace-nowrap rounded-full border border-[var(--border)] bg-[var(--surface-subtle)] px-2 py-0.5 text-[10px] text-[var(--muted)]">
          <FolderOpen size={9} />
          {projectName}
        </span>
      )}
      {isDirty && <span className="text-[11px] text-[var(--muted-light)]">Unsaved</span>}
      {onDeleteNote ? (
        <NotebookHeaderIconButton label="Delete note" title="Delete note" compact={compact} onClick={onDeleteNote}>
          <Trash2 size={compact ? 13 : 15} />
        </NotebookHeaderIconButton>
      ) : null}
      <NotebookHeaderIconButton
        label={agentPanelOpen ? 'Close note assistant' : 'Open note assistant'}
        title="Note assistant"
        compact={compact}
        active={agentPanelOpen}
        onClick={onToggleAgentPanel}
      >
        <MessageCircle size={compact ? 13 : 16} />
      </NotebookHeaderIconButton>
      {/* Overflow menu sits last: it is the catch-all, so it belongs at the
          edge rather than between the direct actions. */}
      {exportMenu}
    </div>
  )
}

export interface NotebookAgentHeaderProps {
  pendingDiffCount: number
  modelPicker: ReactNode
  /** Floating overlays the note; sidebar docks the panel as a column. */
  presentation?: 'floating' | 'sidebar'
  onPresentationChange?: (presentation: 'floating' | 'sidebar') => void
  onAcceptAllDiffs: () => void
  onRejectAllDiffs: () => void
  onClose: () => void
}

export function NotebookAgentHeader({
  pendingDiffCount,
  modelPicker,
  presentation,
  onPresentationChange,
  onAcceptAllDiffs,
  onRejectAllDiffs,
  onClose,
}: NotebookAgentHeaderProps) {
  const nextPresentation = presentation === 'floating' ? 'sidebar' : 'floating'
  const presentationLabel = presentation === 'floating' ? 'Dock as side panel' : 'Show as floating panel'
  return (
    <AppScreenSidePanelHeader>
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
        {presentation && onPresentationChange ? (
          <button
            type="button"
            onClick={() => onPresentationChange(nextPresentation)}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
            aria-label={presentationLabel}
            title={presentationLabel}
          >
            {presentation === 'floating'
              ? <PanelRightOpen size={14} strokeWidth={1.8} />
              : <Maximize2 size={14} strokeWidth={1.8} />}
          </button>
        ) : null}
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
    </AppScreenSidePanelHeader>
  )
}
