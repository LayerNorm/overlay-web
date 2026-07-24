'use client'

import { useState, type ReactNode } from 'react'
import { Maximize2, PanelRightOpen, X } from 'lucide-react'
import { cn, usePresence } from '@overlay/ui'

export type AttachmentPreviewMode = 'panel' | 'dialog'

export type AttachmentPreview = {
  name: string
  content: string
  url?: string
  fileId?: string
}

export type AttachmentPreviewOpenOptions = {
  mode?: AttachmentPreviewMode
}

type AttachmentViewerRenderProps = {
  preview: AttachmentPreview
  headerRight: ReactNode
}

function AttachmentPreviewHeaderActions({
  mode,
  onClose,
  onModeChange,
}: {
  mode: AttachmentPreviewMode
  onClose: () => void
  onModeChange: (mode: AttachmentPreviewMode) => void
}) {
  const nextMode = mode === 'panel' ? 'dialog' : 'panel'
  const label = mode === 'panel' ? 'Open as floating dialog' : 'Open in side panel'
  return (
    <>
      <button
        type="button"
        onClick={() => onModeChange(nextMode)}
        className="rounded-md p-1.5 text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
        aria-label={label}
        title={label}
      >
        {mode === 'panel' ? <Maximize2 size={15} strokeWidth={1.75} /> : <PanelRightOpen size={15} strokeWidth={1.75} />}
      </button>
      <button
        type="button"
        onClick={onClose}
        className="rounded-md p-1.5 text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
        aria-label="Close attachment preview"
        title="Close"
      >
        <X size={16} strokeWidth={1.75} />
      </button>
    </>
  )
}

export function AttachmentPreviewPanel({
  preview,
  mode,
  onClose,
  onModeChange,
  renderViewer,
}: {
  preview: AttachmentPreview
  mode: AttachmentPreviewMode
  onClose: () => void
  onModeChange: (mode: AttachmentPreviewMode) => void
  renderViewer: (props: AttachmentViewerRenderProps) => ReactNode
}) {
  const headerRight = (
    <AttachmentPreviewHeaderActions
      mode={mode}
      onClose={onClose}
      onModeChange={onModeChange}
    />
  )
  return <>{renderViewer({ preview, headerRight })}</>
}

export function AttachmentPreviewDialog({
  open,
  preview,
  onClose,
  onModeChange,
  renderViewer,
}: {
  open: boolean
  preview: AttachmentPreview | null
  onClose: () => void
  onModeChange: (mode: AttachmentPreviewMode) => void
  renderViewer: (props: AttachmentViewerRenderProps) => ReactNode
}) {
  const { mounted, visible } = usePresence(open, 300)
  // Keep the last preview while the exit animation plays (same pattern as DraftReviewModal).
  const [cachedPreview, setCachedPreview] = useState(preview)
  if (preview && preview !== cachedPreview) setCachedPreview(preview)
  const activePreview = preview ?? cachedPreview
  if (!mounted || !activePreview) return null

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay-scrim)] p-4 transition-opacity duration-300 ease-[var(--overlay-ease)]',
        visible ? 'opacity-100' : 'opacity-0',
      )}
      onClick={(event) => { if (event.target === event.currentTarget) onClose() }}
    >
      <div
        role="dialog"
        aria-label="Attachment preview"
        aria-modal="true"
        className={cn(
          'flex h-[min(92vh,900px)] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] shadow-xl transition-[opacity,transform] duration-300 ease-[var(--overlay-ease)]',
          visible ? 'scale-100 translate-y-0 opacity-100' : 'scale-95 translate-y-1 opacity-0',
        )}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex min-h-0 flex-1 flex-col">
          {renderViewer({
            preview: activePreview,
            headerRight: (
              <AttachmentPreviewHeaderActions
                mode="dialog"
                onClose={onClose}
                onModeChange={onModeChange}
              />
            ),
          })}
        </div>
      </div>
    </div>
  )
}
