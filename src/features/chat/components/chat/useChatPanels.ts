'use client'

import { useCallback, useRef, useState } from 'react'
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
  const previewRequestId = useRef(0)

  const openSourcesPanel = useCallback((turnId: string, sources: WebSourceItem[]) => {
    previewRequestId.current += 1
    setLinkPreview(null)
    setAttachmentPreview(null)
    setAttachmentPreviewModeState(preferredAttachmentPreviewMode.current)
    setSourcesPanel((prev) => (prev && prev.turnId === turnId ? null : { turnId, sources }))
  }, [])
  const closeSourcesPanel = useCallback(() => {
    previewRequestId.current += 1
    setSourcesPanel(null)
  }, [])

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
  const preferredAttachmentPreviewMode = useRef(attachmentPreviewMode)

  const setAttachmentPreviewMode = useCallback((mode: AttachmentPreviewMode) => {
    preferredAttachmentPreviewMode.current = mode
    setAttachmentPreviewModeState(mode)
    try {
      window.localStorage.setItem(ATTACHMENT_PREVIEW_MODE_KEY, mode)
    } catch {
      // Ignore blocked storage; the current session still reflects the preference.
    }
  }, [])

  // One right-hand panel at a time: opening a link replaces whatever is there.
  const openLinkPreview = useCallback((url: string, title?: string) => {
    previewRequestId.current += 1
    setSourcesPanel(null)
    setAttachmentPreview(null)
    setAttachmentPreviewModeState(preferredAttachmentPreviewMode.current)
    setLinkPreview({ url, ...(title ? { title } : {}) })
  }, [])
  const closeLinkPreview = useCallback(() => {
    previewRequestId.current += 1
    setLinkPreview(null)
  }, [])

  const loadFilePreview = useCallback(async (preview: AttachmentPreview) => {
    const requestId = ++previewRequestId.current
    const fetchText = preview.mimeType
      ? isTextMimeType(preview.mimeType)
      : shouldFetchTextContent(preview.name)
    const onRetry = () => { void loadFilePreview(preview) }
    const onMediaError = () => setAttachmentPreview((current) => {
      if (!current || requestId !== previewRequestId.current) return current
      const sameRequest = preview.fileId !== undefined
        ? current.fileId === preview.fileId
        : current.fileId === undefined && current.url === preview.url
      return sameRequest
        ? { ...current, loading: false, error: 'This file is unavailable or you do not have permission to preview it.' }
        : current
    })
    if (!preview.fileId || !fetchText) {
      const refreshedUrl = preview.fileId && preview.url ? new URL(preview.url, window.location.origin) : null
      if (refreshedUrl && preview.fileId) refreshedUrl.searchParams.set('previewAttempt', String(requestId))
      setAttachmentPreview({
        ...preview,
        ...(refreshedUrl ? { url: `${refreshedUrl.pathname}${refreshedUrl.search}` } : {}),
        loading: false,
        error: undefined,
        onRetry,
        ...(preview.url ? { onMediaError } : {}),
      })
      return
    }
    setAttachmentPreview({
      ...preview,
      loading: true,
      error: undefined,
      onRetry,
    })
    try {
      const res = await overlayAppClient.files.contentResponse(preview.fileId)
      if (!res.ok) {
        const error = res.status === 403 ? 'You do not have permission to preview this file.'
          : res.status === 404 ? 'This file is missing or was deleted.'
            : `Could not load this file (${res.status}).`
        throw new Error(error)
      }
      const content = await res.text()
      setAttachmentPreview((current) => current && current.fileId === preview.fileId && requestId === previewRequestId.current
        ? { ...current, content, loading: false, error: undefined }
        : current)
    } catch (error) {
      setAttachmentPreview((current) => current && current.fileId === preview.fileId && requestId === previewRequestId.current
        ? { ...current, loading: false, error: error instanceof Error ? error.message : 'Could not load this file.' }
        : current)
    }
  }, [])

  const openAttachmentPreview = useCallback((preview: AttachmentPreview, options?: AttachmentPreviewOpenOptions) => {
    setSourcesPanel(null)
    setLinkPreview(null)
    if (options?.mode) {
      setAttachmentPreviewModeState(options.mode)
    }
    const next = {
      ...preview,
      ...(preview.mimeType ? { previewName: previewNameForMime(preview.name, preview.mimeType) } : {}),
      ...(options?.onBack ? { onBack: options.onBack } : {}),
    }
    void loadFilePreview(next)
  }, [loadFilePreview])

  const openFilePreview = useCallback((name: string, fileIds: string[], options?: AttachmentPreviewOpenOptions & { mimeType?: string; sizeBytes?: number }) => {
    const fileId = fileIds[0]
    if (!fileId) return
    openAttachmentPreview({
      name,
      fileId,
      content: '',
      url: `/api/v1/files/${encodeURIComponent(fileId)}/content`,
      ...(options?.mimeType ? { mimeType: options.mimeType } : {}),
      ...(options?.sizeBytes !== undefined ? { sizeBytes: options.sizeBytes } : {}),
    }, options)
  }, [openAttachmentPreview])

  const closeAttachmentPreview = useCallback(() => {
    previewRequestId.current += 1
    setAttachmentPreview(null)
    setAttachmentPreviewModeState(preferredAttachmentPreviewMode.current)
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

function isTextMimeType(mimeType?: string) {
  const mediaType = mimeType?.split(';', 1)[0]?.trim() ?? ''
  return /^text\//i.test(mediaType) || /json|xml|yaml|javascript|typescript/i.test(mediaType)
}

function previewNameForMime(name: string, mimeType: string) {
  if (/\.[^./]+$/.test(name)) return undefined
  const mediaType = mimeType.split(';', 1)[0]?.trim().toLowerCase() ?? ''
  const [kind, subtype] = mediaType.split('/')
  const extension = mediaType === 'text/markdown' ? 'md'
    : mediaType === 'text/plain' ? 'txt'
      : mediaType === 'application/json' ? 'json'
        : mediaType === 'text/csv' ? 'csv'
          : mediaType === 'application/xml' || mediaType === 'text/xml' ? 'xml'
      : kind === 'image' || kind === 'video' ? subtype
        : undefined
  return extension ? `${name}.${extension}` : undefined
}
