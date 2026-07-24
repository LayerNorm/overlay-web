import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { shouldFetchTextContent } from '@overlay/app-core'
import {
  AttachmentPreviewDialog,
  AttachmentPreviewPanel,
  type AttachmentPreview,
  type AttachmentPreviewMode,
  type AttachmentPreviewOpenOptions,
} from '@overlay/chat-react'
import { FileViewerPanel } from '@overlay/modules-react/knowledge'
import { overlayDesktopAppClient } from '../../services/app-api-client'

const ATTACHMENT_PREVIEW_MODE_KEY = 'overlay_attachment_preview_mode'

function readStoredMode(): AttachmentPreviewMode {
  try {
    return localStorage.getItem(ATTACHMENT_PREVIEW_MODE_KEY) === 'dialog' ? 'dialog' : 'panel'
  } catch {
    return 'panel'
  }
}

export function useDesktopAttachmentPreview(onOpen?: () => void) {
  const [preview, setPreview] = useState<AttachmentPreview | null>(null)
  const [mode, setModeState] = useState<AttachmentPreviewMode>(readStoredMode)
  const request = useRef<AbortController | null>(null)
  const objectUrl = useRef<string | null>(null)

  const releaseObjectUrl = useCallback(() => {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current)
    objectUrl.current = null
  }, [])

  const setMode = useCallback((nextMode: AttachmentPreviewMode) => {
    setModeState(nextMode)
    try {
      localStorage.setItem(ATTACHMENT_PREVIEW_MODE_KEY, nextMode)
    } catch {
      // The in-memory preference remains usable when storage is unavailable.
    }
  }, [])

  const close = useCallback(() => {
    request.current?.abort()
    request.current = null
    releaseObjectUrl()
    setPreview(null)
  }, [releaseObjectUrl])

  const open = useCallback((nextPreview: AttachmentPreview, options?: AttachmentPreviewOpenOptions) => {
    request.current?.abort()
    releaseObjectUrl()
    onOpen?.()
    if (options?.mode) setMode(options.mode)
    setPreview(nextPreview)
    if (!nextPreview.fileId) return

    const controller = new AbortController()
    request.current = controller
    void overlayDesktopAppClient.files.contentResponse(nextPreview.fileId, {
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error(`Could not load ${nextPreview.name}`)
      if (shouldFetchTextContent(nextPreview.name)) {
        const content = await response.text()
        if (!controller.signal.aborted) {
          setPreview((current) => current && current.fileId === nextPreview.fileId
            ? { ...current, content }
            : current)
        }
        return
      }
      const url = URL.createObjectURL(await response.blob())
      if (controller.signal.aborted) {
        URL.revokeObjectURL(url)
        return
      }
      objectUrl.current = url
      setPreview((current) => current && current.fileId === nextPreview.fileId
        ? { ...current, url }
        : current)
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return
      console.warn('[DesktopAttachmentPreview] Failed to refresh attachment content:', error)
    })
  }, [onOpen, releaseObjectUrl, setMode])

  useEffect(() => () => {
    request.current?.abort()
    releaseObjectUrl()
  }, [releaseObjectUrl])

  return { preview, mode, open, close, setMode }
}

function renderViewer({
  preview,
  headerRight,
}: {
  preview: AttachmentPreview
  headerRight: ReactNode
}): React.ReactNode {
  return (
    <FileViewerPanel
      name={preview.name}
      content={preview.content}
      url={preview.url}
      headerRight={headerRight}
    />
  )
}

export function DesktopAttachmentPreviewPanel({
  preview,
  onClose,
  onModeChange,
}: {
  preview: AttachmentPreview
  onClose(): void
  onModeChange(mode: AttachmentPreviewMode): void
}): React.ReactElement {
  return (
    <div className="shared-app-scope h-full min-h-0 w-full">
      <AttachmentPreviewPanel
        preview={preview}
        mode="panel"
        onClose={onClose}
        onModeChange={onModeChange}
        renderViewer={renderViewer}
      />
    </div>
  )
}

export function DesktopAttachmentPreviewDialog({
  preview,
  mode,
  onClose,
  onModeChange,
}: {
  preview: AttachmentPreview | null
  mode: AttachmentPreviewMode
  onClose(): void
  onModeChange(mode: AttachmentPreviewMode): void
}): React.ReactElement {
  return (
    <div className="shared-app-scope">
      <AttachmentPreviewDialog
        open={Boolean(preview && mode === 'dialog')}
        preview={preview}
        onClose={onClose}
        onModeChange={onModeChange}
        renderViewer={renderViewer}
      />
    </div>
  )
}
