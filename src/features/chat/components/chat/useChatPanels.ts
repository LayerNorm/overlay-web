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
  clampPanelWidth,
  readStoredPanelPresentation,
  readStoredPanelWidth,
  storePanelPresentation,
  storePanelWidth,
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
  /** A link opened in the right-hand panel instead of a browser tab. */
  const [linkPreview, setLinkPreview] = useState<{ url: string; title?: string } | null>(null)

  const openSourcesPanel = useCallback((turnId: string, sources: WebSourceItem[]) => {
    setLinkPreview(null)
    setSourcesPanel((prev) => (prev && prev.turnId === turnId ? null : { turnId, sources }))
  }, [])
  const closeSourcesPanel = useCallback(() => setSourcesPanel(null), [])

  // Null until the user drags the edge, so each panel keeps its own default.
  const [panelWidth, setPanelWidthState] = useState<number | null>(readStoredPanelWidth)
  const setPanelWidth = useCallback((width: number) => {
    const next = clampPanelWidth(width)
    setPanelWidthState(next)
    storePanelWidth(next)
  }, [])

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

  // One right-hand panel at a time: opening a link replaces whatever is there.
  const openLinkPreview = useCallback((url: string, title?: string) => {
    setSourcesPanel(null)
    setAttachmentPreview(null)
    setLinkPreview({ url, ...(title ? { title } : {}) })
  }, [])
  const closeLinkPreview = useCallback(() => setLinkPreview(null), [])

  const openAttachmentPreview = useCallback((preview: AttachmentPreview, options?: AttachmentPreviewOpenOptions) => {
    setSourcesPanel(null)
    setLinkPreview(null)
    if (options?.mode) {
      setAttachmentPreviewMode(options.mode)
    }
    setAttachmentPreview(preview)
  }, [setAttachmentPreviewMode])

  const openFilePreview = useCallback(async (name: string, fileIds: string[]) => {
    const fileId = fileIds[0]
    if (!fileId) return
    setSourcesPanel(null)
    setLinkPreview(null)
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
    closeLinkPreview,
    closeSourcesPanel,
    linkPreview,
    openLinkPreview,
    openAttachmentPreview,
    openFilePreview,
    openSourcesPanel,
    panelPresentation,
    panelWidth,
    setPanelPresentation,
    setPanelWidth,
    setAttachmentPreviewMode,
    setSourcesPanel,
    sourcesPanel,
  }
}
