'use client'

import { unstyledButton } from '@overlay/ui/control-reset'
import { Button } from '@overlay/ui/primitives'

import { useState, type ReactNode } from 'react'
import { Maximize2, PanelRightOpen, X } from 'lucide-react'
import { cn, Dialog, DialogContent } from '@overlay/ui'

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
      <Button variant="ghost"
        type="button"
        onClick={() => onModeChange(nextMode)}
        className={unstyledButton(`rounded-md p-1.5 text-(--muted) transition-colors hover:bg-(--surface-subtle) hover:text-(--foreground)`)}
        aria-label={label}
        title={label}
      >
        {mode === 'panel' ? <Maximize2 size={15} strokeWidth={1.75} /> : <PanelRightOpen size={15} strokeWidth={1.75} />}
      </Button>
      <Button variant="ghost"
        type="button"
        onClick={onClose}
        className={unstyledButton(`rounded-md p-1.5 text-(--muted) transition-colors hover:bg-(--surface-subtle) hover:text-(--foreground)`)}
        aria-label="Close attachment preview"
        title="Close"
      >
        <X size={16} strokeWidth={1.75} />
      </Button>
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
  // Keep the last preview while the exit animation plays (same pattern as DraftReviewModal).
  const [cachedPreview, setCachedPreview] = useState(preview)
  if (preview && preview !== cachedPreview) setCachedPreview(preview)
  const activePreview = preview ?? cachedPreview
  if (!activePreview) return null

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose() }}>
      <DialogContent
        showCloseButton={false}
        overlayClassName="z-50 bg-(--overlay-scrim) p-4"
        aria-label="Attachment preview"
        className={cn('flex h-[min(92vh,900px)] w-[calc(100%-2rem)] max-w-5xl gap-0 flex-col overflow-hidden p-0')}
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
      </DialogContent>
    </Dialog>
  )
}
