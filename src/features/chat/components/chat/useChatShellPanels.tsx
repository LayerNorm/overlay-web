'use client'

import type { ReactNode } from 'react'
import {
  AttachmentPreviewPanel,
  type AttachmentPreview,
  type AttachmentPreviewMode,
} from '@overlay/chat-react'
import { ChatSourcesPanel } from '../ChatSourcesPanel'
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
  closeSourcesPanel,
  panelPresentation,
  setPanelPresentation,
  setAttachmentPreviewMode,
  sourcesPanel,
  renderAttachmentViewer,
}: {
  attachmentPreview: AttachmentPreview | null
  attachmentPreviewMode: AttachmentPreviewMode
  closeAttachmentPreview: () => void
  closeSourcesPanel: () => void
  panelPresentation: PanelPresentation
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
    : sourcesPanel
      ? closeSourcesPanel
      : undefined
  const shellRightPanelWidth = attachmentPreview && attachmentPreviewMode === 'panel' ? 440 : 380
  const shellRightPanelMode: 'docked' | 'floating' =
    sourcesPanel && !(attachmentPreview && attachmentPreviewMode === 'panel')
      ? (panelPresentation === 'sidebar' ? 'docked' : 'floating')
      : 'docked'

  return {
    shellRightPanel,
    shellRightPanelClose,
    shellRightPanelWidth,
    shellRightPanelMode,
    shellRightPanelOpen: Boolean(shellRightPanel),
  }
}
