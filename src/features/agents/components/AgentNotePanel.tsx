'use client'

import { useState } from 'react'
import { ArrowLeft, ExternalLink, X } from 'lucide-react'
import { Button } from '@overlay/ui/primitives'
import { CanonicalNotebookEditor, type NotebookEditorHeaderRenderProps } from '@overlay/modules-react/notes'
import { useLiveNote } from '@/hooks/use-file-tree'
import { useNotebookRepository } from '@/hooks/use-notebook-repository'
import { DEFAULT_MODEL_ID } from '@/shared/ai/gateway/model-types'

const NO_MODELS: never[] = []
const noAgent = () => Promise.reject(new Error('The note assistant is available on the Notes page.'))
const ignore = () => {}

function NotePanelHeader({
  header,
  onBack,
  onOpenInFiles,
  onClose,
}: {
  header: NotebookEditorHeaderRenderProps
  onBack(): void
  onOpenInFiles(): void
  onClose(): void
}) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-1 px-2">
      <Button variant="ghost" size="icon-sm" type="button" aria-label="Back to Library" onClick={onBack}>
        <ArrowLeft size={16} />
      </Button>
      <span className="flex min-w-0 flex-1 flex-col px-1">
        <span className="truncate text-[13px] font-medium text-(--foreground)">
          {header.activeNote ? header.title || 'Untitled' : 'Loading…'}
        </span>
        <span className="flex items-center gap-1.5 text-[11.5px] text-(--muted)" aria-live="polite">
          <span
            aria-hidden="true"
            className={`size-1.5 rounded-full transition-colors ${
              header.saveFailed ? 'bg-red-500' : header.isDirty ? 'bg-amber-500' : 'bg-(--muted-light)'
            }`}
          />
          {header.saveFailed ? 'Not saved yet' : header.isDirty ? 'Saving…' : 'Saved'}
        </span>
      </span>
      <Button variant="ghost" size="icon-sm" type="button" aria-label="Open in Files" title="Open in Files" onClick={onOpenInFiles}>
        <ExternalLink size={15} />
      </Button>
      <Button variant="ghost" size="icon-sm" type="button" aria-label="Close" onClick={onClose}>
        <X size={16} />
      </Button>
    </div>
  )
}

/**
 * A note opened from an agent thread, editable in the right panel with the same canonical editor as the Notes page:
 * same Markdown, block handle and slash menu, and the same revision-guarded saves.
 */
export function AgentNotePanel({
  fileId,
  onBack,
  onClose,
  onOpenInFiles,
}: {
  fileId: string
  onBack(): void
  onClose(): void
  onOpenInFiles(): void
}) {
  const repository = useNotebookRepository()
  const liveNote = useLiveNote(fileId)
  // Deleted or no longer readable elsewhere: the editor keeps unsaved text visible, otherwise it goes back.
  const [seenNoteId, setSeenNoteId] = useState<string | null>(null)
  if (liveNote && seenNoteId !== liveNote._id) setSeenNoteId(liveNote._id)
  const noteRemoved = liveNote === null && seenNoteId === fileId

  return (
    <aside
      data-slot="right-sidebar"
      aria-label="Note"
      className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-(--sidebar-surface)"
    >
      <CanonicalNotebookEditor
        key={fileId}
        noteId={fileId}
        liveNote={liveNote}
        noteRemoved={noteRemoved}
        hideSidebar
        layout="panel"
        repository={repository}
        runAgent={noAgent}
        models={NO_MODELS}
        initialModelId={DEFAULT_MODEL_ID}
        controlledAgentPanelOpen={false}
        onNavigateNote={ignore}
        onBackToFiles={onBack}
        renderHeader={(header) => (
          <NotePanelHeader header={header} onBack={onBack} onOpenInFiles={onOpenInFiles} onClose={onClose} />
        )}
      />
    </aside>
  )
}
