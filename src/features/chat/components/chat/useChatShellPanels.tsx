'use client'

import type { ReactNode } from 'react'
import {
  AttachmentPreviewPanel,
  LinkPreviewPanel,
  type AttachmentPreview,
  type AttachmentPreviewMode,
} from '@overlay/chat-react'
import { ChatSourcesPanel } from '../ChatSourcesPanel'
import { checkLinkEmbeddable } from '@/features/chat/lib/link-preview'
import type { PanelPresentation } from './useChatPanels'
import type { WebSourceItem } from '@/shared/web/web-sources'

export type RenderAttachmentViewer = (args: {
  preview: AttachmentPreview
  headerRight: ReactNode
}) => ReactNode

type ShellPanelKind = 'attachment' | 'link' | 'sources'

type ShellPanelState = {
  attachmentPreview: AttachmentPreview | null
  attachmentPreviewMode: AttachmentPreviewMode
  linkPreview: { url: string; title?: string } | null
  sourcesPanel: { turnId: string; sources: WebSourceItem[] } | null
}

function resolveShellPanelKind({
  attachmentPreview,
  attachmentPreviewMode,
  linkPreview,
  sourcesPanel,
}: ShellPanelState): ShellPanelKind | null {
  if (attachmentPreview && attachmentPreviewMode === 'panel') return 'attachment'
  if (linkPreview) return 'link'
  if (sourcesPanel) return 'sources'
  return null
}

function renderShellRightPanel({
  panelKind,
  attachmentPreview,
  closeAttachmentPreview,
  closeLinkPreview,
  closeSourcesPanel,
  linkPreview,
  panelPresentation,
  setPanelPresentation,
  setAttachmentPreviewMode,
  sourcesPanel,
  renderAttachmentViewer,
}: ShellPanelState & {
  panelKind: ShellPanelKind | null
  closeAttachmentPreview: () => void
  closeLinkPreview: () => void
  closeSourcesPanel: () => void
  panelPresentation: PanelPresentation
  setPanelPresentation: (presentation: PanelPresentation) => void
  setAttachmentPreviewMode: (mode: AttachmentPreviewMode) => void
  renderAttachmentViewer: RenderAttachmentViewer
}): ReactNode {
  if (panelKind === 'attachment' && attachmentPreview) {
    return (
      <AttachmentPreviewPanel
        preview={attachmentPreview}
        mode="panel"
        onClose={closeAttachmentPreview}
        onModeChange={setAttachmentPreviewMode}
        renderViewer={renderAttachmentViewer}
      />
    )
  }
  if (panelKind === 'link' && linkPreview) {
    return (
      <LinkPreviewPanel
        url={linkPreview.url}
        title={linkPreview.title}
        onClose={closeLinkPreview}
        presentation={panelPresentation}
        onPresentationChange={setPanelPresentation}
        checkEmbeddable={checkLinkEmbeddable}
      />
    )
  }
  if (panelKind === 'sources' && sourcesPanel) {
    return (
      <ChatSourcesPanel
        variant="shell"
        open
        onClose={closeSourcesPanel}
        sources={sourcesPanel.sources}
        presentation={panelPresentation}
        onPresentationChange={setPanelPresentation}
      />
    )
  }
  return null
}

function resolveShellPanelMode(
  panelKind: ShellPanelKind | null,
  panelPresentation: PanelPresentation,
): 'docked' | 'floating' {
  if ((panelKind === 'link' || panelKind === 'sources') && panelPresentation !== 'sidebar') {
    return 'floating'
  }
  return 'docked'
}

export function useChatShellPanels({
  attachmentPreview,
  attachmentPreviewMode,
  closeAttachmentPreview,
  closeLinkPreview,
  closeSourcesPanel,
  linkPreview,
  panelPresentation,
  panelWidth,
  setPanelWidth,
  setPanelPresentation,
  setAttachmentPreviewMode,
  sourcesPanel,
  renderAttachmentViewer,
}: {
  attachmentPreview: AttachmentPreview | null
  attachmentPreviewMode: AttachmentPreviewMode
  closeAttachmentPreview: () => void
  closeLinkPreview: () => void
  closeSourcesPanel: () => void
  linkPreview: { url: string; title?: string } | null
  panelPresentation: PanelPresentation
  /** User-dragged width; null keeps each panel's own default. */
  panelWidth: number | null
  setPanelWidth: (width: number) => void
  setPanelPresentation: (presentation: PanelPresentation) => void
  setAttachmentPreviewMode: (mode: AttachmentPreviewMode) => void
  sourcesPanel: { turnId: string; sources: WebSourceItem[] } | null
  renderAttachmentViewer: RenderAttachmentViewer
}) {
  const panelKind = resolveShellPanelKind({
    attachmentPreview,
    attachmentPreviewMode,
    linkPreview,
    sourcesPanel,
  })

  const shellRightPanel = renderShellRightPanel({
    panelKind,
    attachmentPreview,
    attachmentPreviewMode,
    closeAttachmentPreview,
    closeLinkPreview,
    closeSourcesPanel,
    linkPreview,
    panelPresentation,
    setPanelPresentation,
    setAttachmentPreviewMode,
    sourcesPanel,
    renderAttachmentViewer,
  })

  const closeByPanelKind: Record<ShellPanelKind, () => void> = {
    attachment: closeAttachmentPreview,
    link: closeLinkPreview,
    sources: closeSourcesPanel,
  }
  const shellRightPanelClose = panelKind ? closeByPanelKind[panelKind] : undefined

  const defaultWidthByPanelKind: Record<ShellPanelKind, number> = {
    attachment: 440,
    link: 520,
    sources: 380,
  }
  const shellRightPanelWidth = panelWidth ?? (panelKind ? defaultWidthByPanelKind[panelKind] : 380)
  const shellRightPanelMode = resolveShellPanelMode(panelKind, panelPresentation)

  return {
    shellRightPanelResize: setPanelWidth,
    shellRightPanel,
    shellRightPanelClose,
    shellRightPanelWidth,
    shellRightPanelMode,
    shellRightPanelOpen: Boolean(shellRightPanel),
  }
}
