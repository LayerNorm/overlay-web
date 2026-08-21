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
  const shellRightPanel = attachmentPreview && attachmentPreviewMode === 'panel' ? (
    <AttachmentPreviewPanel
      preview={attachmentPreview}
      mode="panel"
      onClose={closeAttachmentPreview}
      onModeChange={setAttachmentPreviewMode}
      renderViewer={renderAttachmentViewer}
    />
  ) : linkPreview ? (
    <LinkPreviewPanel
      url={linkPreview.url}
      title={linkPreview.title}
      onClose={closeLinkPreview}
      presentation={panelPresentation}
      onPresentationChange={setPanelPresentation}
      checkEmbeddable={checkLinkEmbeddable}
    />
  ) : sourcesPanel ? (
    <ChatSourcesPanel
      variant="shell"
      open
      onClose={closeSourcesPanel}
      sources={sourcesPanel.sources}
      presentation={panelPresentation}
      onPresentationChange={setPanelPresentation}
    />
  ) : null

  const shellRightPanelClose = attachmentPreview && attachmentPreviewMode === 'panel'
    ? closeAttachmentPreview
    : linkPreview
      ? closeLinkPreview
      : sourcesPanel
        ? closeSourcesPanel
        : undefined
  const defaultRightPanelWidth =
    attachmentPreview && attachmentPreviewMode === 'panel' ? 440 : linkPreview ? 520 : 380
  const shellRightPanelWidth = panelWidth ?? defaultRightPanelWidth
  const shellRightPanelMode: 'docked' | 'floating' =
    (sourcesPanel || linkPreview) && !(attachmentPreview && attachmentPreviewMode === 'panel')
      ? (panelPresentation === 'sidebar' ? 'docked' : 'floating')
      : 'docked'

  return {
    shellRightPanelResize: setPanelWidth,
    shellRightPanel,
    shellRightPanelClose,
    shellRightPanelWidth,
    shellRightPanelMode,
    shellRightPanelOpen: Boolean(shellRightPanel),
  }
}
