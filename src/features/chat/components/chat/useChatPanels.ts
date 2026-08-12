'use client'

import { useCallback, useState } from 'react'
import type {
  AttachmentPreview,
  AttachmentPreviewMode,
  AttachmentPreviewOpenOptions,
} from '@overlay/chat-react'
import type { WebSourceItem } from '@/shared/web/web-sources'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { shouldFetchTextContent } from '@/shared/files/file-viewer-types'
import {
  readStoredPanelPresentation,
  storePanelPresentation,
  type PanelPresentation,
} from '@/shared/ui/panel-presentation'

export type { AttachmentPreview, AttachmentPreviewMode }
export type { PanelPresentation }

const ATTACHMENT_PREVIEW_MODE_KEY = 'overlay_attachment_preview_mode'

function readStoredAttachmentPreviewMode(): AttachmentPreviewMode {
  if (typeof window === 'undefined') return 'panel'
  try {
    const saved = window.localStorage.getItem(ATTACHMENT_PREVIEW_MODE_KEY)
    return saved === 'dialog' ? 'dialog' : 'panel'
  } catch {
    return 'panel'
  }
}

export function useChatPanels() {
  const [sourcesPanel, setSourcesPanel] = useState<{ turnId: string; sources: WebSourceItem[] } | null>(null)
  const openSourcesPanel = useCallback((turnId: string, sources: WebSourceItem[]) => {
    setSourcesPanel((prev) => (prev && prev.turnId === turnId ? null : { turnId, sources }))
  }, [])
  const closeSourcesPanel = useCallback(() => setSourcesPanel(null), [])

  const [panelPresentation, setPanelPresentationState] = useState<PanelPresentation>(readStoredPanelPresentation)
  const setPanelPresentation = useCallback((presentation: PanelPresentation) => {
    setPanelPresentationState(presentation)
    storePanelPresentation(presentation)
  }, [])

  const [attachmentPreview, setAttachmentPreview] = useState<AttachmentPreview | null>(null)
  const [attachmentPreviewMode, setAttachmentPreviewModeState] = useState<AttachmentPreviewMode>(readStoredAttachmentPreviewMode)

  const setAttachmentPreviewMode = useCallback((mode: AttachmentPreviewMode) => {
    setAttachmentPreviewModeState(mode)
    try {
      window.localStorage.setItem(ATTACHMENT_PREVIEW_MODE_KEY, mode)
    } catch {
      // Ignore blocked storage; the current session still reflects the preference.
    }
  }, [])

  const openAttachmentPreview = useCallback((preview: AttachmentPreview, options?: AttachmentPreviewOpenOptions) => {
    setSourcesPanel(null)
    if (options?.mode) {
      setAttachmentPreviewMode(options.mode)
    }
    setAttachmentPreview(preview)
  }, [setAttachmentPreviewMode])

  const openFilePreview = useCallback(async (name: string, fileIds: string[]) => {
    const fileId = fileIds[0]
    if (!fileId) return
    setSourcesPanel(null)
    const url = `/api/v1/files/${fileId}/content`
    setAttachmentPreview({
      name,
      fileId,
      content: '',
      url,
    })
    if (!shouldFetchTextContent(name)) {
      return
    }
    try {
      const res = await overlayAppClient.files.contentResponse(fileId)
      if (res.ok) {
        const content = await res.text()
        setAttachmentPreview((prev) => (
          prev?.fileId === fileId ? { ...prev, content } : prev
        ))
      }
    } catch {
      // URL-only preview remains for binary assets stored in R2.
    }
  }, [])

  const closeAttachmentPreview = useCallback(() => {
    setAttachmentPreview(null)
  }, [])

  return {
    attachmentPreview,
    attachmentPreviewMode,
    closeAttachmentPreview,
    closeSourcesPanel,
    openAttachmentPreview,
    openFilePreview,
    openSourcesPanel,
    panelPresentation,
    setPanelPresentation,
    setAttachmentPreviewMode,
    setSourcesPanel,
    sourcesPanel,
  }
}
