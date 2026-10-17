'use client'
import { Button } from '@overlay/ui/primitives'
import { unstyledButton } from '../control-reset'
import { memo, type MouseEvent } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { NotebookNote } from '@overlay/app-core'

export interface NotebookNotesSidebarProps {
  notes: readonly NotebookNote[]
  activeNoteId?: string | null
  onCreateNote: () => void
  onOpenNote: (note: NotebookNote) => void
  onDeleteNote: (noteId: string, event?: MouseEvent) => void
}

export function NotebookNotesSidebar({
  notes,
  activeNoteId,
  onCreateNote,
  onOpenNote,
  onDeleteNote,
}: NotebookNotesSidebarProps) {
  return (
    <div className="w-52 h-full flex flex-col border-r border-(--border) bg-(--sidebar-surface)">
      <div className="flex h-16 items-center border-b border-(--border) px-3">
        <Button variant="ghost" type="submit"
          onClick={onCreateNote}
          className={unstyledButton("flex items-center gap-1.5 w-full px-3 py-1.5 rounded-md text-sm border border-(--border) bg-(--surface-muted) text-(--foreground) hover:bg-(--surface-subtle) transition-colors")}
        >
          <Plus size={13} />
          New note
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5">
        {notes.map((note) => (
          <NotebookNoteRow
            key={note._id}
            note={note}
            active={activeNoteId === note._id}
            onOpenNote={onOpenNote}
            onDeleteNote={onDeleteNote}
          />
        ))}
      </div>
    </div>
  )
}

interface NotebookNoteRowProps {
  note: NotebookNote
  active: boolean
  onOpenNote: (note: NotebookNote) => void
  onDeleteNote: (noteId: string, event?: MouseEvent) => void
}

const NotebookNoteRow = memo(function NotebookNoteRow({
  note,
  active,
  onOpenNote,
  onDeleteNote,
}: NotebookNoteRowProps) {
  return (
    <div className={`group flex items-center justify-between rounded-md transition-colors ${
      active
        ? 'bg-(--surface-subtle) text-(--foreground)'
        : 'text-(--muted) hover:bg-(--surface-muted) hover:text-(--foreground)'
    }`}>
      <Button variant="ghost"
        type="button"
        onClick={() => onOpenNote(note)}
        className={unstyledButton("min-w-0 flex-1 truncate px-2.5 py-1.5 text-left text-xs")}
      >
        {note.title || 'Untitled'}
      </Button>
      <Button variant="ghost"
        type="button"
        onClick={(event) => onDeleteNote(note._id, event)}
        aria-label={`Delete ${note.title || 'Untitled'}`}
        className={unstyledButton("mr-1 rounded-sm p-1 opacity-0 transition-opacity hover:bg-(--border) focus:opacity-100 group-hover:opacity-100")}
      >
        <Trash2 size={11} />
      </Button>
    </div>
  )
})

export interface NotebookEmptyStateProps {
  onCreateNote: () => void
}

export function NotebookEmptyState({ onCreateNote }: NotebookEmptyStateProps) {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center">
        <p className="mb-2 text-3xl text-(--foreground)" style={{ fontFamily: 'var(--font-serif)' }}>
          notes
        </p>
        <p className="text-sm text-(--muted) mb-4">Select a note or create a new one</p>
        <Button variant="ghost" type="submit"
          onClick={onCreateNote}
          className={unstyledButton("inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-sm border border-(--border) bg-(--surface-muted) text-(--foreground) hover:bg-(--surface-subtle) transition-colors")}
        >
          <Plus size={14} />
          New Note
        </Button>
      </div>
    </div>
  )
}
